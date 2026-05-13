import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { OutputRingBuffer, resolveBufferCapacity } from "../buffer.js";

describe("OutputRingBuffer", () => {
  it("returns empty on tail when nothing buffered", () => {
    const buf = new OutputRingBuffer(1024);
    assert.equal(buf.byteLength, 0);
    assert.equal(buf.tailBytes(100).length, 0);
    assert.equal(buf.tailLines(5).length, 0);
  });

  it("accumulates bytes without exceeding capacity", () => {
    const buf = new OutputRingBuffer(8);
    buf.append(Buffer.from("ABCD"));
    buf.append(Buffer.from("EFGH"));
    assert.equal(buf.byteLength, 8);
    buf.append(Buffer.from("IJ"));
    assert.equal(buf.byteLength, 8);
    // Oldest "AB" should have been dropped, newest "IJ" appended.
    assert.equal(buf.tailBytes(8).toString("utf-8"), "CDEFGHIJ");
  });

  it("returns most recent N bytes via tailBytes (byte-exact, no line awareness)", () => {
    const buf = new OutputRingBuffer(128);
    buf.append(Buffer.from("hello world\n"));
    buf.append(Buffer.from("second line\n"));
    // Total length is 24 bytes; last 12 bytes covers exactly "second line\n".
    assert.equal(buf.tailBytes(12).toString("utf-8"), "second line\n");
    assert.equal(buf.tailBytes(1000).toString("utf-8"), "hello world\nsecond line\n");
  });

  it("returns last N newline-terminated lines via tailLines", () => {
    const buf = new OutputRingBuffer(1024);
    buf.append(Buffer.from("a\nb\nc\nd\n"));
    assert.equal(buf.tailLines(2).toString("utf-8"), "c\nd\n");
    assert.equal(buf.tailLines(10).toString("utf-8"), "a\nb\nc\nd\n");
    // Zero / negative is graceful empty.
    assert.equal(buf.tailLines(0).toString("utf-8"), "");
  });

  it("preserves a trailing line without a final newline", () => {
    const buf = new OutputRingBuffer(1024);
    buf.append(Buffer.from("alpha\nbeta\ngamma"));
    // 1 line should include the trailing "gamma" with no newline.
    assert.equal(buf.tailLines(1).toString("utf-8"), "gamma");
  });

  it("resets cleanly", () => {
    const buf = new OutputRingBuffer(32);
    buf.append(Buffer.from("xyz"));
    buf.reset();
    assert.equal(buf.byteLength, 0);
    assert.equal(buf.tailBytes(10).length, 0);
  });
});

describe("resolveBufferCapacity", () => {
  it("uses the default when env is unset", () => {
    assert.equal(resolveBufferCapacity({}), 512 * 1024);
  });
  it("honours an in-range OMX_WINMUX_BUFFER_BYTES", () => {
    assert.equal(resolveBufferCapacity({ OMX_WINMUX_BUFFER_BYTES: "131072" }), 131072);
  });
  it("rejects values below 32 KiB and falls back to the default", () => {
    assert.equal(resolveBufferCapacity({ OMX_WINMUX_BUFFER_BYTES: "100" }), 512 * 1024);
  });
});
