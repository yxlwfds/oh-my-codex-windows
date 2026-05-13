/**
 * Synchronous RPC bridge used by `WinMuxProvider` so it can satisfy the legacy
 * sync `MultiplexerProvider.run()` contract while the underlying daemon
 * communication is inherently async.
 *
 * We spawn ONE long-lived worker thread that owns the named-pipe connections
 * and performs the async I/O. The main thread blocks via `Atomics.wait` until
 * the worker signals completion. The worker is `unref()`'d so it never keeps
 * the main process alive on its own; on `disposeSyncRpcWorker()` we send a
 * disposal sentinel and call `worker.terminate()` to guarantee cleanup.
 *
 * Concurrency: only one sync RPC can be in flight at a time. This matches the
 * sync `runTmux` model OMX has always relied on.
 */

import { Worker } from "worker_threads";
import { dirname, join } from "path";
import { existsSync } from "fs";
import { fileURLToPath } from "url";
import type { RequestEnvelope } from "../ipc/protocol.js";

const STATUS_IDLE = 0;
const STATUS_REQUEST = 1;
const STATUS_RESPONSE = 2;
const STATUS_DISPOSED = 3;

const HEADER_BYTES = 4 * 4; // 4 Int32 slots
const DEFAULT_CAPACITY_BYTES = 2 * 1024 * 1024; // 2 MiB payload window

export interface SyncRpcResult<T = unknown> {
  ok: boolean;
  data?: T;
  error?: string;
  code?: string;
}

interface BridgeState {
  worker: Worker;
  sab: SharedArrayBuffer;
  header: Int32Array;
  payload: Uint8Array;
  payloadOffset: number;
  payloadCapacity: number;
}

let state: BridgeState | null = null;

function resolveWorkerPath(): string {
  const override = process.env.OMX_WINMUX_SYNC_WORKER?.trim();
  if (override && existsSync(override)) return override;
  const here = fileURLToPath(import.meta.url);
  // When compiled this resolves to dist/winmux/client/sync-rpc.js; sibling is sync-rpc-worker.js.
  const candidate = join(dirname(here), "sync-rpc-worker.js");
  return candidate;
}

function initBridge(): BridgeState {
  const capacityBytes = (() => {
    const raw = Number.parseInt(process.env.OMX_WINMUX_SYNC_CAPACITY ?? "", 10);
    if (Number.isFinite(raw) && raw >= 64 * 1024) return raw;
    return DEFAULT_CAPACITY_BYTES;
  })();

  const sab = new SharedArrayBuffer(HEADER_BYTES + capacityBytes);
  const header = new Int32Array(sab, 0, 4);
  const payload = new Uint8Array(sab, HEADER_BYTES, capacityBytes);
  Atomics.store(header, 0, STATUS_IDLE);

  const workerPath = resolveWorkerPath();
  if (!existsSync(workerPath)) {
    throw new Error(
      `omx-winmux sync RPC worker not found: ${workerPath}. ` +
        "Build the project (npm run build) or set OMX_WINMUX_SYNC_WORKER.",
    );
  }

  const worker = new Worker(workerPath, {
    workerData: {
      sab,
      payloadOffset: HEADER_BYTES,
      payloadCapacity: capacityBytes,
    },
  });

  // Do not block process exit on this worker.
  worker.unref();
  worker.on("error", () => {
    // Worker died — invalidate the bridge so the next call rebuilds it.
    if (state && state.worker === worker) {
      try {
        Atomics.store(header, 0, STATUS_DISPOSED);
        Atomics.notify(header, 0);
      } catch {
        /* ignore */
      }
      state = null;
    }
  });
  worker.on("exit", () => {
    if (state && state.worker === worker) state = null;
  });

  return { worker, sab, header, payload, payloadOffset: HEADER_BYTES, payloadCapacity: capacityBytes };
}

function ensureBridge(): BridgeState {
  if (state) return state;
  state = initBridge();
  return state;
}

export interface SyncRpcOptions {
  pipe?: string;
  timeoutMs?: number;
}

export function syncRpc<T = unknown>(
  action: RequestEnvelope["action"],
  params: unknown,
  options: SyncRpcOptions = {},
): SyncRpcResult<T> {
  const bridge = ensureBridge();
  const { header, payload, worker } = bridge;
  const timeoutMs = options.timeoutMs ?? 5000;

  // We never tolerate a half-finished RPC: reset header to IDLE before queuing.
  Atomics.store(header, 0, STATUS_IDLE);

  const requestJson = JSON.stringify({
    action,
    params,
    pipe: options.pipe,
    timeoutMs,
  });
  const requestBytes = Buffer.from(requestJson, "utf-8");
  if (requestBytes.length > payload.length) {
    return {
      ok: false,
      error: `sync RPC request too large (${requestBytes.length} bytes, capacity ${payload.length}).`,
      code: "EBUFFER",
    };
  }
  payload.set(requestBytes, 0);
  Atomics.store(header, 1, requestBytes.length);
  Atomics.store(header, 2, 0);
  Atomics.store(header, 3, 0);
  Atomics.store(header, 0, STATUS_REQUEST);

  // Wake the worker; it picks up the SAB request via this message.
  try {
    worker.postMessage(0);
  } catch (err) {
    state = null;
    return {
      ok: false,
      error: `sync RPC worker not reachable: ${(err as Error).message}`,
      code: "EWORKER",
    };
  }

  const waitBudget = Math.max(50, timeoutMs + 1000);
  const waitResult = Atomics.wait(header, 0, STATUS_REQUEST, waitBudget);
  if (waitResult === "timed-out") {
    // Worker did not finish in time. Tear it down so the next call is clean.
    void worker.terminate().catch(() => {});
    state = null;
    return {
      ok: false,
      error: `sync RPC timed out after ${waitBudget}ms (action=${action})`,
      code: "ETIMEOUT",
    };
  }

  const status = Atomics.load(header, 0);
  if (status === STATUS_DISPOSED) {
    state = null;
    return { ok: false, error: "sync RPC worker was disposed mid-call", code: "EWORKER" };
  }
  if (status !== STATUS_RESPONSE) {
    state = null;
    return { ok: false, error: `sync RPC unexpected status ${status}`, code: "EWORKER" };
  }
  const respLen = Atomics.load(header, 2);
  if (respLen <= 0 || respLen > payload.length) {
    return { ok: false, error: `sync RPC malformed response length ${respLen}`, code: "EPROTO" };
  }
  const respJson = Buffer.from(payload.buffer, payload.byteOffset, respLen).toString("utf-8");
  Atomics.store(header, 0, STATUS_IDLE);

  let parsed: SyncRpcResult<T>;
  try {
    parsed = JSON.parse(respJson) as SyncRpcResult<T>;
  } catch (err) {
    return { ok: false, error: `sync RPC bad response json: ${(err as Error).message}`, code: "EPROTO" };
  }
  return parsed;
}

export function disposeSyncRpcWorker(): void {
  if (!state) return;
  const { worker, header } = state;
  try {
    Atomics.store(header, 0, STATUS_DISPOSED);
    Atomics.notify(header, 0);
    worker.postMessage("dispose");
  } catch {
    /* ignore */
  }
  void worker.terminate().catch(() => {});
  state = null;
}
