/**
 * Detect a running omx-winmux daemon over the named pipe and, if absent,
 * spawn one in the background. All retry loops are bounded so the call site
 * never hangs longer than `timeoutMs`.
 *
 * The spawned daemon is fully detached (`stdio: 'ignore'`, `.unref()`),
 * so the calling client process never holds a reference that would prevent
 * its own exit.
 */

import { spawn } from "child_process";
import { existsSync, readFileSync } from "fs";
import { setTimeout as delay } from "timers/promises";
import { lockfilePath, pipeName } from "../ipc/pipe-paths.js";
import { resolveDaemonEntryPath } from "../paths.js";
import { sendRequest } from "./rpc.js";

export interface EnsureDaemonOptions {
  /** Total budget for "spawn + handshake". Defaults to 5000ms. */
  timeoutMs?: number;
  /** Override pipe name (test injection). */
  pipe?: string;
  /** Override env (test injection). */
  env?: NodeJS.ProcessEnv;
  /** Skip auto-spawn; only probe an existing daemon. */
  noSpawn?: boolean;
}

export interface DaemonHandshake {
  pid: number;
  version: number;
  startedAt: number;
}

export class WinMuxUnavailableError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = "WinMuxUnavailableError";
  }
}

async function ping(
  pipe: string,
  env: NodeJS.ProcessEnv,
  timeoutMs: number,
): Promise<DaemonHandshake | null> {
  const result = await sendRequest<DaemonHandshake>({
    action: "ping",
    params: {},
    options: { pipe, env, timeoutMs },
  });
  if (result.ok) return result.data;
  return null;
}

function readLockfilePid(env: NodeJS.ProcessEnv): number | null {
  const path = lockfilePath(env);
  if (!existsSync(path)) return null;
  try {
    const raw = readFileSync(path, "utf-8").trim();
    const parsed = JSON.parse(raw) as { pid?: number };
    if (typeof parsed.pid === "number" && parsed.pid > 0) return parsed.pid;
  } catch {
    /* fall through */
  }
  return null;
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    return code === "EPERM"; // exists but not ours
  }
}

export async function ensureDaemonRunning(
  options: EnsureDaemonOptions = {},
): Promise<DaemonHandshake> {
  const env = options.env ?? process.env;
  const pipe = options.pipe ?? pipeName(env);
  const totalBudget = options.timeoutMs ?? 5000;
  const start = Date.now();

  // Fast path: someone is listening.
  const initial = await ping(pipe, env, 600);
  if (initial) return initial;

  if (options.noSpawn) {
    throw new WinMuxUnavailableError(
      `omx-winmux daemon is not running and noSpawn was requested (pipe=${pipe}).`,
    );
  }

  // Avoid stomping on a partially-started daemon: if the lockfile points at a
  // live PID, give it a brief window to start serving before we spawn another.
  const existingPid = readLockfilePid(env);
  if (existingPid && processAlive(existingPid)) {
    for (let i = 0; i < 10; i++) {
      const remaining = totalBudget - (Date.now() - start);
      if (remaining <= 0) break;
      await delay(150);
      const probed = await ping(pipe, env, Math.min(600, remaining));
      if (probed) return probed;
    }
  }

  const daemonEntry = resolveDaemonEntryPath();
  if (!daemonEntry) {
    throw new WinMuxUnavailableError(
      "Cannot locate omx-winmux daemon entry. Did you run `npm run build`?",
    );
  }

  try {
    const child = spawn(process.execPath, [daemonEntry], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
      env: { ...process.env, OMX_WINMUX_ROLE: "daemon" },
    });
    child.on("error", () => {
      /* swallow: any failure surfaces via the ping retry loop */
    });
    child.unref();
  } catch (err) {
    throw new WinMuxUnavailableError(
      `Failed to spawn omx-winmux daemon: ${(err as Error).message}`,
      err,
    );
  }

  // Poll until handshake succeeds or we run out of budget.
  while (Date.now() - start < totalBudget) {
    await delay(120);
    const remaining = totalBudget - (Date.now() - start);
    if (remaining <= 0) break;
    const handshake = await ping(pipe, env, Math.min(600, remaining));
    if (handshake) return handshake;
  }

  throw new WinMuxUnavailableError(
    `omx-winmux daemon did not respond within ${totalBudget}ms after spawn (pipe=${pipe}). ` +
      "Run `omx winmux status` or `omx doctor` for diagnostics.",
  );
}
