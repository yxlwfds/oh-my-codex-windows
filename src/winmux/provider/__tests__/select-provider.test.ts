import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { selectMultiplexerProvider } from "../select-provider.js";
import { TmuxProvider } from "../tmux-provider.js";
import { WinMuxProvider } from "../winmux-provider.js";

describe("selectMultiplexerProvider", () => {
  it("returns WinMuxProvider on native Windows", () => {
    const provider = selectMultiplexerProvider({ platform: "win32" });
    assert.ok(provider instanceof WinMuxProvider);
    assert.equal(provider.name, "winmux");
  });

  it("returns TmuxProvider on Linux", () => {
    const provider = selectMultiplexerProvider({ platform: "linux" });
    assert.ok(provider instanceof TmuxProvider);
    assert.equal(provider.name, "tmux");
  });

  it("returns TmuxProvider on darwin", () => {
    const provider = selectMultiplexerProvider({ platform: "darwin" });
    assert.ok(provider instanceof TmuxProvider);
  });

  it("treats wsl/cygwin/msys as POSIX (tmux)", () => {
    // platform=linux but env hint says WSL → still tmux
    const wsl = selectMultiplexerProvider({ platform: "linux", env: { WSL_DISTRO_NAME: "Ubuntu" } });
    assert.ok(wsl instanceof TmuxProvider);
  });

  it("honours OMX_FORCE_WINMUX=1 to pick WinMux on any platform", () => {
    const forced = selectMultiplexerProvider({ platform: "linux", env: { OMX_FORCE_WINMUX: "1" } });
    assert.ok(forced instanceof WinMuxProvider);
  });

  it("honours OMX_FORCE_TMUX=1 to pick Tmux even on win32", () => {
    const forced = selectMultiplexerProvider({ platform: "win32", env: { OMX_FORCE_TMUX: "1" } });
    assert.ok(forced instanceof TmuxProvider);
  });
});
