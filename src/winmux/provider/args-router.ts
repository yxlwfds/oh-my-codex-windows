/**
 * Translates legacy `tmux <argv>` invocations into the structured operations
 * that WinMuxProvider knows how to perform. Commands that have no Windows
 * analog (set-option, set-hook, select-layout, ...) are intentionally
 * categorised as no-op so the existing OMX flow keeps running unchanged.
 */

export type TmuxArgsAction =
  | { kind: "noop"; stdout?: string }
  | { kind: "version" }
  | { kind: "list-panes"; target?: string; format?: string }
  | { kind: "list-sessions"; format?: string }
  | { kind: "display-message"; target?: string; format: string }
  | { kind: "split-window"; cwd?: string; command: string; printFormat?: string }
  | { kind: "kill-pane"; target: string }
  | { kind: "capture-pane"; target?: string; lines: number; preserveEscapes: boolean }
  | { kind: "send-keys"; target: string; literal: boolean; text: string; keys: string[] }
  | { kind: "unknown" };

const NOOP_COMMANDS = new Set([
  "set-option",
  "set-window-option",
  "set-hook",
  "select-layout",
  "select-pane",
  "select-window",
  "rename-window",
  "rename-session",
  "kill-server",
  "show-options",
  "show-window-options",
  "show-hooks",
  "run-shell",
  "if-shell",
  "bind-key",
  "unbind-key",
  "source-file",
  "switch-client",
  "set-environment",
  "resize-pane",
  "resize-window",
  "respawn-pane",
  "swap-pane",
  "next-window",
  "previous-window",
  "new-window",
  "kill-window",
  "kill-session",
  "attach-session",
  "detach-client",
  "refresh-client",
  "wait-for",
]);

function takeValueAfterFlag(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  if (idx === -1 || idx + 1 >= args.length) return undefined;
  return args[idx + 1];
}

function parseLinesFromCapture(args: string[]): number {
  // tmux uses `-S -<n>` to specify start line; we treat the absolute value as
  // "approximately N lines from the bottom".
  const startIdx = args.indexOf("-S");
  if (startIdx !== -1 && startIdx + 1 < args.length) {
    const raw = args[startIdx + 1] ?? "";
    const n = Number.parseInt(raw, 10);
    if (Number.isFinite(n)) return Math.abs(n);
  }
  return 200;
}

export function classifyTmuxArgs(args: string[]): TmuxArgsAction {
  if (args.length === 0) return { kind: "noop" };
  const head = args[0]!;

  if (head === "-V") return { kind: "version" };

  if (NOOP_COMMANDS.has(head)) return { kind: "noop" };

  if (head === "list-panes") {
    return {
      kind: "list-panes",
      target: takeValueAfterFlag(args, "-t"),
      format: takeValueAfterFlag(args, "-F"),
    };
  }

  if (head === "list-sessions") {
    return {
      kind: "list-sessions",
      format: takeValueAfterFlag(args, "-F"),
    };
  }

  if (head === "display-message") {
    // OMX passes `display-message -p [-t target] <fmt>`; fmt is the LAST positional.
    const target = takeValueAfterFlag(args, "-t");
    const fmt = args[args.length - 1] ?? "";
    return { kind: "display-message", target, format: fmt };
  }

  if (head === "split-window") {
    // OMX invocation pattern:
    //   tmux split-window <-h|-v> [-f] [-l N] -t <target> -d -P -F '#{pane_id}' -c <cwd> <command>
    // The trailing positional after the last flag pair is the shell command.
    const cwd = takeValueAfterFlag(args, "-c");
    const printFormat = takeValueAfterFlag(args, "-F");
    const command = args[args.length - 1] ?? "";
    return { kind: "split-window", cwd, command, printFormat };
  }

  if (head === "kill-pane") {
    const target = takeValueAfterFlag(args, "-t") ?? "";
    return { kind: "kill-pane", target };
  }

  if (head === "capture-pane") {
    const target = takeValueAfterFlag(args, "-t");
    const preserveEscapes = args.includes("-e");
    return {
      kind: "capture-pane",
      target,
      lines: parseLinesFromCapture(args),
      preserveEscapes,
    };
  }

  if (head === "send-keys") {
    const target = takeValueAfterFlag(args, "-t") ?? "";
    const literal = args.includes("-l");
    // Tokens after the position-defining flag set are the payload.
    // OMX builds two distinct shapes:
    //   ['send-keys', '-t', pane, '-l', '--', text]
    //   ['send-keys', '-t', pane, 'C-m']
    const dashDashIdx = args.indexOf("--");
    const text = literal && dashDashIdx !== -1 ? args.slice(dashDashIdx + 1).join(" ") : "";
    const keys: string[] = [];
    if (!literal) {
      for (let i = 1; i < args.length; i++) {
        const tok = args[i]!;
        if (tok === "-t") {
          i++;
          continue;
        }
        if (tok.startsWith("-")) continue;
        keys.push(tok);
      }
    }
    return { kind: "send-keys", target, literal, text, keys };
  }

  return { kind: "unknown" };
}

/**
 * Convert tmux send-keys "key names" (C-m, C-c, etc.) into the byte stream
 * that should actually be written into the PTY. Currently only Ctrl-Letter
 * sequences are recognised, matching everything OMX emits today.
 */
export function keyTokenToBytes(token: string): Buffer | null {
  if (token === "C-m") return Buffer.from([0x0d]);
  if (token === "C-j") return Buffer.from([0x0a]);
  if (token === "Enter") return Buffer.from([0x0d]);
  if (token === "Space") return Buffer.from([0x20]);
  if (token === "Tab") return Buffer.from([0x09]);
  if (token === "Escape") return Buffer.from([0x1b]);
  if (/^C-[a-z]$/i.test(token)) {
    const letter = token.slice(2).toLowerCase().charCodeAt(0);
    // Ctrl-A = 1, Ctrl-Z = 26
    return Buffer.from([letter - 0x60]);
  }
  return null;
}
