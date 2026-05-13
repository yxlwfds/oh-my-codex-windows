/**
 * WinMuxProvider: routes legacy `tmux <argv>` calls through the omx-winmux
 * daemon via a synchronous IPC bridge (worker thread + Atomics).
 *
 * The provider tries to ensure the daemon is alive on first use; failures are
 * cached briefly so subsequent calls in the same OMX run don't retry endlessly
 * but the next invocation of OMX gets a fresh attempt. No fallback to tmux:
 * if the daemon is unreachable the caller learns about it via `RunErr`.
 */

import { classifyTmuxArgs, keyTokenToBytes } from "./args-router.js";
import {
  MultiplexerOperationError,
  type CapturePaneOptions,
  type MultiplexerPaneInfo,
  type MultiplexerProvider,
  type NewSessionOptions,
  type RunResult,
  type SendKeysOptions,
} from "./multiplexer-provider.js";
import { syncRpc, type SyncRpcResult } from "../client/sync-rpc.js";
import type { SessionRecord } from "../ipc/protocol.js";

const DAEMON_VERSION_STRING = "omx-winmux 0.1.0";

function fromSyncResult<T>(result: SyncRpcResult<T>): RunResult {
  // `tmux <cmd>` traditionally prints nothing on success (success is signalled
  // by exit code). Many OMX call sites parse stdout in non-strict ways, so we
  // mirror that contract: empty stdout on success unless the caller asked for
  // data (capture-pane / display-message / split-window handle their own
  // stdout shape directly).
  if (result.ok) return { ok: true, stdout: "" };
  return { ok: false, stderr: result.error ?? "winmux RPC failed" };
}

function asSession(rec: SessionRecord): MultiplexerPaneInfo {
  return {
    paneId: rec.paneId,
    pid: rec.pid,
    dead: rec.dead,
    startCommand: rec.command,
    currentCommand: rec.command,
  };
}

export class WinMuxProvider implements MultiplexerProvider {
  readonly name = "winmux" as const;

  private lastAvailabilityCheck = 0;
  private lastAvailabilityResult = false;

  isAvailable(): boolean {
    const now = Date.now();
    if (now - this.lastAvailabilityCheck < 2000) return this.lastAvailabilityResult;
    this.lastAvailabilityCheck = now;
    const result = syncRpc("ping", {}, { timeoutMs: 1500 });
    this.lastAvailabilityResult = result.ok;
    return this.lastAvailabilityResult;
  }

