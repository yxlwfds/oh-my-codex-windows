/**
 * Short-lived RPC client used for one-shot daemon requests (everything except
 * attach-stream).
 *
 * Each call opens a fresh named-pipe connection, writes a single JSON frame,
 * waits for the matching response, and tears the socket down. Lifecycle is
 * strictly bounded by `timeoutMs` (default 5s); a timeout destroys the socket
 * to guarantee no leaked listeners or open handles.
 */

import { createConnection, type Socket } from "net";
import { attachFramedReader } from "../ipc/framing.js";
import { pipeName } from "../ipc/pipe-paths.js";
import {
  PROTOCOL_VERSION,
  encodeMessage,
  type RequestEnvelope,
  type ResponseEnvelope,
} from "../ipc/protocol.js";

export interface RpcOptions {
  pipe?: string;
  timeoutMs?: number;
  env?: NodeJS.ProcessEnv;
}

export interface RpcSuccess<T> {
  ok: true;
  data: T;
}
export interface RpcFailure {
  ok: false;
  error: string;
  code?: string;
}
export type RpcResult<T> = RpcSuccess<T> | RpcFailure;

let nextRequestId = 1;
export function allocateRequestId(): number {
  // Wrap around well below Number.MAX_SAFE_INTEGER to avoid id collisions even
  // in extremely long-lived OMX leader processes.
  if (nextRequestId >= 0x7fffffff) nextRequestId = 1;
  return nextRequestId++;
}

interface SendRequestParams<A extends RequestEnvelope["action"], P> {
  action: A;
  params: P;
  options?: RpcOptions;
}

export function sendRequest<T = unknown>(
  params: SendRequestParams<RequestEnvelope["action"], unknown>,
): Promise<RpcResult<T>> {
  const env = params.options?.env ?? process.env;
  const pipe = params.options?.pipe ?? pipeName(env);
  const timeoutMs = params.options?.timeoutMs ?? 5000;
  const id = allocateRequestId();
  const envelope = {
    id,
    action: params.action,
    params: params.params,
    protocol: PROTOCOL_VERSION,
  };

  return new Promise((resolve) => {
    let settled = false;
    let socket: Socket | null = null;
    let timeoutHandle: NodeJS.Timeout | null = null;
    let reader: { dispose(): void } | null = null;

    const cleanup = (): void => {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
        timeoutHandle = null;
      }
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
    };

    const finish = (result: RpcResult<T>): void => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(result);
    };

    const fail = (error: string, code?: string): void => {
      finish({ ok: false, error, code });
    };

    timeoutHandle = setTimeout(() => {
      fail(`RPC timed out after ${timeoutMs}ms (action=${params.action})`, "ETIMEOUT");
    }, timeoutMs);
    // Don't keep Node.js alive solely for this timeout.
    timeoutHandle.unref?.();

    try {
      socket = createConnection(pipe);
    } catch (err) {
      fail(`failed to open pipe ${pipe}: ${(err as Error).message}`, "EPIPE_OPEN");
      return;
    }

    socket.once("error", (err) => {
      const e = err as NodeJS.ErrnoException;
      fail(`pipe error ${e.code ?? ""}: ${e.message}`, e.code ?? "EPIPE");
    });

    socket.once("connect", () => {
      try {
        socket!.write(encodeMessage(envelope));
      } catch (err) {
        fail(`pipe write failed: ${(err as Error).message}`, "EPIPE_WRITE");
      }
    });

    reader = attachFramedReader(
      socket,
      (msg) => {
        const response = msg as ResponseEnvelope<T>;
        if (typeof response !== "object" || response === null) return;
        if (response.id !== id) return;
        if (response.ok) {
          finish({ ok: true, data: response.data });
        } else {
          finish({ ok: false, error: response.error, code: response.code });
        }
      },
      (err) => {
        fail(`pipe parse error: ${err.message}`, "EPROTO");
      },
    );

    socket.once("close", () => {
      if (!settled) fail("pipe closed before response", "EPIPE_CLOSED");
    });
  });
}
