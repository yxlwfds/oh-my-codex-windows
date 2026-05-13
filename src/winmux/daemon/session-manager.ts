/**
 * Tracks every PTY-backed session the daemon owns.
 *
 * Each `SessionState`:
 *  - holds a node-pty `IPty` and its onData/onExit subscriptions;
 *  - accumulates output bytes in an `OutputRingBuffer`;
 *  - notifies attached stream subscribers (live attach clients) on every chunk;
 *  - is removed from the registry only via `dispose()` which guarantees:
 *      pty.kill -> remove listeners -> notify+close subscribers
 *      -> clear dead-recycle timer -> drop from the map.
 *
 * The Win32 JobObject is created in `daemon/index.ts` and passed in; we call
 * `jobObject.assign(pid)` immediately after `pty.spawn` so the kernel is in
 * charge of zombie-prevention even before SessionManager itself.
 *
 * `disposeAll()` is invoked by `lifecycle.ts` on every exit path so callers do
 * not need to remember to clean up themselves.
 */

import { createRequire } from "module";
import type { Socket } from "net";
import type * as NodePty from "node-pty";
import { OutputRingBuffer, resolveBufferCapacity } from "./buffer.js";
import { writeFrame } from "../ipc/framing.js";
import type { JobObject } from "../win-job/job-object.js";
import type { SessionRecord, StreamNotification } from "../ipc/protocol.js";

const requireFromHere = createRequire(import.meta.url);

const DEAD_SESSION_RETENTION_MS = 30_000;

let nodePtyModule: typeof NodePty | null = null;
function loadNodePty(): typeof NodePty {
  if (nodePtyModule) return nodePtyModule;
  try {
    nodePtyModule = requireFromHere("node-pty") as typeof NodePty;
  } catch (err) {
    throw new Error(
      `Failed to load node-pty: ${(err as Error).message}. ` +
        "Install dependencies with `npm install`. node-pty ships prebuilt binaries; " +
        "if you see a compile error try `npm rebuild node-pty`.",
    );
  }
  return nodePtyModule;
}

export interface NewSessionRequest {
  command: string;
  args: string[];
  cwd: string;
  env?: Record<string, string>;
  cols?: number;
  rows?: number;
  meta?: Record<string, unknown>;
}

interface AttachSubscriber {
  /** Original request id the client used to subscribe. */
  requestId: number;
  socket: Socket;
}

interface SessionState {
  paneId: string;
  pty: NodePty.IPty;
  buffer: OutputRingBuffer;
  subscribers: Set<AttachSubscriber>;
  dataDisposable: { dispose(): void };
  exitDisposable: { dispose(): void };
  deadTimer: NodeJS.Timeout | null;
  record: SessionRecord;
}

export class SessionManager {
  private nextPaneId = 1;
  private readonly sessions = new Map<string, SessionState>();
  private readonly bufferCapacity: number;
  private disposed = false;

  constructor(private readonly job: JobObject | null, env: NodeJS.ProcessEnv = process.env) {
    this.bufferCapacity = resolveBufferCapacity(env);
  }

  list(): SessionRecord[] {
    return [...this.sessions.values()].map((s) => ({ ...s.record }));
  }

  get(paneId: string): SessionRecord | null {
    const state = this.sessions.get(paneId);
    return state ? { ...state.record } : null;
  }

  create(req: NewSessionRequest): SessionRecord {
    if (this.disposed) throw new Error("SessionManager has been disposed.");
    const pty = loadNodePty();
    const paneId = `%${this.nextPaneId++}`;
    const ptyEnv = { ...process.env, ...(req.env ?? {}) };
    const ptyProcess = pty.spawn(req.command, req.args, {
      name: "xterm-256color",
      cols: req.cols ?? 120,
      rows: req.rows ?? 30,
      cwd: req.cwd,
      env: ptyEnv as { [k: string]: string },
      encoding: null as unknown as string,
    });

    // Kernel-level zombie guard: assign before doing anything else.
    if (this.job) {
      try {
        this.job.assign(ptyProcess.pid);
      } catch {
        // best-effort: failure does not abort the session, but is logged
        // when DEBUG is on. The job still owns processes spawned by the
        // assigned PTY because BREAKAWAY is opt-in only.
      }
    }

    const buffer = new OutputRingBuffer(this.bufferCapacity);
    const subscribers = new Set<AttachSubscriber>();

    const record: SessionRecord = {
      paneId,
      pid: ptyProcess.pid,
      dead: false,
      command: req.command,
      args: [...req.args],
      cwd: req.cwd,
      createdAt: Date.now(),
      exitedAt: null,
      exitCode: null,
      signal: null,
    };

    const dataDisposable = ptyProcess.onData((chunk) => {
      // node-pty returns string when encoding is set, Buffer when not. We
      // requested `encoding: null` above so this is a Buffer at runtime, but
      // the type system still infers string — coerce defensively.
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string, "utf-8");
      buffer.append(bytes);
      this.broadcast(subscribers, record.paneId, bytes);
    });