  run(args: string[]): RunResult {
    const action = classifyTmuxArgs(args);
    switch (action.kind) {
      case "version":
        return { ok: true, stdout: DAEMON_VERSION_STRING };

      case "noop":
        return { ok: true, stdout: action.stdout ?? "" };

      case "list-panes": {
        const result = syncRpc<{ sessions: SessionRecord[] }>("list-sessions", {});
        if (!result.ok || !result.data) {
          return { ok: false, stderr: result.error ?? "list-sessions failed" };
        }
        const fmt = action.format ?? "#{pane_id} #{pane_pid} #{pane_dead} #{pane_current_command} #{pane_start_command}";
        const lines = result.data.sessions.map((s) => formatPane(fmt, s));
        return { ok: true, stdout: lines.join("\n") };
      }

      case "list-sessions": {
        const result = syncRpc<{ sessions: SessionRecord[] }>("list-sessions", {});
        if (!result.ok || !result.data) {
          return { ok: false, stderr: result.error ?? "list-sessions failed" };
        }
        const fmt = action.format ?? "#{session_name}";
        if (fmt === "#{session_name}") {
          // OMX's expected output: one session name per line. We have a flat
          // pane namespace; render an "omx" sentinel session.
          const names = result.data.sessions.length > 0 ? ["omx"] : [];
          return { ok: true, stdout: names.join("\n") };
        }
        return { ok: true, stdout: "" };
      }

      case "display-message": {
        // Most OMX uses are `display-message -p '#S:#I #{pane_id}'`. We
        // synthesize a stable answer that satisfies downstream parsing.
        const pane = action.target ?? "%0";
        const fmt = action.format ?? "";
        const rendered = fmt
          .replace(/#\{pane_id\}/g, pane)
          .replace(/#S/g, "omx")
          .replace(/#I/g, "0")
          .replace(/#\{window_width\}/g, "200");
        return { ok: true, stdout: rendered };
      }

      case "split-window": {
        if (!action.command) {
          return { ok: false, stderr: "split-window requires a trailing command" };
        }
        return this.runShellCommandAsSession(action.command, action.cwd, action.printFormat);
      }

      case "kill-pane": {
        const result = syncRpc("kill-session", { paneId: action.target });
        return fromSyncResult(result);
      }

      case "capture-pane": {
        if (!action.target) return { ok: false, stderr: "capture-pane requires -t" };
        const result = syncRpc<{ data: string }>("capture-pane", {
          paneId: action.target,
          lines: action.lines,
          preserveEscapes: action.preserveEscapes,
        });
        if (!result.ok || !result.data) {
          return { ok: false, stderr: result.error ?? "capture-pane failed" };
        }
        return { ok: true, stdout: result.data.data };
      }

      case "send-keys": {
        const bytes = synthesizeSendKeysBytes(action);
        if (!bytes) return { ok: true, stdout: "" };
        const result = syncRpc("write-input", {
          paneId: action.target,
          dataBase64: bytes.toString("base64"),
        });
        return fromSyncResult(result);
      }

      case "unknown":
      default:
        // Unknown tmux command; conservatively succeed so OMX keeps moving,
        // matching real tmux's tolerant behavior for read-only queries.
        return { ok: true, stdout: "" };
    }
  }

  private runShellCommandAsSession(
    command: string,
    cwd: string | undefined,
    _printFormat: string | undefined,
  ): RunResult {
    const result = syncRpc<{ session: SessionRecord }>("new-session", {
      command: "cmd.exe",
      args: ["/d", "/s", "/c", command],
      cwd: cwd ?? process.cwd(),
      env: {},
      cols: 200,
      rows: 50,
    });
    if (!result.ok || !result.data) {
      return { ok: false, stderr: result.error ?? "new-session failed" };
    }
    return { ok: true, stdout: result.data.session.paneId };
  }

  newSession(opts: NewSessionOptions): { paneId: string } {
    const result = syncRpc<{ session: SessionRecord }>("new-session", {
      command: opts.command,
      args: opts.args,
      cwd: opts.cwd,
      env: opts.env ?? {},
      cols: opts.cols ?? 120,
      rows: opts.rows ?? 30,
      meta: opts.meta,
    });
    if (!result.ok || !result.data) {
      throw new MultiplexerOperationError(this.name, result.error ?? "new-session failed");
    }
    return { paneId: result.data.session.paneId };
  }

  capturePane(opts: CapturePaneOptions): RunResult {
    const result = syncRpc<{ data: string }>("capture-pane", {
      paneId: opts.paneId,
      lines: opts.lines,
      preserveEscapes: opts.preserveEscapes ?? true,
    });
    if (!result.ok || !result.data) {
      return { ok: false, stderr: result.error ?? "capture-pane failed" };
    }
    return { ok: true, stdout: result.data.data };
  }

  sendKeys(opts: SendKeysOptions): RunResult {
    return this.run(["send-keys", ...opts.argv]);
  }

  killPane(paneId: string): RunResult {
    const result = syncRpc("kill-session", { paneId });
    return fromSyncResult(result);
  }

  listPanes(_target?: string): MultiplexerPaneInfo[] {
    const result = syncRpc<{ sessions: SessionRecord[] }>("list-sessions", {});
    if (!result.ok || !result.data) return [];
    return result.data.sessions.map(asSession);
  }

  listSessions(): string[] {
    const result = syncRpc<{ sessions: SessionRecord[] }>("list-sessions", {});
    if (!result.ok || !result.data) return [];
    return result.data.sessions.length > 0 ? ["omx"] : [];
  }
}

function formatPane(fmt: string, rec: SessionRecord): string {
  return fmt
    .replace(/#\{pane_id\}/g, rec.paneId)
    .replace(/#\{pane_pid\}/g, String(rec.pid))
    .replace(/#\{pane_dead\}/g, rec.dead ? "1" : "0")
    .replace(/#\{pane_current_command\}/g, rec.command)
    .replace(/#\{pane_start_command\}/g, rec.command);
}

function synthesizeSendKeysBytes(action: Extract<ReturnType<typeof classifyTmuxArgs>, { kind: "send-keys" }>): Buffer | null {
  if (action.literal) {
    if (!action.text) return null;
    return Buffer.from(action.text, "utf-8");
  }
  const parts: Buffer[] = [];
  for (const key of action.keys) {
    const bytes = keyTokenToBytes(key);
    if (bytes) parts.push(bytes);
  }
  if (parts.length === 0) return null;
  return Buffer.concat(parts);
}
