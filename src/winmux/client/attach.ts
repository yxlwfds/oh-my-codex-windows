/**
 * Read-only attach: open a long-lived pipe connection, ask the daemon to
 * subscribe us to a session's output, and stream every received chunk to
 * stdout.
 *
 * Lifecycle:
 *   - On Ctrl+C / SIGINT / SIGTERM we destroy the socket. The daemon's
 *     SessionManager already wires `socket.once('close')` -> remove from
 *     subscribers, so no further bytes are sent and no per-pane state leaks.
 *   - When the daemon-side session exits, we receive `stream:'closed'` and
 *     return normally with the session's exit code (or 0 if unknown).
 */

import { createConnection, type Socket } from "net";
import { attachFramedReader, writeFrame } from "../ipc/framing.js";
import { allocateRequestId } from "./rpc.js";
import { pipeName } from "../ipc/pipe-paths.js";
import {
  PROTOCOL_VERSION,
  type ResponseEnvelope,
  type StreamNotification,
} from "../ipc/protocol.js";

export interface AttachOptions {
  paneId: string;
  pipe?: string;
  env?: NodeJS.ProcessEnv;
  /** When set, include up to N bytes of the buffered history on attach. */
  prefetchBytes?: number;
  /** Where to write streamed bytes. Defaults to process.stdout. */
  out?: NodeJS.WritableStream;
  /** Where to write status lines. Defaults to process.stderr. */
  status?: NodeJS.WritableStream;
}

export interface AttachResult {
  exitCode: number;
  reason: string;
}

export function runAttach(options: AttachOptions): Promise<AttachResult> {
  const env = options.env ?? process.env;
  const pipe = options.pipe ?? pipeName(env);
  const out = options.out ?? process.stdout;
  const status = options.status ?? process.stderr;
  const prefetch = options.prefetchBytes ?? 4096;

  return new Promise<AttachResult>((resolve) => {
    let socket: Socket | null = null;
    let reader: { dispose(): void } | null = null;
    let settled = false;
    const requestId = allocateRequestId();

    const cleanup = (): void => {
      if (reader) {
        reader.dispose();
        reader = null;
      }
      if (socket) {
        socket.removeAllListeners("error");
        socket.removeAllListeners("close");
        if (!socket.destroyed) socket.destroy();
        socket = null;
      }
      process.removeListener("SIGINT", onSignal);
      process.removeListener("SIGTERM", onSignal);
    };

    const finish = (result: AttachResult): void => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(result);
    };

    const onSignal = (): void => {
      status.write("\n[omx-winmux attach: detaching]\n");
      finish({ exitCode: 0, reason: "signal" });
    };
    process.once("SIGINT", onSignal);
    process.once("SIGTERM", onSignal);

    try {
      socket = createConnection(pipe);
    } catch (err) {
      status.write(`[omx-winmux attach: failed to open pipe ${pipe}: ${(err as Error).message}]\n`);
      finish({ exitCode: 1, reason: "pipe-open-failed" });
      return;
    }

    socket.once("connect", () => {
      try {
        writeFrame(socket!, {
          id: requestId,
          action: "attach-stream",
          params: { paneId: options.paneId, prefetchBytes: prefetch },
          protocol: PROTOCOL_VERSION,
        });
      } catch (err) {
        status.write(`[omx-winmux attach: write failed: ${(err as Error).message}]\n`);
        finish({ exitCode: 1, reason: "pipe-write-failed" });
      }
    });

    socket.once("error", (err) => {
      status.write(`[omx-winmux attach: pipe error: ${(err as Error).message}]\n`);
      finish({ exitCode: 1, reason: "pipe-error" });
    });
    socket.once("close", () => {
      finish({ exitCode: 0, reason: "pipe-closed" });
    });

    reader = attachFramedReader(socket, (msg) => {
      // Both ResponseEnvelope and StreamNotification share `id`.
      const envelope = msg as ResponseEnvelope<unknown> | StreamNotification;
      if (envelope.id !== requestId) return;

      if ("ok" in envelope) {
        if (!envelope.ok) {
          status.write(`[omx-winmux attach: subscribe failed: ${envelope.error}]\n`);
          finish({ exitCode: 1, reason: "subscribe-failed" });
        }
        return;
      }
      const note = envelope as StreamNotification;
      if (note.stream === "data" && note.dataBase64) {
        const chunk = Buffer.from(note.dataBase64, "base64");
        out.write(chunk);
        return;
      }
      if (note.stream === "closed") {
        status.write(`\n[omx-winmux attach: session closed (${note.reason ?? "unknown"})]\n`);
        finish({ exitCode: note.exitCode ?? 0, reason: note.reason ?? "session-closed" });
      }
    });
  });
}
