/**
 * Line-delimited JSON framing helpers shared by both ends of the IPC.
 */

import type { Socket } from "net";
import { chunkToLines, encodeMessage } from "./protocol.js";

export interface FramedReader {
  /**
   * Stop receiving frames and forget the buffered tail. Returns immediately;
   * does NOT destroy or end the underlying socket — call sites decide that.
   */
  dispose(): void;
}

/**
 * Attach a line-delimited JSON reader to a socket. Each parsed JSON value is
 * forwarded to `onMessage`. Parse errors invoke `onError` (if provided) but do
 * NOT auto-destroy the socket — that policy belongs to the caller.
 *
 * The returned `dispose` is safe to call any number of times.
 */
export function attachFramedReader(
  socket: Socket,
  onMessage: (msg: unknown) => void,
  onError?: (err: Error, rawLine: string) => void,
): FramedReader {
  let pending = "";
  let disposed = false;

  const handleData = (chunk: Buffer): void => {
    if (disposed) return;
    const { lines, tail } = chunkToLines(pending, chunk.toString("utf-8"));
    pending = tail;
    for (const line of lines) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch (err) {
        if (onError) onError(err as Error, line);
        continue;
      }
      try {
        onMessage(parsed);
      } catch (err) {
        if (onError) onError(err as Error, line);
      }
    }
  };

  const handleClose = (): void => {
    pending = "";
  };

  socket.setEncoding("utf-8");
  socket.on("data", handleData);
  socket.on("close", handleClose);

  return {
    dispose: (): void => {
      if (disposed) return;
      disposed = true;
      socket.removeListener("data", handleData);
      socket.removeListener("close", handleClose);
      pending = "";
    },
  };
}

/**
 * Write a JSON value as one line. Returns the result of `socket.write` so
 * callers can apply backpressure if needed.
 */
export function writeFrame(socket: Socket, value: unknown): boolean {
  return socket.write(encodeMessage(value));
}
