/**
 * Windows named-pipe path & PID lockfile derivation for omx-winmux.
 *
 * The pipe name embeds an 8-char SHA1 digest derived from a stable per-user
 * identifier so multiple Windows accounts on the same machine cannot collide.
 * We deliberately avoid `os.userInfo().uid` (always -1 on Windows) and
 * `USERPROFILE` (may differ between cmd / powershell quoting); we fall back
 * across env candidates and the homedir hash.
 */

import { createHash } from "crypto";
import { homedir } from "os";
import { join } from "path";

const PIPE_PREFIX = "\\\\.\\pipe\\omx-winmux-";

export function userScopeDigest(env: NodeJS.ProcessEnv = process.env): string {
  const seed =
    env.OMX_WINMUX_USER_SCOPE?.trim()
    || env.USERNAME?.trim()
    || env.USER?.trim()
    || homedir()
    || "default";
  return createHash("sha1").update(seed).digest("hex").slice(0, 8);
}

export function pipeName(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.OMX_WINMUX_PIPE?.trim();
  if (override) return override;
  return `${PIPE_PREFIX}${userScopeDigest(env)}`;
}

export function stateDir(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.OMX_WINMUX_STATE_DIR?.trim();
  if (override) return override;
  const base = env.LOCALAPPDATA?.trim() || join(homedir(), ".cache");
  return join(base, "omx-winmux");
}

export function lockfilePath(env: NodeJS.ProcessEnv = process.env): string {
  return join(stateDir(env), `daemon-${userScopeDigest(env)}.pid`);
}

export function logFilePath(env: NodeJS.ProcessEnv = process.env): string {
  return join(stateDir(env), `daemon-${userScopeDigest(env)}.log`);
}
