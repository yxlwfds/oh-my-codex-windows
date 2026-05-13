/**
 * Worker thread executed in support of `sync-rpc.ts`.
 *
 * Lifecycle:
 *   - The main thread allocates a SharedArrayBuffer (header + payload region)
 *     and ships it to us through `workerData`.
 *   - For every sync RPC the main thread:
 *       1. writes the request JSON into the payload region,
 *       2. sets the header `length` slot,
 *       3. flips header[0] to STATUS_REQUEST,
 *       4. calls `worker.postMessage(0)` to wake us up,
 *       5. blocks on `Atomics.wait(header, 0, STATUS_REQUEST, timeoutMs)`.
 *   - We receive the postMessage on our own event loop, perform the async
 *     pipe RPC, marshal the result back into the SAB, then flip header[0] to
 *     STATUS_RESPONSE and call `Atomics.notify`.
 *
 * The shared header layout (Int32Array) is:
 *   [0] status          (see STATUS_* constants below)
 *   [1] request length  (bytes, set by main)
 *   [2] response length (bytes, set by worker)
 *   [3] response ok flag (1 = ok, 0 = error)
 *
 * `sync-rpc.ts` and this file MUST agree on the layout. Keep them in lockstep.
 */

import { parentPort, workerData } from "worker_threads";
import { sendRequest } from "./rpc.js";
import type { RequestEnvelope } from "../ipc/protocol.js";

interface WorkerInit {
  sab: SharedArrayBuffer;
  payloadOffset: number;
  payloadCapacity: number;
}

const init = workerData as WorkerInit;
const header = new Int32Array(init.sab, 0, 4);
const payload = new Uint8Array(init.sab, init.payloadOffset, init.payloadCapacity);

const STATUS_IDLE = 0;
const STATUS_REQUEST = 1;
const STATUS_RESPONSE = 2;
// STATUS_DISPOSED is owned by main; we exit when we observe it.
const STATUS_DISPOSED = 3;

if (!parentPort) {
  throw new Error("sync-rpc-worker must be loaded as a worker_threads thread.");
}

interface SyncRequestEnvelope {
  action: RequestEnvelope["action"];
  params: unknown;
  pipe?: string;
  timeoutMs?: number;
}

function writeResponse(payloadBytes: Buffer, ok: boolean): void {
  if (payloadBytes.length > payload.length) {
    // Truncate to fit; main will surface a clear error message.
    const truncMsg = JSON.stringify({
      ok: false,
      error: `response too large (${payloadBytes.length} bytes, capacity ${payload.length})`,
      code: "EBUFFER",
    });
    const truncBytes = Buffer.from(truncMsg, "utf-8");
    payload.set(truncBytes, 0);
    Atomics.store(header, 2, truncBytes.length);
    Atomics.store(header, 3, 0);
  } else {
    payload.set(payloadBytes, 0);
    Atomics.store(header, 2, payloadBytes.length);
    Atomics.store(header, 3, ok ? 1 : 0);
  }
  Atomics.store(header, 0, STATUS_RESPONSE);
  Atomics.notify(header, 0);
}

async function handleRequest(): Promise<void> {
  const len = Atomics.load(header, 1);
  if (len <= 0 || len > payload.length) {
    writeResponse(
      Buffer.from(
        JSON.stringify({ ok: false, error: `invalid request length ${len}`, code: "EBUFFER" }),
        "utf-8",
      ),
      false,
    );
    return;
  }
  const reqText = Buffer.from(payload.buffer, payload.byteOffset, len).toString("utf-8");

  let req: SyncRequestEnvelope;
  try {
    req = JSON.parse(reqText) as SyncRequestEnvelope;
  } catch (err) {
    writeResponse(
      Buffer.from(
        JSON.stringify({
          ok: false,
          error: `bad request json: ${(err as Error).message}`,
          code: "EPROTO",
        }),
        "utf-8",
      ),
      false,
    );
    return;
  }

  try {
    const result = await sendRequest({
      action: req.action,
      params: req.params,
      options: { pipe: req.pipe, timeoutMs: req.timeoutMs },
    });
    const payloadJson = JSON.stringify(result);
    writeResponse(Buffer.from(payloadJson, "utf-8"), result.ok);
  } catch (err) {
    writeResponse(
      Buffer.from(
        JSON.stringify({
          ok: false,
          error: (err as Error).message,
          code: "EWORKER",
        }),
        "utf-8",
      ),
      false,
    );
  }
}

parentPort.on("message", (msg) => {
  if (msg === "dispose") {
    Atomics.store(header, 0, STATUS_DISPOSED);
    Atomics.notify(header, 0);
    process.exit(0);
    return;
  }
  if (Atomics.load(header, 0) !== STATUS_REQUEST) return;
  void handleRequest();
});

// Export constants for static checkers; they are referenced via SAB above.
export const __layout = {
  STATUS_IDLE,
  STATUS_REQUEST,
  STATUS_RESPONSE,
  STATUS_DISPOSED,
};
