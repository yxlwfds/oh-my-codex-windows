/**
 * Registers every plausible exit signal on the daemon process and funnels
 * them through a single idempotent `shutdown()` orchestrator. This is the
 * top-level zero-zombie safety net inside the daemon itself; the Win32 Job
 * Object is the kernel-level safety net.
 *
 * `shutdown` MUST be safe to call from any path:
 *   - SIGINT / SIGTERM / SIGHUP / SIGBREAK
 *   - `uncaughtException`, `unhandledRejection`, `beforeExit`
 *   - IPC `shutdown` request from `omx winmux stop`
 *   - `process.on('exit')` (synchronous-only, last resort)
 *
 * It serializes via a single in-flight Promise. A hard-stop timer ensures the
 * process eventually exits even if a graceful pass hangs.
 */

export type ShutdownReason =
  | "signal:SIGINT"
  | "signal:SIGTERM"
  | "signal:SIGHUP"
  | "signal:SIGBREAK"
  | "uncaughtException"
  | "unhandledRejection"
  | "beforeExit"
  | "exit"
  | "requested"
  | "fatal";

export interface LifecycleOptions {
  shutdown: (reason: ShutdownReason) => Promise<void>;
  /** Maximum time we allow `shutdown` to take before forcing exit. */
  hardStopMs?: number;
  /** Optional last-chance sync hook fired by `process.on('exit')`. */
  onSyncExit?: () => void;
  /** Test hook: swap `process.exit` so unit tests don't terminate the runner. */
  exit?: (code: number) => never;
}

export interface LifecycleHandle {
  /** Trigger graceful shutdown manually (e.g. from IPC). */
  beginShutdown(reason: ShutdownReason): Promise<void>;
  /** Detach all signal handlers (useful in tests). */
  dispose(): void;
}

export function installLifecycle(options: LifecycleOptions): LifecycleHandle {
  const hardStopMs = options.hardStopMs ?? 5000;
  const exitFn = options.exit ?? ((code: number): never => process.exit(code));
  let pending: Promise<void> | null = null;
  let syncFired = false;

  const fireSync = (): void => {
    if (syncFired) return;
    syncFired = true;
    try {
      options.onSyncExit?.();
    } catch {
      /* ignore — we're already on the exit path */
    }
  };

  const beginShutdown = (reason: ShutdownReason): Promise<void> => {
    if (pending) return pending;
    const work = async (): Promise<void> => {
      const timer = setTimeout(() => {
        fireSync();
        exitFn(2);
      }, hardStopMs);
      timer.unref?.();
      try {
        await options.shutdown(reason);
      } catch {
        /* always swallow: shutdown errors don't change the exit outcome */
      } finally {
        clearTimeout(timer);
        fireSync();
      }
    };
    pending = work();
    return pending;
  };

  const handleSignal = (signal: "SIGINT" | "SIGTERM" | "SIGHUP" | "SIGBREAK"): void => {
    void beginShutdown(`signal:${signal}` as ShutdownReason).then(() => exitFn(0));
  };
  const handleUncaught = (err: unknown): void => {
    try {
      process.stderr.write(
        `omx-winmux: uncaughtException: ${(err as Error)?.stack ?? String(err)}\n`,
      );
    } catch { /* ignore */ }
    void beginShutdown("uncaughtException").then(() => exitFn(1));
  };
  const handleUnhandled = (err: unknown): void => {
    try {
      process.stderr.write(
        `omx-winmux: unhandledRejection: ${(err as Error)?.stack ?? String(err)}\n`,
      );
    } catch { /* ignore */ }
    void beginShutdown("unhandledRejection").then(() => exitFn(1));
  };
  const handleBeforeExit = (): void => {
    void beginShutdown("beforeExit");
  };
  const handleExit = (): void => {
    // Last-chance synchronous cleanup. `pending` may still be unresolved here;
    // we cannot await, so we rely on `fireSync` to perform sync teardown
    // (close JobObject handle, unlink lockfile, etc.).
    fireSync();
  };

  process.on("SIGINT", () => handleSignal("SIGINT"));
  process.on("SIGTERM", () => handleSignal("SIGTERM"));
  process.on("SIGHUP", () => handleSignal("SIGHUP"));
  process.on("SIGBREAK" as NodeJS.Signals, () => handleSignal("SIGBREAK"));
  process.on("uncaughtException", handleUncaught);
  process.on("unhandledRejection", handleUnhandled);
  process.on("beforeExit", handleBeforeExit);
  process.on("exit", handleExit);

  return {
    beginShutdown,
    dispose: (): void => {
      process.removeListener("SIGINT", handleSignal as unknown as () => void);
      process.removeListener("SIGTERM", handleSignal as unknown as () => void);
      process.removeListener("SIGHUP", handleSignal as unknown as () => void);
      process.removeListener("SIGBREAK" as NodeJS.Signals, handleSignal as unknown as () => void);
      process.removeListener("uncaughtException", handleUncaught);
      process.removeListener("unhandledRejection", handleUnhandled);
      process.removeListener("beforeExit", handleBeforeExit);
      process.removeListener("exit", handleExit);
    },
  };
}
