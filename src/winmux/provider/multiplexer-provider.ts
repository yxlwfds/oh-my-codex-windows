/**
 * MultiplexerProvider abstraction.
 *
 * OMX historically shelled out to `tmux` directly via `runTmux`/`execTmux`. To
 * make native Windows (no tmux available) viable, we introduce this abstraction
 * so call sites can keep passing tmux-style argv arrays while the underlying
 * implementation is decided per-platform.
 *
 * Non-Windows: the provider is a thin wrapper around the existing tmux binary.
 * Native Windows: the provider talks to the omx-winmux daemon (`src/winmux/`).
 */

export interface RunOk {
  ok: true;
  stdout: string;
}

export interface RunErr {
  ok: false;
  stderr: string;
}

export type RunResult = RunOk | RunErr;

export interface CapturePaneOptions {
  paneId: string;
  /** number of lines requested (mirrors `tmux capture-pane -S -<n> -E -1 -p -e`) */
  lines: number;
  /** Whether ANSI escape sequences should be preserved (-e). Defaults to true. */
  preserveEscapes?: boolean;
}

export interface SendKeysOptions {
  /** argv after `tmux send-keys` (so callers can pass `['-t', pane, '-l', '--', text]` verbatim) */
  argv: string[];
}

export interface NewSessionOptions {
  /** Shell or program to launch (e.g. cmd.exe). */
  command: string;
  /** Argv list passed to `command` (e.g. ['/c', '<inner>']). */
  args: string[];
  /** Working directory for the spawned process. */
  cwd: string;
  /** Environment vars merged on top of the daemon's own env. */
  env?: Record<string, string>;
  /** PTY columns; defaults to 120. */
  cols?: number;
  /** PTY rows; defaults to 30. */
  rows?: number;
  /** Optional metadata recorded on the session record. */
  meta?: Record<string, unknown>;
}

export interface MultiplexerPaneInfo {
  paneId: string;
  /** PID of the entry process inside the PTY (cmd.exe / shell). */
  pid: number;
  /** Whether the session has exited. */
  dead: boolean;
  /** Command line shown for diagnostics. */
  startCommand: string;
  /** Current command (best-effort; same as startCommand for winmux). */
  currentCommand: string;
}

/**
 * Generic multiplexer abstraction. Provider implementations MUST:
 * - Surface failures via `RunErr` rather than throwing, when possible.
 * - Treat unknown tmux args in `run()` as soft no-ops on Windows (return ok).
 */
export interface MultiplexerProvider {
  /** Name used in diagnostics: 'tmux' | 'winmux'. */
  readonly name: string;

  /** Probe whether the underlying multiplexer is functional. */
  isAvailable(): boolean;

  /**
   * Catch-all tmux invocation. Caller passes the argv that would have followed
   * `tmux`. The provider decides how to dispatch.
   */
  run(args: string[]): RunResult;

  /**
   * High-level API. Provider implementations may delegate to `run` internally
   * (TmuxProvider does); winmux uses these as the primary path so it can reach
   * the daemon over IPC without re-parsing argv.
   */
  newSession(opts: NewSessionOptions): { paneId: string };

  capturePane(opts: CapturePaneOptions): RunResult;

  sendKeys(opts: SendKeysOptions): RunResult;

  killPane(paneId: string): RunResult;

  listPanes(target?: string): MultiplexerPaneInfo[];

  listSessions(): string[];
}

export class MultiplexerUnavailableError extends Error {
  constructor(public readonly provider: string, message: string) {
    super(message);
    this.name = "MultiplexerUnavailableError";
  }
}

export class MultiplexerOperationError extends Error {
  constructor(public readonly provider: string, message: string) {
    super(message);
    this.name = "MultiplexerOperationError";
  }
}
