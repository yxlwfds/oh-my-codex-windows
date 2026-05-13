/**
 * Bounded ring buffer for PTY output.
 *
 * The buffer keeps up to `capacity` bytes of recent output. ANSI escape
 * sequences are NOT analysed — we always emit the raw bytes so consumers
 * (HUD, attach) see exactly what the PTY produced. Truncation is byte-wise.
 *
 * `capacity` defaults to ~512 KiB which comfortably covers >300 lines of a
 * verbose Codex/Claude session. It can be raised via `OMX_WINMUX_BUFFER_BYTES`.
 */

const DEFAULT_CAPACITY = 512 * 1024;

export interface OutputChunk {
  data: Buffer;
  ts: number;
}

export function resolveBufferCapacity(env: NodeJS.ProcessEnv = process.env): number {
  const raw = Number.parseInt(env.OMX_WINMUX_BUFFER_BYTES ?? "", 10);
  if (Number.isFinite(raw) && raw >= 32 * 1024) return raw;
  return DEFAULT_CAPACITY;
}

export class OutputRingBuffer {
  private parts: Buffer[] = [];
  private totalBytes = 0;

  constructor(public readonly capacity: number) { }

  append(chunk: Buffer): void {
    if (chunk.length === 0) return;
    this.parts.push(chunk);
    this.totalBytes += chunk.length;
    this.trim();
  }

  /** Read at most `n` *most recent* bytes. */
  tailBytes(n: number): Buffer {
    if (n <= 0 || this.totalBytes === 0) return Buffer.alloc(0);
    if (n >= this.totalBytes) return Buffer.concat(this.parts, this.totalBytes);
    let needed = n;
    const out: Buffer[] = [];
    for (let i = this.parts.length - 1; i >= 0 && needed > 0; i--) {
      const part = this.parts[i]!;
      if (part.length <= needed) {
        out.unshift(part);
        needed -= part.length;
      } else {
        out.unshift(part.subarray(part.length - needed));
        needed = 0;
      }
    }
    return Buffer.concat(out);
  }

  /**
   * Return the last `requestedLines` lines. A "line" is any contiguous run of
   * bytes terminated by `\n` OR a trailing partial line with no `\n`.
   *
   * Examples (`tailLines(1)`):
   *   "a\nb\nc\n" -> "c\n"
   *   "a\nb\nc"   -> "c"
   *   "abc"       -> "abc"
   *
   * ANSI escape sequences are passed through unchanged; line counting only
   * looks at raw `\n` bytes which is the same contract tmux uses.
   */
  tailLines(requestedLines: number): Buffer {
    if (requestedLines <= 0 || this.totalBytes === 0) return Buffer.alloc(0);
    const all = Buffer.concat(this.parts, this.totalBytes);
    // Track the start offset of each line. The first line always starts at 0;
    // every byte AFTER a '\n' (that is itself not the end of the buffer)
    // begins a new line.
    const starts: number[] = [0];
    for (let i = 0; i < all.length; i++) {
      if (all[i] === 0x0a && i + 1 < all.length) {
        starts.push(i + 1);
      }
    }
    if (requestedLines >= starts.length) return all;
    return all.subarray(starts[starts.length - requestedLines]!);
  }

  /** Reset the buffer (typically only used during dispose). */
  reset(): void {
    this.parts = [];
    this.totalBytes = 0;
  }

  get byteLength(): number {
    return this.totalBytes;
  }

  private trim(): void {
    while (this.totalBytes > this.capacity && this.parts.length > 0) {
      const first = this.parts[0]!;
      const overflow = this.totalBytes - this.capacity;
      if (first.length <= overflow) {
        this.parts.shift();
        this.totalBytes -= first.length;
      } else {
        this.parts[0] = first.subarray(overflow);
        this.totalBytes -= overflow;
        break;
      }
    }
  }
}
