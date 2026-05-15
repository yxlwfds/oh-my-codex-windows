import { writeFile, rename, readFile } from 'node:fs/promises';
import { existsSync, mkdirSync, writeFileSync, renameSync, readFileSync, unlinkSync } from 'node:fs';
import { dirname } from 'node:path';
import { mkdir } from 'node:fs/promises';

/**
 * Windows EPERM/EBUSY retry delays in milliseconds (exponential-ish backoff).
 * On Windows, rename() may fail with EPERM or EBUSY when the target file is
 * temporarily locked by antivirus, search indexer, backup software, or another
 * process.  We retry up to 3 times with increasing delays before giving up.
 */
const EPERM_RETRY_DELAYS_MS = [50, 100, 150];

/**
 * Atomically write content to a file using the temp+rename pattern with
 * Windows EPERM/EBUSY retry.  This is safe for concurrent writers: each
 * writer uses its own temp file and the final rename is (mostly) atomic.
 *
 * @param filePath  Target file path
 * @param data      Content to write
 * @param options   Optional encoding (default 'utf-8')
 */
export async function atomicWriteFile(
  filePath: string,
  data: string,
  options: { encoding?: BufferEncoding } = {},
): Promise<void> {
  const encoding = options.encoding ?? 'utf-8';
  const parent = dirname(filePath);
  await mkdir(parent, { recursive: true });

  const tmpPath = `${filePath}.tmp.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}`;
  await writeFile(tmpPath, data, encoding);

  for (let attempt = 0; attempt <= EPERM_RETRY_DELAYS_MS.length; attempt++) {
    try {
      await renameForAtomicWrite(tmpPath, filePath);
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      // Only retry on Windows-specific transient lock errors
      if (
        (code === 'EPERM' || code === 'EBUSY') &&
        process.platform === 'win32' &&
        attempt < EPERM_RETRY_DELAYS_MS.length
      ) {
        await new Promise((resolve) => setTimeout(resolve, EPERM_RETRY_DELAYS_MS[attempt]));
        continue;
      }
      // ENOENT race: the parent dir was deleted between mkdir and rename.
      // If the target already contains our data we are done.
      if (code === 'ENOENT' && existsSync(filePath)) {
        try {
          const existing = await readFile(filePath, encoding);
          if (existing === data) return;
        } catch {
          // fall through to throw
        }
      }
      throw err;
    }
  }
}

/**
 * Test-only hook that allows replacing the rename impl used by atomicWriteFile.
 */
let renameForAtomicWrite: typeof rename = rename;

export function setAtomicWriteRenameForTests(fn: typeof rename): void {
  renameForAtomicWrite = fn;
}

export function resetAtomicWriteRenameForTests(): void {
  renameForAtomicWrite = rename;
}

/**
 * Synchronous sleep helper for sync atomic write retries on Windows.
 */
function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * Synchronous version of atomicWriteFile for use in sync contexts (e.g. wiki storage).
 * Uses the same temp+rename pattern with Windows EPERM/EBUSY retry.
 */
export function atomicWriteFileSync(
  filePath: string,
  data: string,
  options: { encoding?: BufferEncoding; mode?: number } = {},
): void {
  const encoding = options.encoding ?? 'utf-8';
  mkdirSync(dirname(filePath), { recursive: true });

  const tmpPath = `${filePath}.tmp.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}`;
  writeFileSync(tmpPath, data, { encoding, ...(options.mode !== undefined ? { mode: options.mode } : {}) });

  for (let attempt = 0; attempt <= EPERM_RETRY_DELAYS_MS.length; attempt++) {
    try {
      renameSync(tmpPath, filePath);
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (
        (code === 'EPERM' || code === 'EBUSY') &&
        process.platform === 'win32' &&
        attempt < EPERM_RETRY_DELAYS_MS.length
      ) {
        sleepSync(EPERM_RETRY_DELAYS_MS[attempt]);
        continue;
      }
      if (code === 'ENOENT' && existsSync(filePath)) {
        try {
          const existing = readFileSync(filePath, encoding);
          if (existing === data) return;
        } catch {
          // fall through to throw
        }
      }
      try { unlinkSync(tmpPath); } catch { /* best effort */ }
      throw err;
    }
  }
}
