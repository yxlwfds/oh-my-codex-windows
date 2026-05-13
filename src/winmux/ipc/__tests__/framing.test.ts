import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { Duplex } from "node:stream";
import type { Socket } from "node:net";
import { attachFramedReader } from "../framing.js";
import { encodeMessage } from "../protocol.js";

/** Convenience: encode to bytes the way framing on the wire actually goes out. */
function encodeFrame(msg: unknown): Buffer {
  return Buffer.from(encodeMessage(msg), "utf-8");
}

class MemorySocket extends Duplex {
  buffer: Buffer[] = [];
  _read(): void { /* push-based usage in tests */ }
  _write(chunk: unknown, _enc: BufferEncoding, cb: (err?: Error | null) => void): void {
    this.buffer.push(Buffer.from(chunk as Buffer));
    cb();
  }
}

// `attachFramedReader` typechecks against `net.Socket` but only uses the
// readable event surface plus `removeListener`. A Duplex is sufficient at
// runtime; we cast through `unknown` to satisfy the structural check without
// pulling in the full TCP/IPC socket surface area.
function asSocket(s: MemorySocket): Socket {
  return s as unknown as Socket;
}

describe("ipc framing", () => {
  it("encodeFrame appends a single newline and no internal newlines", () => {
    const frame = encodeFrame({ hello: "world\n" });
    const lastByte = frame[frame.length - 1];
    assert.equal(lastByte, 0x0a);
    // The newline in the value must have been escaped (JSON.stringify -> \n).
    const noTrail = frame.subarray(0, frame.length - 1);
    assert.equal(noTrail.includes(0x0a), false);
  });

  it("attachFramedReader splits concatenated frames correctly", async () => {
    const socket = new MemorySocket();
    const messages: unknown[] = [];
    let parseErr: Error | null = null;
    const reader = attachFramedReader(
      asSocket(socket),
      (msg) => messages.push(msg),
      (err) => { parseErr = err; },
    );

    socket.push(encodeFrame({ a: 1 }));
    socket.push(encodeFrame({ b: 2 }));
    socket.push(null);
    await new Promise<void>((resolve) => socket.once("end", () => resolve()));

    assert.equal(parseErr, null);
    assert.deepEqual(messages, [{ a: 1 }, { b: 2 }]);
    reader.dispose();
  });

  it("attachFramedReader handles a frame that arrives in multiple chunks", async () => {
    const socket = new MemorySocket();
    const messages: unknown[] = [];
    attachFramedReader(asSocket(socket), (msg) => messages.push(msg), () => { });

    const frame = encodeFrame({ kind: "split-across-chunks", n: 42 });
    socket.push(frame.subarray(0, 5));
    socket.push(frame.subarray(5));
    socket.push(null);
    await new Promise<void>((resolve) => socket.once("end", () => resolve()));

    assert.deepEqual(messages, [{ kind: "split-across-chunks", n: 42 }]);
  });

  it("attachFramedReader reports parse errors instead of crashing", async () => {
    const socket = new MemorySocket();
    const errors: Error[] = [];
    attachFramedReader(asSocket(socket), () => { }, (err) => { errors.push(err); });
    socket.push(Buffer.from("this-is-not-json\n"));
    socket.push(null);
    await new Promise<void>((resolve) => socket.once("end", () => resolve()));
    assert.equal(errors.length, 1);
  });
});
