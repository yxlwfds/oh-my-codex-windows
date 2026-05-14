import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

function nativeHookScriptPath(): string {
  return join(process.cwd(), "dist", "scripts", "codex-native-hook.js");
}

describe("Windows Hook JSON output tolerance", () => {
  it("emits valid JSON for SessionStart with Chinese characters", async () => {
    const wd = await mkdtemp(join(tmpdir(), "omx-win32-session-chinese-"));
    try {
      const omxDir = join(wd, ".omx", "state");
      await mkdir(omxDir, { recursive: true });
      await writeFile(
        join(omxDir, "session.json"),
        JSON.stringify({
          session_id: `test-session-${Date.now()}`,
          started_at: new Date().toISOString(),
        }),
      );

      const payload = {
        hook_event_name: "SessionStart",
        cwd: wd,
        session_id: `test-session-${Date.now()}`,
        thread_id: `thread-${Date.now()}`,
        provider_id: "test-provider",
        source: "startup",
        input: "这是一个中文测试输入",
      };

      const stdout = execFileSync(
        process.execPath,
        [nativeHookScriptPath()],
        {
          input: JSON.stringify(payload),
          encoding: "utf-8",
          stdio: ["pipe", "pipe", "pipe"],
        },
      );

      const trimmed = stdout.trim();
      const lines = trimmed.split("\n");
      assert.equal(lines.length, 1, "Should emit exactly one line of JSON");

      const parsed = JSON.parse(trimmed);
      assert.ok(typeof parsed === "object", "Output should be a valid JSON object");
    } finally {
      await rm(wd, { recursive: true, force: true });
    }
  });

  it("emits valid JSON for UserPromptSubmit with workflow keyword", async () => {
    const wd = await mkdtemp(join(tmpdir(), "omx-win32-prompt-keyword-"));
    try {
      const omxDir = join(wd, ".omx", "state");
      await mkdir(omxDir, { recursive: true });
      await writeFile(
        join(omxDir, "session.json"),
        JSON.stringify({
          session_id: `test-session-${Date.now()}`,
          started_at: new Date().toISOString(),
        }),
      );

      // Use a workflow keyword that will trigger additionalContext generation
      const payload = {
        hook_event_name: "UserPromptSubmit",
        cwd: wd,
        session_id: `test-session-${Date.now()}`,
        thread_id: `thread-${Date.now()}`,
        provider_id: "test-provider",
        prompt: "$team let's work together",
      };

      const stdout = execFileSync(
        process.execPath,
        [nativeHookScriptPath()],
        {
          input: JSON.stringify(payload),
          encoding: "utf-8",
          stdio: ["pipe", "pipe", "pipe"],
        },
      );

      const trimmed = stdout.trim();
      const lines = trimmed.split("\n");
      
      // UserPromptSubmit with keyword should emit JSON
      assert.equal(lines.length, 1, `Should emit exactly one line of JSON, got ${lines.length} lines`);
      assert.ok(trimmed.length > 0, "Output should not be empty when keyword is detected");

      const parsed = JSON.parse(trimmed);
      assert.ok(typeof parsed === "object", "Output should be a valid JSON object");
      
      // Verify the output contains expected fields
      if (parsed.continue) {
        assert.ok(typeof parsed.continue === "object");
        if (parsed.continue.additionalContext) {
          assert.ok(typeof parsed.continue.additionalContext === "string");
          assert.ok(parsed.continue.additionalContext.includes("team"), "Should mention team keyword");
        }
      }
    } finally {
      await rm(wd, { recursive: true, force: true });
    }
  });

  it("emits valid JSON when additionalContext contains complex nested data", async () => {
    const wd = await mkdtemp(join(tmpdir(), "omx-win32-complex-context-"));
    try {
      const omxDir = join(wd, ".omx", "state");
      await mkdir(omxDir, { recursive: true });
      await writeFile(
        join(omxDir, "session.json"),
        JSON.stringify({
          session_id: `test-session-${Date.now()}`,
          started_at: new Date().toISOString(),
          environment: {
            platform: "win32",
            node: process.version,
            paths: {
              home: process.env.USERPROFILE || "",
              temp: process.env.TEMP || "",
            },
          },
        }),
      );

      const payload = {
        hook_event_name: "SessionStart",
        cwd: wd,
        session_id: `test-session-${Date.now()}`,
        thread_id: `thread-${Date.now()}`,
        provider_id: "test-provider",
        source: "startup",
        input: "test",
      };

      const stdout = execFileSync(
        process.execPath,
        [nativeHookScriptPath()],
        {
          input: JSON.stringify(payload),
          encoding: "utf-8",
          stdio: ["pipe", "pipe", "pipe"],
        },
      );

      const trimmed = stdout.trim();
      const lines = trimmed.split("\n");
      assert.equal(lines.length, 1, "Should emit exactly one line of JSON");

      const parsed = JSON.parse(trimmed);
      assert.ok(typeof parsed === "object", "Output should be a valid JSON object");

      // Verify that the output contains expected fields
      if (parsed.continue) {
        assert.ok(typeof parsed.continue === "object");
      }
    } finally {
      await rm(wd, { recursive: true, force: true });
    }
  });

  it("handles malformed input gracefully with parseable JSON output", async () => {
    const payload = "not valid json at all";

    const stdout = execFileSync(
      process.execPath,
      [nativeHookScriptPath()],
      {
        input: payload,
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
      },
    );

    const trimmed = stdout.trim();
    const lines = trimmed.split("\n");
    assert.equal(lines.length, 1, "Should emit exactly one line of JSON");

    const parsed = JSON.parse(trimmed);
    assert.ok(typeof parsed === "object", "Output should be a valid JSON object");
  });

  it("Windows PowerShell shim forwards JSON correctly", async () => {
    if (process.platform !== "win32") {
      return; // Skip on non-Windows
    }

    const { buildManagedCodexNativeHookWindowsShimContent } = await import(
      "../../config/codex-hooks.js"
    );

    const wd = await mkdtemp(join(tmpdir(), "omx-win32-shim-json-"));
    try {
      const pkgRoot = join(wd, "pkg root");
      const hookPath = join(pkgRoot, "dist", "scripts", "codex-native-hook.js");
      await mkdir(dirname(hookPath), { recursive: true });

      // Create a simple hook script that echoes the input as JSON
      await writeFile(
        hookPath,
        [
          "const chunks = [];",
          "process.stdin.on('data', (chunk) => chunks.push(chunk));",
          "process.stdin.on('end', () => {",
          "  const input = Buffer.concat(chunks).toString('utf8');",
          "  try {",
          "    const parsed = JSON.parse(input);",
          "    process.stdout.write(JSON.stringify({ echo: parsed, valid: true }));",
          "  } catch (e) {",
          "    process.stdout.write(JSON.stringify({ error: e.message, valid: false }));",
          "  }",
          "});",
          "",
        ].join("\n"),
      );

      const shimPath = join(wd, "shim.ps1");
      await writeFile(
        shimPath,
        buildManagedCodexNativeHookWindowsShimContent(pkgRoot, {
          hookScriptPath: hookPath,
          nodePath: process.execPath,
        }),
      );

      const testPayload = {
        hook_event_name: "SessionStart",
        cwd: wd,
        session_id: `test-${Date.now()}`,
        thread_id: `thread-${Date.now()}`,
        provider_id: "test",
        source: "startup",
        input: "中文测试",
      };

      const { spawnSync } = await import("node:child_process");
      const result = spawnSync(
        "powershell.exe",
        ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", shimPath],
        {
          input: JSON.stringify(testPayload),
          encoding: "utf-8",
          stdio: ["pipe", "pipe", "pipe"],
        },
      );

      assert.equal(result.status, 0, "Shim should exit successfully");

      const trimmed = result.stdout.trim();
      assert.ok(trimmed, "Should have stdout output");

      const parsed = JSON.parse(trimmed);
      assert.ok(parsed.valid, "Output should indicate valid JSON processing");
      assert.deepEqual(parsed.echo.input, "中文测试", "Chinese characters should be preserved");
    } finally {
      await rm(wd, { recursive: true, force: true });
    }
  });
});
