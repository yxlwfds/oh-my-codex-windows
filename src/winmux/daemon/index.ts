#!/usr/bin/env node
/**
 * omx-winmux daemon entry point.
 *
 * Boot order:
 *   1. Sweep the lockfile (refuse to double-start if another live daemon owns
 *      it, otherwise clean up the stale file).
 *   2. Create the Win32 Job Object — without this we refuse to serve.
 *   3. Eagerly load node-pty (fail fast if missing).
 *   4. Start the IPC server.
 *   5. Install lifecycle handlers so every exit path tears the server down
 *      and (via the Job Object) reaps every PTY child.
 *
 * Hard-fail policy: if any of the prerequisites (lockfile / JobObject /
 * node-pty / pipe listen) fails, we write a clear error to the daemon log
 * and `process.exit(1)`. There is NO fallback to tmux on Windows.
 */

import { existsSync, mkdirSync, openSync, unlinkSync, writeFileSync, closeSync, readFileSync } from "fs";
import { createRequire } from "module";
import { dirname } from "path";
import { lockfilePath, logFilePath, pipeName, stateDir } from "../ipc/pipe-paths.js";
import { JobObject } from "../win-job/job-object.js";
import { JobObjectUnavailableError } from "../win-job/koffi-loader.js";
import { SessionManager } from "./session-manager.js";
import { installLifecycle } from "./lifecycle.js";
import { startIpcServer, type ServerHandle } from "./server.js";

const requireFromHere = createRequire(import.meta.url);

interface DaemonRuntime {
  job: JobObject | null;
  sessions: SessionManager;
  server: ServerHandle;
  lockfile: string;
  logFd: number | null;
}

async function bootstrap(): Promise<DaemonRuntime> {
  const dir = stateDir();
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const lockfile = lockfilePath();
  if (existsSync(lockfile)) {
    let owner: { pid?: number } = {};
    try {
      owner = JSON.parse(readFileSync(lockfile, "utf-8")) as { pid?: number };
    } catch {
      /* corrupt: treat as stale */
    }
    if (typeof owner.pid === "number" && owner.pid > 0) {
      try {
        process.kill(owner.pid, 0);
        // Live daemon already running — refuse to start a duplicate.
        process.stderr.write(
          `omx-winmux: another daemon is already running (pid=${owner.pid}, lockfile=${lockfile}). Exiting.\n`,
        );
        process.exit(0);
      } catch {
        // Stale lockfile from a dead process — remove and continue.
        try {
          unlinkSync(lockfile);
        } catch { /* ignore */ }
      }
    } else {
      try {
        unlinkSync(lockfile);
      } catch { /* ignore */ }
    }
  }

  let job: JobObject | null = null;
  try {
    job = JobObject.create();
  } catch (err) {
    const cause = err as JobObjectUnavailableError;
    process.stderr.write(
      `omx-winmux: failed to create Win32 Job Object: ${cause.message}\n` +
      "  Job Object is required for zero-zombie shutdown guarantees.\n" +
      "  Aborting — there is no fallback path on native Windows.\n",
    );
    process.exit(1);
  }

  // Eagerly load node-pty so failures surface BEFORE we accept any IPC.
  try {
    // We don't keep the reference; SessionManager will require() it the same way.
    requireFromHere("node-pty");
  } catch (err) {
    process.stderr.write(
      `omx-winmux: failed to load node-pty: ${(err as Error).message}\n` +
      "  Run: npm install node-pty\n" +
      "  If that fails, ensure Visual C++ Build Tools are present and try `npm rebuild node-pty`.\n",
    );
    job.dispose();
    process.exit(1);
  }

  const sessions = new SessionManager(job);

  // Logfile: append-only stderr/stdout mirror so detached daemons leave a trail.
  let logFd: number | null = null;
  try {
    logFd = openSync(logFilePath(), "a");
    // Mirror stdout/stderr writes for diagnostics.
    const origWrite = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((chunk: string | Uint8Array, ...rest: unknown[]): boolean => {
      try {
        if (logFd != null) {
          const buf = typeof chunk === "string" ? Buffer.from(chunk) : Buffer.from(chunk);
          writeFileSync(logFd, buf);
        }
      } catch { /* ignore */ }
      return origWrite(chunk as string, ...(rest as []));
    }) as typeof process.stderr.write;
  } catch { /* logging is best-effort */ }

  // Reserve the lockfile BEFORE listening, so concurrent client `ensureDaemon`
  // calls can detect us via the PID file even before the pipe is up.
  try {
    writeFileSync(
      lockfile,
      JSON.stringify({ pid: process.pid, startedAt: Date.now(), pipe: pipeName() }),
      { encoding: "utf-8" },
    );
  } catch (err) {
    process.stderr.write(`omx-winmux: failed to write lockfile ${lockfile}: ${(err as Error).message}\n`);
    job.dispose();
    process.exit(1);
  }

  let server: ServerHandle;
  try {
    server = await startIpcServer({
      pipe: pipeName(),
      sessions,
      onShutdownRequested: async () => {
        await lifecycle.beginShutdown("requested");
        process.exit(0);
      },
    });
  } catch (err) {
    process.stderr.write(
      `omx-winmux: failed to listen on pipe ${pipeName()}: ${(err as Error).message}\n`,
    );
    try { unlinkSync(lockfile); } catch { /* ignore */ }
    job.dispose();
    process.exit(1);
  }

  const runtime: DaemonRuntime = { job, sessions, server, lockfile, logFd };

  const lifecycle = installLifecycle({
    shutdown: async () => {
      // 1. Stop accepting new connections + drop existing sockets.
      await runtime.server.close().catch(() => undefined);
      // 2. Tear down PTY sessions (graceful kill).
      runtime.sessions.disposeAll("daemon-shutdown");
      // 3. Job Object is closed in onSyncExit so even if we crash mid-await,
      //    the kernel reaps everything.
    },
    onSyncExit: () => {
      if (runtime.job) {
        try { runtime.job.dispose(); } catch { /* ignore */ }
        runtime.job = null;
      }
      if (runtime.logFd != null) {
        try { closeSync(runtime.logFd); } catch { /* ignore */ }
        runtime.logFd = null;
      }
      try { unlinkSync(runtime.lockfile); } catch { /* ignore */ }
    },
  });
  void lifecycle; // tied to process lifetime; nothing else to do with handle.

  return runtime;
}

bootstrap().then(
  () => {
    // Successfully running. Keep Node alive via the IPC server.
    try {
      process.stderr.write(
        `omx-winmux: daemon ready pid=${process.pid} pipe=${pipeName()} ` +
        `lockfile=${lockfilePath()}\n`,
      );
    } catch { /* ignore */ }
  },
  (err) => {
    try {
      process.stderr.write(`omx-winmux: bootstrap failed: ${(err as Error).message}\n`);
    } catch { /* ignore */ }
    process.exit(1);
  },
);

// Avoid unused-import lint on dirname; we reserve it for future log rotation.
void dirname;
