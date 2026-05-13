/**
 * Named-pipe IPC server.
 *
 * Responsibilities:
 *  - Listen on the per-user pipe name.
 *  - Parse newline-delimited JSON requests.
 *  - Dispatch one-shot requests via `SessionManager`.
 *  - Hold long-lived `attach-stream` connections open and let
 *    `SessionManager` push data through them.
 *  - Tear every connection down on shutdown, regardless of the path.
 */

import { createServer, type Server, type Socket } from "net";
import { attachFramedReader, writeFrame } from "../ipc/framing.js";
import {
  PROTOCOL_VERSION,
  type RequestEnvelope,
  type ResponseEnvelope,
  type SessionRecord,
} from "../ipc/protocol.js";
import type { SessionManager } from "./session-manager.js";

const DAEMON_STARTED_AT = Date.now();

export interface ServerHandle {
  /** Stop accepting new connections AND tear down existing ones. */
  close(): Promise<void>;
  /** Number of currently-open sockets (diagnostic). */
  connectionCount(): number;
}

export interface ServerStartOptions {
  pipe: string;
  sessions: SessionManager;
  onShutdownRequested: () => Promise<void>;
}

export async function startIpcServer(options: ServerStartOptions): Promise<ServerHandle> {
  const sockets = new Set<Socket>();
  const readers = new Map<Socket, { dispose(): void }>();

  const server: Server = createServer((socket) => {
    sockets.add(socket);
    const reader = attachFramedReader(socket, (msg) => handleMessage(socket, msg), (err) => {
      try {
        writeFrame(socket, {
          id: -1,
          ok: false,
          error: `protocol error: ${err.message}`,
          code: "EPROTO",
        } satisfies ResponseEnvelope<never>);
      } catch { /* ignore */ }
      socket.destroy();
    });
    readers.set(socket, reader);

    const onClose = (): void => {
      readers.get(socket)?.dispose();
      readers.delete(socket);
      sockets.delete(socket);
    };
    socket.once("close", onClose);
    socket.once("error", onClose);
  });

  function handleMessage(socket: Socket, raw: unknown): void {
    const req = raw as Partial<RequestEnvelope>;
    if (
      typeof req !== "object" ||
      req === null ||
      typeof req.id !== "number" ||
      typeof req.action !== "string"
    ) {
      try {
        writeFrame(socket, {
          id: typeof req?.id === "number" ? req.id : -1,
          ok: false,
          error: "malformed request envelope",
          code: "EPROTO",
        } satisfies ResponseEnvelope<never>);
      } catch { /* ignore */ }
      return;
    }

    try {
      switch (req.action) {
        case "ping":
          respond(socket, req.id, true, {
            pid: process.pid,
            version: PROTOCOL_VERSION,
            startedAt: DAEMON_STARTED_AT,
          });
          return;
        case "shutdown":
          respond(socket, req.id, true, { accepted: true });
          // Let the response flush before we begin shutting down.
          setImmediate(() => {
            void options.onShutdownRequested();
          });
          return;
        case "new-session": {
          const params = (req as RequestEnvelope & { action: "new-session" }).params;
          const session = options.sessions.create(params);
          respond(socket, req.id, true, { session });
          return;
        }
        case "kill-session": {
          const params = (req as RequestEnvelope & { action: "kill-session" }).params;
          const killed = options.sessions.kill(params.paneId);
          respond(socket, req.id, true, { killed });
          return;
        }
        case "list-sessions":
          respond(socket, req.id, true, { sessions: options.sessions.list() });
          return;
        case "capture-pane": {
          const params = (req as RequestEnvelope & { action: "capture-pane" }).params;
          const data = options.sessions.capture(params.paneId, params.lines);
          if (data === null) {
            respond(socket, req.id, false, {}, "session not found");
            return;
          }
          respond(socket, req.id, true, { data });
          return;
        }
        case "write-input": {
          const params = (req as RequestEnvelope & { action: "write-input" }).params;
          const ok = options.sessions.write(params.paneId, Buffer.from(params.dataBase64, "base64"));
          if (!ok) {
            respond(socket, req.id, false, {}, "session not found or dead");
            return;
          }
          respond(socket, req.id, true, {});
          return;
        }
        case "attach-stream": {
          const params = (req as RequestEnvelope & { action: "attach-stream" }).params;
          const subscribed = options.sessions.subscribe(
            params.paneId,
            req.id,
            socket,
            params.prefetchBytes ?? 0,
          );
          if (!subscribed) {
            respond(socket, req.id, false, {}, "session not found");
            return;
          }
          respond(socket, req.id, true, { subscribed: true });
          return;
        }
        default:
          respond(socket, req.id, false, {}, `unknown action: ${(req as { action: string }).action}`);
      }
    } catch (err) {
      respond(socket, req.id, false, {}, (err as Error).message);
    }
  }

  await new Promise<void>((resolve, reject) => {
    const onError = (err: NodeJS.ErrnoException): void => {
      server.removeListener("listening", onListening);
      reject(err);
    };
    const onListening = (): void => {
      server.removeListener("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(options.pipe);
  });

  const close = async (): Promise<void> => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    // server.close stops `listen()` but does not break existing connections.
    for (const socket of sockets) {
      try {
        socket.destroy();
      } catch { /* ignore */ }
    }
    for (const reader of readers.values()) reader.dispose();
    sockets.clear();
    readers.clear();
  };

  return {
    close,
    connectionCount: () => sockets.size,
  };
}

function respond<T>(
  socket: Socket,
  id: number,
  ok: boolean,
  data: T,
  errorMessage?: string,
): void {
  if (socket.destroyed) return;
  const env: ResponseEnvelope<T> = ok
    ? ({ id, ok: true, data } as ResponseEnvelope<T>)
    : ({ id, ok: false, error: errorMessage ?? "unspecified error" } as ResponseEnvelope<T>);
  try {
    writeFrame(socket, env);
  } catch { /* ignore */ }
}

// Re-export type for callers that need it.
export type { SessionRecord };
