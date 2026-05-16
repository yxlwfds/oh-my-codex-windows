/**
 * OMX Execution Subagent MCP Server
 *
 * 把 ExecutionSubagent(Terminus-4B-style delegated terminal runner backed by
 * DeepSeek V4 Flash)暴露为一个 MCP tool —— `delegate_terminal_task` ——
 * 让 Codex 主代理通过 MCP 协议自动 discover、按需委托冗长终端任务,
 * 主代理只接收结构化 <final_answer> 摘要,避免上下文被原始 stdout 污染。
 *
 * 设计原则(论文模式):
 * - 工具自描述:`description` 字段告诉主代理何时该用、何时别用、怎么传任务。
 * - 不自动降级:DeepSeek 不可用时返回 error,由主代理决定是否回退到 bash tool。
 * - 缓存项目级:.omx/subagent-cache/(由 ExecutionSubagent 内部管理)。
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
	CallToolRequestSchema,
	ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { autoStartStdioMcpServer } from "./bootstrap.js";
// Types only — keep runtime cost out of the top-level import graph so the stdio
// server can start before Node 24's unsettled-top-level-await detector trips.
// The concrete ExecutionSubagent (which pulls in @anthropic-ai/sdk) is loaded
// lazily on the first delegate_terminal_task call via getSubagent().
import type {
	ExecutionSubagent,
	SubagentQuery,
	SubagentResponse,
	ThinkingMode,
} from "../subagents/index.js";

const SUBAGENT_TOOL_NAMES = new Set([
	"delegate_terminal_task",
	"subagent_clear_cache",
	"subagent_cache_stats",
]);

const DELEGATE_TERMINAL_TASK_DESCRIPTION = [
	"Run a verbose terminal task in an isolated subagent loop (DeepSeek V4 Flash) and return a structured summary, instead of cluttering your main context with raw stdout.",
	"",
	"PREFER for:",
	"- Build/test suites (npm test, cargo test, pytest, dotnet build, etc.) whose output is multi-KB.",
	"- Dependency installs (npm install, pip install, cargo build) with verbose progress logs.",
	"- Multi-step diagnostics that iterate on output (lint -> fix -> rerun -> report).",
	"- Any command whose stdout/stderr is expected to exceed ~2KB.",
	"- Repeated tasks within a session (cache hits return in ~0.1s without an LLM round-trip).",
	"",
	"AVOID for:",
	"- One-shot reads where you need verbatim output (cat, git diff, git log, jq queries).",
	"- Trivial single-line commands (ls, pwd, which, echo) — overhead exceeds the benefit.",
	"- Anything that requires editing files — the subagent only runs commands, it does not write code.",
	"- Interactive commands that require human input mid-stream.",
	"",
	"Pass full task semantics in `task`, not just the bare command. Good:",
	'  "run npm test, group failures by module, return only the top 3 errors per group plus a fix suggestion"',
	"Weak:",
	'  "npm test"',
	"",
	"Trust the returned `final_answer` summary as authoritative. Only re-invoke with a more specific query if the summary is insufficient. If DeepSeek is unavailable, this tool returns an error — fall back to running the command yourself via your normal bash/shell tool.",
].join("\n");

const server = new Server(
	{ name: "omx-subagent", version: "0.1.0" },
	{ capabilities: { tools: {} } },
);

export function buildSubagentServerTools() {
	return [
		{
			name: "delegate_terminal_task",
			description: DELEGATE_TERMINAL_TASK_DESCRIPTION,
			inputSchema: {
				type: "object",
				properties: {
					task: {
						type: "string",
						description:
							"Full task semantics in natural language — include WHAT to run, HOW to interpret output, and WHAT to return. The subagent will iterate inside its own agentic loop and produce a <final_answer> summary.",
					},
					working_directory: {
						type: "string",
						description:
							"Optional cwd for the subagent's command execution. Defaults to the MCP server's process cwd.",
					},
					expected_output: {
						type: "string",
						description:
							"Optional steering hint describing what shape of summary the main agent expects (e.g. 'top 3 error groups with file:line').",
					},
					thinking_mode: {
						type: "string",
						enum: ["always", "smart", "never"],
						description:
							"Thinking-mode policy. 'smart' (default) lets the subagent decide based on task complexity. 'always' forces thinking (slower, higher quality). 'never' disables thinking (fastest).",
					},
					max_turns: {
						type: "number",
						description:
							"Maximum agentic loop turns before the subagent must emit a final answer. Default 10.",
					},
					cache_policy: {
						type: "string",
						enum: ["use", "skip"],
						description:
							"Whether to consult the application-layer cache (.omx/subagent-cache/). Default 'use'.",
					},
				},
				required: ["task"],
			},
		},
		{
			name: "subagent_cache_stats",
			description:
				"Return statistics about the subagent application-layer cache (total entries, total size, oldest/newest entry timestamps). Useful for debugging cache behavior.",
			inputSchema: {
				type: "object",
				properties: {},
			},
		},
		{
			name: "subagent_clear_cache",
			description:
				"Clear all cached subagent responses. Use when cache entries are stale (e.g. after a dependency upgrade or branch switch). Returns the number of entries removed.",
			inputSchema: {
				type: "object",
				properties: {},
			},
		},
	];
}

server.setRequestHandler(ListToolsRequestSchema, async () => ({
	tools: buildSubagentServerTools(),
}));

interface DelegateTerminalTaskArgs {
	task?: unknown;
	working_directory?: unknown;
	expected_output?: unknown;
	thinking_mode?: unknown;
	max_turns?: unknown;
	cache_policy?: unknown;
}

function coerceString(value: unknown): string | undefined {
	return typeof value === "string" && value.length > 0 ? value : undefined;
}

function coerceThinkingMode(value: unknown): ThinkingMode | undefined {
	if (value === "always" || value === "smart" || value === "never") return value;
	return undefined;
}

function coerceNumber(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) && value > 0
		? Math.floor(value)
		: undefined;
}

function buildErrorPayload(message: string, code: string, hint?: string) {
	return {
		error: message,
		code,
		...(hint ? { hint } : {}),
	};
}

let cachedSubagent: ExecutionSubagent | null = null;

async function getSubagent(): Promise<ExecutionSubagent> {
	if (cachedSubagent) return cachedSubagent;
	// Lazy-load the heavy subagent module on first use so the MCP stdio server
	// can start up without paying the @anthropic-ai/sdk import cost upfront.
	const subagentModule = await import("../subagents/index.js");
	cachedSubagent = subagentModule.createExecutionSubagentFromEnv();
	return cachedSubagent;
}

function shapeResponse(response: SubagentResponse) {
	return {
		status: response.status,
		final_answer: response.finalAnswer,
		commands: response.commands.map((cmd) => ({
			command: cmd.command,
			exit_code: cmd.exitCode,
			summary: cmd.summary,
			...(cmd.error ? { error: cmd.error } : {}),
		})),
		tokens_used: response.tokensUsed,
		cache_hit: response.fromCache,
		thinking_enabled: response.thinkingEnabled,
	};
}

export async function handleSubagentToolCall(request: {
	params: { name: string; arguments?: Record<string, unknown> };
}) {
	const { name, arguments: args = {} } = request.params;

	if (!SUBAGENT_TOOL_NAMES.has(name)) {
		return {
			content: [{ type: "text", text: `Unknown tool: ${name}` }],
			isError: true,
		};
	}

	if (name === "delegate_terminal_task") {
		const typedArgs = args as DelegateTerminalTaskArgs;
		const task = coerceString(typedArgs.task);
		if (!task) {
			return {
				content: [
					{
						type: "text",
						text: JSON.stringify(
							buildErrorPayload(
								"`task` is required and must be a non-empty string",
								"invalid_input",
								"Pass full task semantics, e.g. 'run npm test and return top 3 failures per module'.",
							),
						),
					},
				],
				isError: true,
			};
		}

		let subagent: ExecutionSubagent;
		try {
			subagent = await getSubagent();
		} catch (error) {
			const message =
				error instanceof Error ? error.message : String(error);
			return {
				content: [
					{
						type: "text",
						text: JSON.stringify(
							buildErrorPayload(
								message,
								"subagent_unavailable",
								"Subagent is not available (likely DEEPSEEK_API_KEY missing). Fall back to running the command yourself via your normal bash/shell tool.",
							),
						),
					},
				],
				isError: true,
			};
		}

		const thinkingMode = coerceThinkingMode(typedArgs.thinking_mode);
		const maxTurns = coerceNumber(typedArgs.max_turns);
		if (thinkingMode || maxTurns) {
			subagent.updateOptions({
				...(thinkingMode ? { thinkingMode } : {}),
				...(maxTurns ? { maxTurns } : {}),
			});
		}

		const expectedOutput = coerceString(typedArgs.expected_output);
		const workingDirectory = coerceString(typedArgs.working_directory);

		const composedQuery = [
			task,
			expectedOutput ? `\n\nExpected summary shape: ${expectedOutput}` : "",
			workingDirectory ? `\n\nWorking directory: ${workingDirectory}` : "",
		].join("");

		const query: SubagentQuery = {
			query: composedQuery,
			description: task.slice(0, 80),
		};

		const previousCwd =
			workingDirectory && workingDirectory !== process.cwd()
				? process.cwd()
				: null;
		if (previousCwd) {
			try {
				process.chdir(workingDirectory as string);
			} catch (error) {
				const message =
					error instanceof Error ? error.message : String(error);
				return {
					content: [
						{
							type: "text",
							text: JSON.stringify(
								buildErrorPayload(
									`failed to chdir to working_directory: ${message}`,
									"invalid_input",
								),
							),
						},
					],
					isError: true,
				};
			}
		}

		try {
			const response = await subagent.execute(query);
			return {
				content: [
					{ type: "text", text: JSON.stringify(shapeResponse(response)) },
				],
			};
		} catch (error) {
			const message =
				error instanceof Error ? error.message : String(error);
			return {
				content: [
					{
						type: "text",
						text: JSON.stringify(
							buildErrorPayload(
								message,
								"subagent_execution_failed",
								"DeepSeek API call failed or the agentic loop errored. Fall back to running the command yourself via your normal bash/shell tool.",
							),
						),
					},
				],
				isError: true,
			};
		} finally {
			if (previousCwd) {
				try {
					process.chdir(previousCwd);
				} catch {
					// best-effort restore; if it fails the process is likely already dying
				}
			}
		}
	}

	if (name === "subagent_cache_stats") {
		try {
			const subagent = await getSubagent();
			const stats = await subagent.getCacheStats();
			return {
				content: [
					{
						type: "text",
						text: JSON.stringify({
							total_entries: stats.totalEntries,
							total_size_bytes: stats.totalSize,
							oldest_entry: stats.oldestEntry?.toISOString() ?? null,
							newest_entry: stats.newestEntry?.toISOString() ?? null,
						}),
					},
				],
			};
		} catch (error) {
			const message =
				error instanceof Error ? error.message : String(error);
			return {
				content: [
					{
						type: "text",
						text: JSON.stringify(
							buildErrorPayload(message, "cache_stats_failed"),
						),
					},
				],
				isError: true,
			};
		}
	}

	if (name === "subagent_clear_cache") {
		try {
			const subagent = await getSubagent();
			const removed = await subagent.clearCache();
			return {
				content: [
					{
						type: "text",
						text: JSON.stringify({ removed_entries: removed }),
					},
				],
			};
		} catch (error) {
			const message =
				error instanceof Error ? error.message : String(error);
			return {
				content: [
					{
						type: "text",
						text: JSON.stringify(
							buildErrorPayload(message, "clear_cache_failed"),
						),
					},
				],
				isError: true,
			};
		}
	}

	// Unreachable because SUBAGENT_TOOL_NAMES was checked above
	return {
		content: [{ type: "text", text: `Unhandled tool: ${name}` }],
		isError: true,
	};
}

server.setRequestHandler(CallToolRequestSchema, handleSubagentToolCall);

// Start server
autoStartStdioMcpServer("subagent", server);
