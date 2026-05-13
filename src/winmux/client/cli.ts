/**
 * Subcommand dispatcher behind the standalone `owx ...` CLI.
 *
 * Supported verbs:
 *   start          - explicitly spawn the daemon if not already running
 *   stop           - send shutdown to the daemon
 *   status         - print daemon pid, pipe path, session count
 *   ls             - list active sessions (paneId, pid, cmd, dead flag)
 *   capture <id>   - print most recent N lines from a session
 *   attach <id>    - read-only stream of a session's PTY output
 *   daemon         - internal: run as the daemon process (no auto-spawn)
 */

import { existsSync, readFileSync } from "fs";
import { ensureDaemonRunning, WinMuxUnavailableError } from "./ensure-daemon.js";
import { lockfilePath, pipeName, stateDir, logFilePath } from "../ipc/pipe-paths.js";
import { sendRequest } from "./rpc.js";
import { runAttach } from "./attach.js";
import { resolveDaemonEntryPath } from "../paths.js";
import type { SessionRecord } from "../ipc/protocol.js";

function printHelp(out: NodeJS.WritableStream): void {
  out.write(
    [
      "Usage: owx <subcommand> [args]",
      "",
      "winmux daemon subcommands:",
      "  start             Ensure the omx-winmux daemon is running",
      "  stop              Ask the daemon to shut down gracefully",
      "  status            Show daemon pid / pipe path / active sessions",
      "  ls                List active sessions",
      "  capture <pane>    Print recent lines from a pane (N via --lines)",
      "  attach <pane>     Stream a pane's output (read-only; Ctrl+C to detach)",
      "",
      "Anything else is forwarded to `omx` (zero-arg `owx` launches the same",
      "interactive Codex experience as `omx`). Run `owx help` to see the full",
      "merged help including all omx subcommands.",
      "",
      "Environment overrides:",
      "  OMX_WINMUX_PIPE         Override the named pipe path",
      "  OMX_WINMUX_STATE_DIR    Override the state/lockfile directory",
      "  OMX_WINMUX_DAEMON_ENTRY Path to dist/winmux/daemon/index.js",
      "",
    ].join("\n"),
  );
}

export async function winmuxCli(args: string[]): Promise<number> {
  const verb = (args[0] ?? "").toLowerCase();
  switch (verb) {
    case "":
    case "help":
    case "--help":
    case "-h":
      printHelp(process.stdout);
      return 0;

    case "daemon": {
      // Internal: run the daemon entry directly (used by start/auto-spawn paths
      // when the consumer wants to keep the process attached for debugging).
      const entry = resolveDaemonEntryPath();
      if (!entry) {
        process.stderr.write(
          "owx daemon: cannot resolve daemon entry. Build the project with `npm run build`.\n",
        );
        return 1;
      }
      await import(entry);
      // The daemon installs lifecycle handlers and stays alive; we never reach
      // the return below in practice (process.exit is invoked by lifecycle).
      return 0;
    }

    case "start": {
      try {
        const handshake = await ensureDaemonRunning({ timeoutMs: 8000 });
        process.stdout.write(
          `owx: daemon pid=${handshake.pid} started=${new Date(handshake.startedAt).toISOString()}\n`,
        );
        return 0;
      } catch (err) {
        process.stderr.write(`owx start: ${(err as Error).message}\n`);
        return 1;
      }
    }

    case "stop": {
      const r = await sendRequest({ action: "shutdown", params: {} });
      if (!r.ok) {
        process.stderr.write(`owx stop: ${r.error}\n`);
        return r.code === "EPIPE_OPEN" ? 0 : 1;
      }
      process.stdout.write("owx: shutdown acknowledged\n");
      return 0;
    }

    case "status": {
      const pipe = pipeName();
      const lock = lockfilePath();
      let lockInfo: { pid?: number; pipe?: string; startedAt?: number } | null = null;
      if (existsSync(lock)) {
        try {
          lockInfo = JSON.parse(readFileSync(lock, "utf-8"));
        } catch {
          lockInfo = null;
        }
      }
      let live: { pid: number; version: number; startedAt: number } | null = null;
      const ping = await sendRequest<{ pid: number; version: number; startedAt: number }>({
        action: "ping",
        params: {},
        options: { timeoutMs: 1500 },
      });
      if (ping.ok) live = ping.data;
      let sessionCount = 0;
      if (live) {
        const ls = await sendRequest<{ sessions: SessionRecord[] }>({
          action: "list-sessions",
          params: {},
          options: { timeoutMs: 1500 },
        });
        if (ls.ok) sessionCount = ls.data.sessions.length;
      }
      process.stdout.write(
        [
          `pipe       : ${pipe}`,
          `state dir  : ${stateDir()}`,
          `lockfile   : ${lock}${lockInfo ? ` (pid=${lockInfo.pid})` : " (missing)"}`,
          `log        : ${logFilePath()}`,
          live
            ? `daemon     : RUNNING pid=${live.pid} protocol=${live.version}`
            : "daemon     : NOT RUNNING (start with `owx start`)",
          `sessions   : ${sessionCount}`,
          "",
        ].join("\n"),
      );
      return live ? 0 : 1;
    }

    case "ls": {
      const r = await sendRequest<{ sessions: SessionRecord[] }>({
        action: "list-sessions",
        params: {},
      });
      if (!r.ok) {
        process.stderr.write(`owx ls: ${r.error}\n`);
        return 1;
      }
      if (r.data.sessions.length === 0) {
        process.stdout.write("(no sessions)\n");
        return 0;
      }
      process.stdout.write(
        ["paneId  pid     dead  cmd", ...r.data.sessions.map((s) => formatSession(s))].join("\n") + "\n",
      );
      return 0;
    }

    case "capture": {
      const paneId = args[1];
      if (!paneId) {
        process.stderr.write("owx capture: missing <paneId>\n");
        return 1;
      }
      const linesArg = takeFlag(args.slice(2), "--lines");
      const lines = linesArg ? Number.parseInt(linesArg, 10) : 200;
      const r = await sendRequest<{ data: string }>({
        action: "capture-pane",
        params: { paneId, lines: Number.isFinite(lines) ? lines : 200 },
      });
      if (!r.ok) {
        process.stderr.write(`owx capture: ${r.error}\n`);
        return 1;
      }
      process.stdout.write(r.data.data);
      if (!r.data.data.endsWith("\n")) process.stdout.write("\n");
      return 0;
    }

    case "attach": {
      const paneId = args[1];
      if (!paneId) {
        process.stderr.write("owx attach: missing <paneId>\n");
        return 1;
      }
      try {
        await ensureDaemonRunning({ timeoutMs: 5000, noSpawn: false });
      } catch (err) {
        if (err instanceof WinMuxUnavailableError) {
          process.stderr.write(`owx attach: ${err.message}\n`);
          return 1;
        }
        throw err;
      }
      const result = await runAttach({ paneId });
      return result.exitCode;
    }

    default:
      printHelp(process.stderr);
      return 1;
  }
}

function formatSession(s: SessionRecord): string {
  const cmd = `${s.command} ${s.args.join(" ")}`.trim();
  return `${s.paneId.padEnd(7)} ${String(s.pid).padEnd(7)} ${s.dead ? "yes " : "no  "} ${cmd}`;
}

function takeFlag(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  if (idx === -1) return undefined;
  return args[idx + 1];
}