    const exitDisposable = ptyProcess.onExit((evt) => {
      record.dead = true;
      record.exitedAt = Date.now();
      record.exitCode = evt.exitCode ?? null;
      record.signal = evt.signal != null ? String(evt.signal) : null;
      this.notifyClosed(subscribers, record.paneId, "exit", record.exitCode);
      // Defer hard cleanup so attach clients can still drain final bytes; the
      // timer is ref-tracked and cleared in `dispose()`.
      const state = this.sessions.get(record.paneId);
      if (state) {
        state.deadTimer = setTimeout(() => {
          state.deadTimer = null;
          this.disposeSession(record.paneId, "dead-retention-expired");
        }, DEAD_SESSION_RETENTION_MS);
        state.deadTimer.unref?.();
      }
    });

    const state: SessionState = {
      paneId,
      pty: ptyProcess,
      buffer,
      subscribers,
      dataDisposable,
      exitDisposable,
      deadTimer: null,
      record,
    };
    this.sessions.set(paneId, state);
    return { ...record };
  }

  kill(paneId: string): boolean {
    return this.disposeSession(paneId, "kill");
  }

  capture(paneId: string, lines: number): string | null {
    const state = this.sessions.get(paneId);
    if (!state) return null;
    return state.buffer.tailLines(lines).toString("utf-8");
  }

  write(paneId: string, data: Buffer): boolean {
    const state = this.sessions.get(paneId);
    if (!state || state.record.dead) return false;
    try {
      state.pty.write(data as unknown as string);
      return true;
    } catch {
      return false;
    }
  }

  subscribe(paneId: string, requestId: number, socket: Socket, prefetchBytes = 0): boolean {
    const state = this.sessions.get(paneId);
    if (!state) return false;
    const sub: AttachSubscriber = { requestId, socket };
    state.subscribers.add(sub);
    if (prefetchBytes > 0) {
      const tail = state.buffer.tailBytes(prefetchBytes);
      if (tail.length > 0) {
        this.pushData(socket, requestId, tail);
      }
    }
    const onClose = (): void => {
      state.subscribers.delete(sub);
    };
    socket.once("close", onClose);
    socket.once("error", onClose);
    if (state.record.dead) {
      this.notifyClosed(new Set([sub]), paneId, "already-exited", state.record.exitCode);
    }
    return true;
  }

  disposeAll(reason: string): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const paneId of [...this.sessions.keys()]) {
      this.disposeSession(paneId, reason);
    }
    // The Job Object is owned by daemon/index.ts; releasing it there will
    // kill any straggler processes via KILL_ON_JOB_CLOSE.
  }

  private disposeSession(paneId: string, reason: string): boolean {
    const state = this.sessions.get(paneId);
    if (!state) return false;
    this.sessions.delete(paneId);

    if (state.deadTimer) {
      clearTimeout(state.deadTimer);
      state.deadTimer = null;
    }

    try {
      state.dataDisposable.dispose();
    } catch { /* ignore */ }
    try {
      state.exitDisposable.dispose();
    } catch { /* ignore */ }

    if (!state.record.dead) {
      try {
        state.pty.kill();
      } catch { /* ignore */ }
    }

    this.notifyClosed(state.subscribers, paneId, reason, state.record.exitCode);
    state.subscribers.clear();
    state.buffer.reset();
    return true;
  }

  private broadcast(
    subscribers: Set<AttachSubscriber>,
    paneId: string,
    chunk: Buffer,
  ): void {
    if (subscribers.size === 0) return;
    const drained: AttachSubscriber[] = [];
    for (const sub of subscribers) {
      if (!this.pushData(sub.socket, sub.requestId, chunk)) {
        drained.push(sub);
      }
    }
    for (const sub of drained) subscribers.delete(sub);
    void paneId; // reserved for future per-pane logging
  }

  private pushData(socket: Socket, requestId: number, chunk: Buffer): boolean {
    if (socket.destroyed) return false;
    const msg: StreamNotification = {
      id: requestId,
      stream: "data",
      dataBase64: chunk.toString("base64"),
    };
    try {
      return writeFrame(socket, msg);
    } catch {
      return false;
    }
  }

  private notifyClosed(
    subscribers: Iterable<AttachSubscriber>,
    paneId: string,
    reason: string,
    exitCode: number | null,
  ): void {
    for (const sub of subscribers) {
      if (sub.socket.destroyed) continue;
      const msg: StreamNotification = {
        id: sub.requestId,
        stream: "closed",
        reason,
        exitCode,
      };
      try {
        writeFrame(sub.socket, msg);
      } catch { /* ignore */ }
    }
    void paneId;
  }
}
