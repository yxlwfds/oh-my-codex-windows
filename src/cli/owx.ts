#!/usr/bin/env node

/**
 * `owx` — Windows-friendly entry point for oh-my-codex.
 *
 * Behavioural parity with the shared main CLI:
 *   - Zero-arg `owx` launches the same interactive Codex experience.
 *   - Any shared CLI subcommand (`exec`, `setup`, `team`, ...) is forwarded verbatim.
 *   - On native Windows the underlying OMX code automatically routes tmux
 *     calls through `WinMuxProvider`, so `owx` is the natural Windows alias.
 *
 * Plus winmux-specific verbs handled here (not exposed as a nested shared-CLI command):
 *   start | stop | status | ls | capture <pane> | attach <pane> | daemon
 *
 * Routing rules (argv[0] after slicing off `node owx.js`):
 *   - In `WINMUX_VERBS`        → forward to `winmuxCli` (daemon RPC client).
 *   - In `HELP_VERBS`          → print the winmux subcommand summary and then
 *                                fall through to the shared CLI help so the user sees
 *                                a single unified surface.
 *   - Anything else (incl. "") → forward to the shared compiled main.
 *
 * The two collisions with the shared CLI verbs are intentionally resolved in favour
 * of winmux semantics inside `owx`: in this entry the user is opting into the
 * Windows multiplexer surface, so:
 *   - `owx status` = daemon status   (use the shared `status` command for runtime status)
 *   - `owx help`   = merged help     (winmux verbs + full shared CLI help)
 */

import { fileURLToPath, pathToFileURL } from "url";
import { dirname, join } from "path";
import { existsSync } from "fs";
import { rememberOmxLaunchContext } from "../utils/paths.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const root = join(__dirname, "..", "..");

// Mirror the shared CLI entry so OMX path resolution treats `owx` launches identically.
rememberOmxLaunchContext();

const args = process.argv.slice(2);
const verb = (args[0] ?? "").toLowerCase();

const WINMUX_VERBS = new Set([
  "start",
  "stop",
  "status",
  "ls",
  "capture",
  "attach",
  "daemon",
]);
const HELP_VERBS = new Set(["help", "--help", "-h"]);

const distOmxEntry = join(root, "dist", "cli", "index.js");
const distWinmuxCli = join(root, "dist", "winmux", "client", "cli.js");

function bail(missing: string): never {
  console.error('owx: dist build missing — run "npm run build" first');
  console.error(`  expected: ${missing}`);
  process.exit(1);
}

async function dispatchToOmxMain(): Promise<void> {
  if (!existsSync(distOmxEntry)) bail(distOmxEntry);
  const { main } = (await import(pathToFileURL(distOmxEntry).href)) as {
    main: (a: string[]) => Promise<void>;
  };
  await main(args);
  // Match the shared CLI entry: `mcp-serve` keeps the event loop alive on purpose; for
  // every other invocation we exit deterministically with the recorded code.
  if (args[0] !== "mcp-serve") {
    process.exit(process.exitCode ?? 0);
  }
}

async function dispatchToWinmuxCli(): Promise<number> {
  if (!existsSync(distWinmuxCli)) bail(distWinmuxCli);
  const { winmuxCli } = (await import(pathToFileURL(distWinmuxCli).href)) as {
    winmuxCli: (a: string[]) => Promise<number>;
  };
  return winmuxCli(args);
}

function printOwxHelpPrefix(): void {
  process.stdout.write(
    [
      "owx — Windows entry for oh-my-codex (Windows-first CLI alias + winmux daemon mgmt)",
      "",
      "winmux daemon subcommands (handled by owx itself):",
      "  owx start             Ensure the Windows mux daemon is running",
      "  owx stop              Ask the daemon to shut down gracefully",
      "  owx status            Show daemon pid / pipe path / active sessions",
      "  owx ls                List active sessions",
      "  owx capture <pane>    Print recent lines from a pane (--lines N)",
      "  owx attach <pane>     Stream a pane's output (read-only; Ctrl+C detaches)",
      "",
      "All other arguments are forwarded through the shared main CLI. Examples:",
      "  owx                   Launch interactive Codex",
      "  owx exec ...          Run exec through the shared CLI",
      "  owx setup             Run setup through the shared CLI",
      "",
      "── owx full help ──────────────────────────────────────────────",
      "",
    ].join("\n"),
  );
}

if (HELP_VERBS.has(verb)) {
  printOwxHelpPrefix();
  // Whatever help token the user typed (`help`, `--help`, `-h`) is already
  // recognised by the shared main, so forwarding `args` unchanged renders the
  // full shared help right after our prefix.
  await dispatchToOmxMain();
} else if (WINMUX_VERBS.has(verb)) {
  const code = await dispatchToWinmuxCli();
  process.exit(code);
} else {
  await dispatchToOmxMain();
}
