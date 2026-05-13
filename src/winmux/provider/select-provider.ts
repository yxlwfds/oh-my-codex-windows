/**
 * Selects which MultiplexerProvider OMX should use given the current platform
 * and environment overrides.
 *
 * Resolution order:
 *   1. `OMX_MULTIPLEXER=tmux` -> TmuxProvider (escape hatch for debugging).
 *   2. `OMX_MULTIPLEXER=winmux` -> WinMuxProvider (force, even on non-Windows).
 *   3. `OMX_MULTIPLEXER=auto` (default) -> WinMuxProvider on native Windows,
 *      TmuxProvider everywhere else.
 *
 * NOTE: Native Windows + WinMuxProvider is the ONLY supported path. There is
 * deliberately no automatic fallback to tmux on this platform; failures
 * surface as `MultiplexerProvider.isAvailable() === false` and call sites are
 * expected to error out clearly.
 */

import { isNativeWindows } from "../platform.js";
import type { MultiplexerProvider } from "./multiplexer-provider.js";
import { TmuxProvider } from "./tmux-provider.js";
import { WinMuxProvider } from "./winmux-provider.js";

let cachedProvider: MultiplexerProvider | null = null;
let cachedEnvKey = "";

export function resetMultiplexerProvider(): void {
  cachedProvider = null;
  cachedEnvKey = "";
}

function envCacheKey(env: NodeJS.ProcessEnv): string {
  return `${process.platform}|${env.OMX_MULTIPLEXER ?? ""}|${env.WSL_DISTRO_NAME ?? ""}|${env.MSYSTEM ?? ""}`;
}

export interface SelectMultiplexerOptions {
  /** Defaults to `process.platform`. */
  platform?: NodeJS.Platform;
  /** Defaults to `process.env`. */
  env?: NodeJS.ProcessEnv;
}

/**
 * Pure selection function (no cache, no process state). Exposed so unit tests
 * can pass in synthetic platforms without polluting the cached singleton.
 *
 * Recognised env overrides:
 *  - `OMX_MULTIPLEXER=tmux | winmux | auto`
 *  - `OMX_FORCE_WINMUX=1` (legacy alias for `OMX_MULTIPLEXER=winmux`)
 *  - `OMX_FORCE_TMUX=1` (legacy alias for `OMX_MULTIPLEXER=tmux`)
 */
export function selectMultiplexerProvider(
  options: SelectMultiplexerOptions = {},
): MultiplexerProvider {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;

  const explicit = String(env.OMX_MULTIPLEXER ?? "").trim().toLowerCase();
  const forceWinmux = String(env.OMX_FORCE_WINMUX ?? "").trim() === "1";
  const forceTmux = String(env.OMX_FORCE_TMUX ?? "").trim() === "1";

  if (explicit === "tmux" || forceTmux) return new TmuxProvider();
  if (explicit === "winmux" || forceWinmux) return new WinMuxProvider();
  if (isNativeWindows(env, platform)) return new WinMuxProvider();
  return new TmuxProvider();
}

export function getMultiplexerProvider(
  env: NodeJS.ProcessEnv = process.env,
): MultiplexerProvider {
  const key = envCacheKey(env);
  if (cachedProvider && cachedEnvKey === key) return cachedProvider;
  const provider = selectMultiplexerProvider({ env });
  cachedProvider = provider;
  cachedEnvKey = key;
  return provider;
}
