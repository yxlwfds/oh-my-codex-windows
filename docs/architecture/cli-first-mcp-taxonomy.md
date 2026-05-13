# CLI-first MCP taxonomy

Issue #2214 establishes a runtime-support boundary for OMX: **CLI/JSON is the canonical durable runtime and control-plane contract**. MCP remains useful, but it is an optional integration and compatibility layer rather than the authority for stateful orchestration.

This page is intentionally a taxonomy and recovery guide. It does not change setup defaults, remove first-party MCP servers, or deprecate compatibility surfaces by itself.

## Contract levels

| Level | Meaning | Support expectation |
| --- | --- | --- |
| Canonical CLI/JSON | The durable contract for automation, lifecycle control, state mutation, and recovery. | Document first. Keep machine-readable `--json` behavior stable or migrate it deliberately. |
| CLI parity | A CLI command exposes the same durable state or read result as another surface. | Prefer it for scripts and recovery, especially when host integrations fail. |
| MCP integration/compat | Optional host/editor/app integration or compatibility surface backed by OMX behavior. | Useful for convenience and existing workflows, but not the source of lifecycle authority. |
| Deprecated/legacy | A surface retained only for migration or older workflows. | Point users to the canonical CLI/JSON command and avoid new automation against it. |

## Stateful control plane vs. read-only inspection

Stateful lifecycle and mutation surfaces have stricter requirements than read-only inspection because they make decisions that can start, stop, resume, mutate, or recover a runtime.

### Stateful lifecycle and mutation surfaces

These surfaces should have one canonical CLI/JSON owner:

- mode/session state: `owx state ... --json`
- team lifecycle and mutation: `owx team ...` and `owx team api ... --json`
- durable memory writes: `owx notepad ... --json`, `owx project-memory ... --json`, and `owx wiki ... --json`
- trace/runtime event mutation or cleanup paths where supported by the CLI

MCP tools for these areas are compatibility or host-integration surfaces. If MCP transport or process lifecycle fails, retry through the documented CLI/JSON parity command rather than looping on the same MCP call.

### Read-only inspection surfaces

Read-only inspection can remain broader and more convenient:

- trace viewing and summaries
- code-intel diagnostics/search
- wiki reads and project-memory reads
- status or inventory commands

Inspection surfaces may expose both CLI parity and optional MCP integration. They should not be treated as runtime control-plane authority unless the operation mutates state or lifecycle.

## Canonical surface requirements

A surface marked canonical should provide:

1. a stable `owx ...` CLI entrypoint,
2. machine-readable `--json` output for automation,
3. explicit MCP status such as parity, compat, integration, or deprecated,
4. documented fallback guidance for MCP stdio/process failures,
5. clear lifecycle ownership when the command can mutate runtime state.

## Compatibility and recovery matrix

| Area | Operation type | Owner/canonical surface | MCP status | Fallback/parity surface | Recovery guidance |
| --- | --- | --- | --- | --- | --- |
| Team launch/lifecycle | Stateful lifecycle | `owx team ...` | Legacy/compat where applicable | `owx team ...` | Use the CLI launcher as the source of truth; avoid separate MCP runners for lifecycle ownership. |
| Team mutation/read API | Stateful mutation and reads | `owx team api <operation> --input ... --json` | Legacy `team_*` tools are deprecated/compat | Same `owx team api ... --json` operation | When a host tool is stale or unavailable, replay the operation through the CLI JSON API. |
| Mode/session state | Stateful mutation and reads | `owx state read/write/clear --input ... --json` | Compatibility | Same `owx state ... --json` command | If MCP stdio closes or reports transport failure, retry once through CLI parity with the same payload. |
| Notepad | Durable memory mutation/read | `owx notepad ... --json` | Integration/compat | Same `owx notepad ... --json` command | Prefer CLI for durable writes and recovery because it is pasteable and auditable. |
| Project memory | Durable memory mutation/read | `owx project-memory ... --json` | Integration/compat | Same `owx project-memory ... --json` command | Use CLI JSON for automation; MCP may be used by hosts that need inline memory tools. |
| Wiki | Durable knowledge mutation/read | `owx wiki ... --json` | Supported integration with CLI parity | Same `owx wiki ... --json` command | Keep CLI parity documented first for scripts, recovery, and issue reproduction. |
| Trace | Mostly read-only inspection, with CLI-owned cleanup where available | `owx trace ... --json` | Supported integration/compat | Same `owx trace ... --json` command | Treat read-only MCP trace tools as visibility aids; use CLI JSON for durable artifacts and recovery. |
| Code intelligence | Read-only inspection | CLI/code-intel command surfaces where available | Optional integration | CLI diagnostics/search where available | Failures should not affect runtime lifecycle; fall back to CLI or local static checks. |
| Shared MCP registry sync | Setup-time integration config | `owx setup` with explicit MCP compatibility mode/preferences | Optional setup integration | `owx setup --mcp compat` when MCP sync is desired | No-MCP setup mode should omit first-party MCP blocks while preserving user-authored MCP servers. |
| First-party MCP servers | Optional integration | `owx mcp-serve <target>` for explicitly enabled clients | Optional compatibility/integration | Matching CLI/JSON command for durable operations | Keep servers available for opt-in clients; do not make them required for runtime-critical recovery. |

## Setup and migration posture

Current safe sequencing is:

1. document the CLI-first taxonomy and recovery rules,
2. keep setup defaults stable unless a later product decision explicitly changes them,
3. support no-MCP or compatibility profiles with tests before any default flip,
4. update skills/templates/plugin wording after the taxonomy is accepted,
5. only consider fresh-default changes after owner approval, release notes, and compatibility coverage.

This preserves MCP for users and clients that need it while making the durable automation path unambiguous.
