/**
 * Lightweight platform probes used by the winmux module.
 *
 * NOTE: A near-identical pair of helpers lives in
 * `src/team/tmux-session.ts` (`isWsl2`, `isMsysOrGitBash`, `isNativeWindows`).
 * They are duplicated here to avoid an import cycle:
 *   tmux-session.ts -> provider/select-provider.ts -> winmux/* -> tmux-session.ts
 * If the team module gets refactored, switch this file to re-export from there.
 */

import { existsSync, readFileSync } from "fs";

export function isWsl2(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.WSL_DISTRO_NAME || env.WSL_INTEROP) return true;
  try {
    if (existsSync("/proc/version")) {
      const contents = readFileSync("/proc/version", "utf-8");
      return /microsoft/i.test(contents);
    }
  } catch {
    /* ignore */
  }
  return false;
}

export function isMsysOrGitBash(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): boolean {
  if (platform !== "win32") return false;
  const msystem = String(env.MSYSTEM ?? "").trim();
  if (msystem !== "") return true;
  const term = String(env.TERM ?? "").trim().toLowerCase();
  return term.includes("cygwin") || term.includes("msys");
}

export function isNativeWindows(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): boolean {
  return platform === "win32" && !isWsl2(env) && !isMsysOrGitBash(env, platform);
}
