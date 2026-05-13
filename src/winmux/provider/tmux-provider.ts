/**
 * TmuxProvider: forwards every multiplexer call to the real `tmux` binary
 * (or a tmux-compatible binary discoverable via `resolveTmuxBinaryForPlatform`).
 *
 * Behaviour MUST match the historical `runTmux(args)` in
 * `src/team/tmux-session.ts` byte-for-byte; non-Windows users see zero change.
 */

import { spawnPlatformCommandSync } from "../../utils/platform-command.js";
import type {
  CapturePaneOptions,
  MultiplexerPaneInfo,
  MultiplexerProvider,
  NewSessionOptions,
  RunResult,
  SendKeysOptions,
} from "./multiplexer-provider.js";
import { MultiplexerOperationError } from "./multiplexer-provider.js";

export class TmuxProvider implements MultiplexerProvider {
  readonly name = "tmux" as const;

  isAvailable(): boolean {
    const { result } = spawnPlatformCommandSync("tmux", ["-V"], {
      encoding: "utf-8",
    });
    if (result.error) return false;
    return result.status === 0;
  }

  run(args: string[]): RunResult {
    const { result } = spawnPlatformCommandSync("tmux", args, {
      encoding: "utf-8",
    });
    if (result.error) {
      return { ok: false, stderr: result.error.message };
    }
    if (result.status !== 0) {
      return {
        ok: false,
        stderr: (result.stderr || "").trim() || `tmux exited ${result.status}`,
      };
    }
    return { ok: true, stdout: (result.stdout || "").trim() };
  }

  newSession(_opts: NewSessionOptions): { paneId: string } {
    // OMX has its own multi-step `createTeamSession` that drives split-window
    // directly through `runTmux`. TmuxProvider therefore never needs a
    // high-level newSession path; throwing here surfaces accidental misuse.
    throw new MultiplexerOperationError(
      this.name,
      "TmuxProvider.newSession is not used; call run(['split-window', ...]) instead.",
    );
  }

  capturePane(opts: CapturePaneOptions): RunResult {
    const argv = ["capture-pane", "-p", "-J"];
    if (opts.preserveEscapes !== false) argv.push("-e");
    argv.push("-S", `-${Math.max(1, Math.trunc(opts.lines))}`);
    argv.push("-t", opts.paneId);
    return this.run(argv);
  }

  sendKeys(opts: SendKeysOptions): RunResult {
    return this.run(["send-keys", ...opts.argv]);
  }

  killPane(paneId: string): RunResult {
    return this.run(["kill-pane", "-t", paneId]);
  }

  listPanes(target?: string): MultiplexerPaneInfo[] {
    const argv = ["list-panes"];
    if (target) argv.push("-t", target);
    argv.push("-F", "#{pane_id} #{pane_pid} #{pane_dead} #{pane_current_command} #{pane_start_command}");
    const result = this.run(argv);
    if (!result.ok) return [];
    const out: MultiplexerPaneInfo[] = [];
    for (const line of result.stdout.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const [paneId, pidRaw, deadRaw, currentCommand = "", ...startTokens] = trimmed.split(" ");
      if (!paneId || !paneId.startsWith("%")) continue;
      const pid = Number.parseInt(pidRaw ?? "", 10);
      out.push({
        paneId,
        pid: Number.isFinite(pid) ? pid : -1,
        dead: deadRaw === "1",
        currentCommand,
        startCommand: startTokens.join(" "),
      });
    }
    return out;
  }

  listSessions(): string[] {
    const result = this.run(["list-sessions", "-F", "#{session_name}"]);
    if (!result.ok) return [];
    return result.stdout
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
  }
}
