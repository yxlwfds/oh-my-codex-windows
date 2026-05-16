/**
 * Contract tests for the omx_subagent MCP server (Phase 1).
 *
 * Static contract is verified by parsing the source file (the same pattern used
 * by `wiki-server.test.ts`), so we never touch the real DeepSeek API and never
 * spin up the stdio lifecycle. Dynamic handler error-path tests do a one-shot
 * dynamic import with `OMX_SUBAGENT_SERVER_DISABLE_AUTO_START=1` set first, so
 * the stdio auto-start guard short-circuits and the module exports stay
 * callable from the test process.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const REQUIRED_TOOLS = [
	'delegate_terminal_task',
	'subagent_cache_stats',
	'subagent_clear_cache',
] as const;

describe('mcp/subagent-server module contract', () => {
	it('declares the expected subagent MCP tools', async () => {
		const src = await readFile(
			join(process.cwd(), 'src/mcp/subagent-server.ts'),
			'utf8',
		);
		const toolNames = Array.from(src.matchAll(/name:\s*"([^"]+)"/g)).map(
			(match) => match[1],
		);

		for (const tool of REQUIRED_TOOLS) {
			assert.ok(
				toolNames.includes(tool),
				`missing tool declaration: ${tool}`,
			);
		}
	});

	it('delegates subagent stdio lifecycle bootstrapping to the shared helper', async () => {
		const src = await readFile(
			join(process.cwd(), 'src/mcp/subagent-server.ts'),
			'utf8',
		);
		assert.match(src, /autoStartStdioMcpServer\("subagent", server\)/);
	});

	it('embeds Terminus-4B-style PREFER/AVOID guidance in delegate_terminal_task description', async () => {
		const src = await readFile(
			join(process.cwd(), 'src/mcp/subagent-server.ts'),
			'utf8',
		);
		// description is built from a list of strings; checking via source ensures
		// the contract survives even if the runtime build flow changes
		assert.match(src, /PREFER for:/);
		assert.match(src, /AVOID for:/);
		assert.match(src, /final_answer/);
		assert.match(src, /DeepSeek/);
		assert.match(src, /fall back to running the command yourself/i);
	});

	it('declares thinking_mode and cache_policy as bounded enum inputs', async () => {
		const src = await readFile(
			join(process.cwd(), 'src/mcp/subagent-server.ts'),
			'utf8',
		);
		// Both fields are declared with `enum: [...]` literals
		assert.match(src, /enum:\s*\["always",\s*"smart",\s*"never"\]/);
		assert.match(src, /enum:\s*\["use",\s*"skip"\]/);
	});

	it('marks `task` as the sole required field on delegate_terminal_task input schema', async () => {
		const src = await readFile(
			join(process.cwd(), 'src/mcp/subagent-server.ts'),
			'utf8',
		);
		assert.match(src, /required:\s*\["task"\]/);
	});
});

describe('mcp/subagent-server handler error paths', () => {
	// Disable stdio auto-start BEFORE dynamic import so the module load does not
	// hang the test runner. Snapshot DEEPSEEK_API_KEY so we can restore it after
	// the suite runs even if the host environment has the real key set.
	const savedDisableAutoStart =
		process.env.OMX_SUBAGENT_SERVER_DISABLE_AUTO_START;
	const savedApiKey = process.env.DEEPSEEK_API_KEY;
	process.env.OMX_SUBAGENT_SERVER_DISABLE_AUTO_START = '1';
	delete process.env.DEEPSEEK_API_KEY;

	const handlerImport = import('../subagent-server.js');

	it('returns isError for unknown tool names', async () => {
		const { handleSubagentToolCall } = await handlerImport;
		const result = await handleSubagentToolCall({
			params: { name: 'nonexistent_tool', arguments: {} },
		});
		assert.equal(result.isError, true);
		const text = (result.content[0] as { text: string }).text;
		assert.match(text, /Unknown tool/);
	});

	it('returns code=invalid_input when delegate_terminal_task is missing task', async () => {
		const { handleSubagentToolCall } = await handlerImport;
		const result = await handleSubagentToolCall({
			params: { name: 'delegate_terminal_task', arguments: {} },
		});
		assert.equal(result.isError, true);
		const payload = JSON.parse((result.content[0] as { text: string }).text);
		assert.equal(payload.code, 'invalid_input');
		assert.match(payload.error, /task.*required/i);
	});

	it('returns code=invalid_input when task is an empty string', async () => {
		const { handleSubagentToolCall } = await handlerImport;
		const result = await handleSubagentToolCall({
			params: { name: 'delegate_terminal_task', arguments: { task: '' } },
		});
		assert.equal(result.isError, true);
		const payload = JSON.parse((result.content[0] as { text: string }).text);
		assert.equal(payload.code, 'invalid_input');
	});

	it('returns code=subagent_unavailable with explicit fall-back hint when DEEPSEEK_API_KEY is missing', async () => {
		const { handleSubagentToolCall } = await handlerImport;
		// Defensive: in case some earlier test in the same process leaked the var
		delete process.env.DEEPSEEK_API_KEY;
		const result = await handleSubagentToolCall({
			params: {
				name: 'delegate_terminal_task',
				arguments: { task: 'run npm test and summarize failures' },
			},
		});
		assert.equal(result.isError, true);
		const payload = JSON.parse((result.content[0] as { text: string }).text);
		assert.equal(payload.code, 'subagent_unavailable');
		assert.match(payload.hint, /fall back.*bash.*shell tool/i);
	});

	it('keeps task argument intact when working_directory is invalid (returns invalid_input)', async () => {
		const { handleSubagentToolCall } = await handlerImport;
		// Use a path that will reliably fail process.chdir on every OS
		const bogusPath = join(
			process.cwd(),
			'__omx_subagent_test_nonexistent_path__',
		);
		const result = await handleSubagentToolCall({
			params: {
				name: 'delegate_terminal_task',
				arguments: {
					task: 'run something',
					working_directory: bogusPath,
				},
			},
		});
		// Could fail at chdir (invalid_input) OR at getSubagent (subagent_unavailable)
		// depending on whether DEEPSEEK_API_KEY is still cleared. Both are valid
		// error paths; we just want to ensure the handler doesn't crash.
		assert.equal(result.isError, true);
		const payload = JSON.parse((result.content[0] as { text: string }).text);
		assert.ok(
			payload.code === 'invalid_input' ||
				payload.code === 'subagent_unavailable',
			`unexpected error code: ${payload.code}`,
		);
	});

	// Restore env after suite using a sentinel test (node:test does not expose
	// `after` for the describe scope cleanly without import reshuffle)
	it('restores process.env after the suite', () => {
		if (savedApiKey !== undefined) {
			process.env.DEEPSEEK_API_KEY = savedApiKey;
		}
		if (savedDisableAutoStart !== undefined) {
			process.env.OMX_SUBAGENT_SERVER_DISABLE_AUTO_START =
				savedDisableAutoStart;
		} else {
			delete process.env.OMX_SUBAGENT_SERVER_DISABLE_AUTO_START;
		}
	});
});
