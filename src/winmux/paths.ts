/**
 * Path resolution helpers used by winmux client + daemon.
 *
 * The daemon ships as `dist/winmux/daemon/index.js`; we resolve it relative
 * to this file's location so the rule works for both `node dist/cli/omx.js`
 * launches and tests that import the source tree directly.
 */

import { existsSync } from "fs";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";

function distRoot(): string | null {
  try {
    const here = fileURLToPath(import.meta.url);
    // When running compiled JS this file lives at dist/winmux/paths.js.
    // When running from source (e.g. ts-node) it lives at src/winmux/paths.ts;
    // in that scenario the daemon entry is not yet built and callers should
    // build first — we return null to surface a clear error upstream.
    const parent = dirname(here);
    if (parent.endsWith("winmux")) return parent;
    return null;
  } catch {
    return null;
  }
}

export function resolveDaemonEntryPath(): string | null {
  const override = process.env.OMX_WINMUX_DAEMON_ENTRY?.trim();
  if (override) {
    const abs = resolve(override);
    return existsSync(abs) ? abs : null;
  }
  const root = distRoot();
  if (!root) return null;
  const candidate = join(root, "daemon", "index.js");
  return existsSync(candidate) ? candidate : null;
}
