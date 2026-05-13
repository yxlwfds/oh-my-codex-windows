/**
 * IPC protocol for omx-winmux.
 *
 * Wire format: newline-delimited JSON, one message per line, UTF-8.
 * Each request is paired with a response by `id`. `attach-stream` is the
 * single exception — after the initial response it switches to a long-lived
 * stream of `{type:'data'|'closed', ...}` notifications.
 */

export const PROTOCOL_VERSION = 1;

export type RequestAction =
  | "ping"
  | "shutdown"
  | "new-session"
  | "kill-session"
  | "list-sessions"
  | "capture-pane"
  | "write-input"
  | "attach-stream";

export interface BaseRequest<A extends RequestAction, P = unknown> {
  id: number;
  action: A;
  params: P;
}

export interface PingParams {}
export interface ShutdownParams {}
export interface NewSessionParams {
  command: string;
  args: string[];
  cwd: string;
  env?: Record<string, string>;
  cols?: number;
  rows?: number;
  meta?: Record<string, unknown>;
}
export interface KillSessionParams {
  paneId: string;
}
export interface ListSessionsParams {}
export interface CapturePaneParams {
  paneId: string;
  lines: number;
  /** When true, return raw ANSI; defaults true. */
  preserveEscapes?: boolean;
}
export interface WriteInputParams {
  paneId: string;
  /** Base64-encoded bytes to write into the PTY. */
  dataBase64: string;
}
export interface AttachStreamParams {
  paneId: string;
  /** Include up-to-N existing buffered bytes from history on subscribe. */
  prefetchBytes?: number;
}

export type RequestEnvelope =
  | BaseRequest<"ping", PingParams>
  | BaseRequest<"shutdown", ShutdownParams>
  | BaseRequest<"new-session", NewSessionParams>
  | BaseRequest<"kill-session", KillSessionParams>
  | BaseRequest<"list-sessions", ListSessionsParams>
  | BaseRequest<"capture-pane", CapturePaneParams>
  | BaseRequest<"write-input", WriteInputParams>
  | BaseRequest<"attach-stream", AttachStreamParams>;

export interface SessionRecord {
  paneId: string;
  pid: number;
  dead: boolean;
  command: string;
  args: string[];
  cwd: string;
  createdAt: number;
  exitedAt: number | null;
  exitCode: number | null;
  signal: string | null;
}

export interface ResponseOk<T> {
  id: number;
  ok: true;
  data: T;
}
export interface ResponseErr {
  id: number;
  ok: false;
  error: string;
  code?: string;
}
export type ResponseEnvelope<T = unknown> = ResponseOk<T> | ResponseErr;

export interface StreamNotification {
  /** Streamed messages reuse the original request id. */
  id: number;
  stream: "data" | "closed";
  /** Base64-encoded bytes for `stream:'data'`. */
  dataBase64?: string;
  /** Reason string for `stream:'closed'`. */
  reason?: string;
  /** Exit code if the underlying session died. */
  exitCode?: number | null;
}

export type IncomingFromDaemon<T = unknown> =
  | ResponseEnvelope<T>
  | StreamNotification;

export function encodeMessage(msg: unknown): string {
  return `${JSON.stringify(msg)}\n`;
}

/**
 * Split incoming bytes into complete lines plus a leftover tail. The caller is
 * responsible for retaining the tail across reads.
 */
export function chunkToLines(
  pending: string,
  chunk: string,
): { lines: string[]; tail: string } {
  const combined = pending + chunk;
  const newlineIdx = combined.lastIndexOf("\n");
  if (newlineIdx === -1) return { lines: [], tail: combined };
  const head = combined.slice(0, newlineIdx);
  const tail = combined.slice(newlineIdx + 1);
  const lines = head.split("\n").filter((line) => line.length > 0);
  return { lines, tail };
}
