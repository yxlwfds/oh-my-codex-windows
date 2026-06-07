import { createHash } from "crypto";
import { existsSync } from "fs";
import { readdir, realpath } from "fs/promises";
import { basename, dirname, join, relative, resolve, win32 } from "path";
import { execFileSync } from "child_process";

export const MANAGED_HOOK_EVENTS = [
  "SessionStart",
  "PreToolUse",
  "PostToolUse",
  "UserPromptSubmit",
  "PreCompact",
  "PostCompact",
  "Stop",
] as const;

type ManagedHookEventName = (typeof MANAGED_HOOK_EVENTS)[number];

type JsonObject = Record<string, unknown>;

export interface ManagedHookEntry {
  matcher?: string;
  hooks: Array<{
    type: "command";
    command: string;
    statusMessage?: string;
    timeout?: number;
  }>;
}

export interface ManagedCodexHooksConfig {
  hooks: Record<ManagedHookEventName, ManagedHookEntry[]>;
}

interface ParsedCodexHooksConfig {
  root: JsonObject;
  hooks: JsonObject;
}

export interface RemoveManagedCodexHooksResult {
  nextContent: string | null;
  removedCount: number;
}

export interface ManagedCodexHookTrustState {
  trusted_hash: string;
}

export interface DedupedCodexHookConfigPath {
  path: string;
  reason: "unique";
}

export interface SkippedCodexHookConfigPath {
  path: string;
  reason: "runtime_codex_home_mirror" | "duplicate_realpath";
  canonicalPath?: string;
}

export interface DiscoverCodexHookConfigPathsOptions {
  maxFiles?: number;
}

const CODEX_HOOK_EVENT_LABELS: Record<ManagedHookEventName, string> = {
  SessionStart: "session_start",
  PreToolUse: "pre_tool_use",
  PostToolUse: "post_tool_use",
  UserPromptSubmit: "user_prompt_submit",
  PreCompact: "pre_compact",
  PostCompact: "post_compact",
  Stop: "stop",
};

function isPlainObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cloneJson<T>(value: T): T {
  return structuredClone(value);
}

type HookCommandPlatform = NodeJS.Platform;

function quoteCommandPart(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function escapeTomlBasicString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function quoteWindowsCommandPart(value: string): string {
  return `"${value.replace(/"/g, '\\"')}"`;
}

function quotePowerShellLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function quoteWindowsProcessArgument(value: string): string {
  let quoted = '"';
  let backslashes = 0;

  for (const char of value) {
    if (char === '\\') {
      backslashes += 1;
      continue;
    }

    if (char === '"') {
      quoted += '\\'.repeat(backslashes * 2 + 1);
      quoted += '"';
      backslashes = 0;
      continue;
    }

    quoted += '\\'.repeat(backslashes);
    quoted += char;
    backslashes = 0;
  }

  quoted += '\\'.repeat(backslashes * 2);
  quoted += '"';
  return quoted;
}

export const WINDOWS_NATIVE_HOOK_SHIM_RELATIVE_PATH = [
  "hooks",
  "omx-native-hook-windows-shim.ps1",
] as const;

export interface ManagedCodexHookOptions {
  platform?: HookCommandPlatform;
  codexHomeDir?: string;
  nodePath?: string;
  hookScriptPath?: string;
}

export function buildManagedCodexNativeHookWindowsShimPath(
  codexHomeDir: string,
): string {
  return win32.join(codexHomeDir, ...WINDOWS_NATIVE_HOOK_SHIM_RELATIVE_PATH);
}

export function buildManagedCodexNativeHookWindowsShimContent(
  pkgRoot: string,
  options: Pick<ManagedCodexHookOptions, "hookScriptPath" | "nodePath"> = {},
): string {
  const hookScript =
    options.hookScriptPath ??
    win32.join(pkgRoot, "dist", "scripts", "codex-native-hook.js");
  const nodePath = options.nodePath ?? process.execPath;

  const rawOutputFallback = [
    "# 通过 OpenStandardOutput 写原始字节，完全绕过 [Console]::Out 的编码（避免 GBK/UTF-8 乱码）",
    "function WriteStdoutRaw { param([string]$s) $b=[System.Text.Encoding]::UTF8.GetBytes($s); [Console]::OpenStandardOutput().Write($b,0,$b.Length) }",
    "function WriteStderrRaw { param([string]$s) $b=[System.Text.Encoding]::UTF8.GetBytes($s); [Console]::OpenStandardError().Write($b,0,$b.Length) }",
  ];

  const processStartEncodingSetup = [
    "# pwsh 7.x (NET Core) 始终支持 Standard*Encoding",
    "$utf8NoBom = New-Object System.Text.UTF8Encoding $false",
    "$startInfo.StandardInputEncoding = $utf8NoBom",
    "$startInfo.StandardOutputEncoding = $utf8NoBom",
    "$startInfo.StandardErrorEncoding = $utf8NoBom",
  ];

  const managedStdioPass = [
    "$utf8Bytes = [System.Text.Encoding]::UTF8.GetBytes($stdinPayload)",
    "$base64Payload = [Convert]::ToBase64String($utf8Bytes)",
    "# 使用 TextWriter 管道（ReadToEndAsync 异步读取，pwsh 7 原生支持）",
    "$stdoutTask = $process.StandardOutput.ReadToEndAsync()",
    "$stderrTask = $process.StandardError.ReadToEndAsync()",
    "$process.StandardInput.WriteLine($base64Payload)",
    "$process.StandardInput.Close()",
    "$process.WaitForExit()",
    "$stdoutResult = $stdoutTask.Result",
    "$stderrResult = $stderrTask.Result",
  ];

  const managedConsoleOutput = [
    "# 用 OpenStandardOutput 写原始字节，确保输出不受 Console.OutputEncoding 影响",
    "WriteStdoutRaw $stdoutResult",
    "if ($stderrResult) { WriteStderrRaw $stderrResult }",
    "exit $process.ExitCode",
  ];

  return [
    "$ErrorActionPreference = 'Stop'",
    ...rawOutputFallback,
    "# 从 StandardInput 读取原始字节（非 Console.In），避免管道环境下的字符编码损坏",
    "$stdinStream = [Console]::OpenStandardInput()",
    "$memStream = New-Object System.IO.MemoryStream",
    "$buffer = New-Object byte[] 65536",
    "while (($read = $stdinStream.Read($buffer, 0, $buffer.Length)) -gt 0) {",
    "  $memStream.Write($buffer, 0, $read)",
    "}",
    "$stdinPayload = [System.Text.Encoding]::UTF8.GetString($memStream.ToArray())",
    "",
    "# 记录 PowerShell shim 接收到的 stdin（用于调试）",
    "$shimDebugLogDir = Join-Path (Join-Path (Get-Location) '.omx') 'logs'",
    "if (-not (Test-Path $shimDebugLogDir)) { New-Item -ItemType Directory -Path $shimDebugLogDir -Force | Out-Null }",
    "$shimDebugLogPath = Join-Path $shimDebugLogDir $('native-hook-shim-debug-' + (Get-Date).ToString('yyyy-MM-dd') + '.jsonl')",
    "$shimDebugEntry = @{",
    "  timestamp = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ss.fffZ')",
    "  event = 'shim_stdin_received'",
    "  length = $stdinPayload.Length",
    "  preview = if ($stdinPayload.Length -gt 200) { $stdinPayload.Substring(0, 200) } else { $stdinPayload }",
    "} | ConvertTo-Json -Compress",
    "Add-Content -Path $shimDebugLogPath -Value $shimDebugEntry -Encoding UTF8 -ErrorAction SilentlyContinue",
    "$isStopEvent = $stdinPayload -match '\"hook_event_name\"\\s*:\\s*\"Stop\"'",
    "",
    `$hookScript = ${quotePowerShellLiteral(hookScript)}`,
    "$launchTimeoutMs = 15000",
    "if ($env:OMX_NATIVE_HOOK_LAUNCH_TIMEOUT_MS) {",
    "  $parsedLaunchTimeoutMs = 0",
    "  if ([int]::TryParse($env:OMX_NATIVE_HOOK_LAUNCH_TIMEOUT_MS, [ref]$parsedLaunchTimeoutMs)) {",
    "    $launchTimeoutMs = $parsedLaunchTimeoutMs",
    "  }",
    "}",
    "$deadline = [DateTime]::UtcNow.AddMilliseconds($launchTimeoutMs)",
    "while (-not (Test-Path -LiteralPath $hookScript)) {",
    "  if ([DateTime]::UtcNow -ge $deadline) {",
    "    if (-not $isStopEvent) { WriteStdoutRaw ('{}' + [Environment]::NewLine) }",
    "    exit 0",
    "  }",
    "  Start-Sleep -Milliseconds 200",
    "}",

    "$startInfo = [System.Diagnostics.ProcessStartInfo]::new()",
    `$startInfo.FileName = ${quotePowerShellLiteral(nodePath)}`,
    "$startInfo.UseShellExecute = $false",
    "$startInfo.RedirectStandardInput = $true",
    "$startInfo.RedirectStandardOutput = $true",
    "$startInfo.RedirectStandardError = $true",
    ...processStartEncodingSetup,
    `$startInfo.Arguments = ${quotePowerShellLiteral(quoteWindowsProcessArgument(hookScript))}`,
    "$process = [System.Diagnostics.Process]::new()",
    "$process.StartInfo = $startInfo",
    "do {",
    "  try {",
    "    $null = $process.Start()",
    "    break",
    "  } catch {",
    "    if ([DateTime]::UtcNow -ge $deadline) {",
    "      if (-not $isStopEvent) { WriteStdoutRaw ('{}' + [Environment]::NewLine) }",
    "      exit 0",
    "    }",
    "    Start-Sleep -Milliseconds 200",
    "    continue",
    "  }",
    "} while ($true)",
    ...managedStdioPass,
    ...managedConsoleOutput,
    "",
  ].join("\n");
}

export function buildManagedCodexNativeHookCommand(
  pkgRoot: string,
  optionsOrPlatform: HookCommandPlatform | ManagedCodexHookOptions = process.platform,
): string {
  const options = typeof optionsOrPlatform === "string"
    ? { platform: optionsOrPlatform }
    : optionsOrPlatform;
  const platform = options.platform ?? process.platform;
  const hookScript = platform === "win32"
    ? win32.join(pkgRoot, "dist", "scripts", "codex-native-hook.js")
    : join(pkgRoot, "dist", "scripts", "codex-native-hook.js");

  if (platform === "win32") {
    const codexHomeDir = options.codexHomeDir ?? dirname(pkgRoot);
    const shimPath = buildManagedCodexNativeHookWindowsShimPath(codexHomeDir);
    // 最佳实践：永远使用裸 'pwsh' 或 'powershell.exe' 裸名，依赖 PATH 解析。
    // 这彻底避免了全路径中带有空格造成的 cmd.exe /C 引号剥离以及转移 Bug。
    return `pwsh -NoProfile -ExecutionPolicy Bypass -File ${quoteWindowsCommandPart(shimPath)}`;
  }

  return `${quoteCommandPart(process.execPath)} ${quoteCommandPart(hookScript)}`;
}

/**
 * 解析 pwsh 可执行文件路径，返回 **不含空格** 的路径以兼容 cmd.exe /C 引号剥离行为。
 *
 * Codex CLI (Rust) 通过 `cmd.exe /C <command>` 启动 hook，
 * 而 cmd.exe /C 会剥离首尾引号，导致 "D:\Program Files\...\pwsh.exe" 被截断为 D:\Program。
 * 因此：
 *   1. 解析全路径后，若路径包含空格则转为 8.3 短路径（不含空格、不需引号）
 *   2. 若短路径不可用，回退到裸名 "pwsh"（依赖 PATH）
 */
function resolvePwshPath(): string {
  // 常见安装路径
  const candidates = [
    join(process.env.ProgramFiles ?? "C:\\Program Files", "PowerShell", "7", "pwsh.exe"),
    "D:\\Program Files\\PowerShell\\7\\pwsh.exe",
  ];
  const drive = (process.env.SystemDrive ?? "").toUpperCase();
  if (drive === "C:") {
    if (!candidates.includes("D:\\Program Files\\PowerShell\\7\\pwsh.exe")) {
      candidates.push("D:\\Program Files\\PowerShell\\7\\pwsh.exe");
    }
  }

  let resolvedLong: string | null = null;

  // 尝试通过 where.exe 查找，并屏蔽 stderr 噪音
  try {
    const whereResult = execFileSync("where.exe", ["pwsh.exe"], {
      encoding: "utf-8",
      timeout: 5000,
      windowsHide: true,
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (whereResult) {
      const firstMatch = whereResult.split(/[\r\n]+/)[0]?.trim();
      if (firstMatch && existsSync(firstMatch)) {
        resolvedLong = firstMatch;
      }
    }
  } catch {
    // where.exe 可能不可用
  }

  // 检查候选路径
  if (!resolvedLong) {
    for (const candidate of candidates) {
      if (existsSync(candidate)) {
        resolvedLong = candidate;
        break;
      }
    }
  }

  if (!resolvedLong) {
    return "pwsh";
  }

  // 路径无空格 → 直接使用
  if (!resolvedLong.includes(" ")) {
    return resolvedLong;
  }

  // 路径有空格 → 转为 8.3 短路径（cmd.exe /C 安全）
  const shortPath = resolveWindows83ShortPath(resolvedLong);
  if (shortPath) {
    return shortPath;
  }

  // 短路径不可用 → 裸名回退（依赖 PATH）
  return "pwsh";
}

/**
 * 将 Windows 长路径转为 8.3 短路径（不含空格），用于绕过 cmd.exe /C 引号剥离问题。
 */
function resolveWindows83ShortPath(longPath: string): string | null {
  try {
    const result = execFileSync(
      "cmd.exe",
      ["/d", "/c", `for %I in ("${longPath}") do @echo %~sI`],
      { encoding: "utf-8", timeout: 5000, windowsHide: true },
    ).trim();
    if (result && !result.includes(" ") && existsSync(result)) {
      return result;
    }
  } catch {
    // 8.3 短路径可能被禁用
  }
  return null;
}

function buildCommandHook(
  command: string,
  options: {
    matcher?: string;
    statusMessage?: string;
    timeout?: number;
  } = {},
): ManagedHookEntry {
  const hook = {
    type: "command",
    command,
    ...(options.statusMessage ? { statusMessage: options.statusMessage } : {}),
    ...(typeof options.timeout === "number" ? { timeout: options.timeout } : {}),
  } satisfies ManagedHookEntry["hooks"][number];

  return {
    ...(options.matcher ? { matcher: options.matcher } : {}),
    hooks: [hook],
  };
}

export function buildManagedCodexHooksConfig(
  pkgRoot: string,
  options: ManagedCodexHookOptions = {},
): ManagedCodexHooksConfig {
  const command = buildManagedCodexNativeHookCommand(pkgRoot, options);

  return {
    hooks: {
      SessionStart: [
        buildCommandHook(command, {
          matcher: "startup|resume|clear",
        }),
      ],
      PreToolUse: [
        buildCommandHook(command, {
          matcher: "Bash",
        }),
      ],
      PostToolUse: [
        buildCommandHook(command),
      ],
      UserPromptSubmit: [
        buildCommandHook(command),
      ],
      PreCompact: [
        buildCommandHook(command),
      ],
      PostCompact: [
        buildCommandHook(command),
      ],
      Stop: [
        buildCommandHook(command, {
          timeout: 30,
        }),
      ],
    },
  };
}

export function parseCodexHooksConfig(
  content: string,
): ParsedCodexHooksConfig | null {
  try {
    const parsed = JSON.parse(content) as unknown;
    if (!isPlainObject(parsed)) return null;

    return {
      root: cloneJson(parsed),
      hooks: isPlainObject(parsed.hooks) ? cloneJson(parsed.hooks) : {},
    };
  } catch {
    return null;
  }
}

function isOmxManagedHookCommand(command: string): boolean {
  return /(?:^|[\\/])codex-native-hook\.js(?:["'\s]|$)/.test(command)
    || /(?:^|[\\/])omx-native-hook-windows-shim\.ps1(?:["'\s]|$)/i.test(command);
}

function countManagedHooksInEntry(entry: unknown): number {
  if (!isPlainObject(entry) || !Array.isArray(entry.hooks)) {
    return 0;
  }

  return entry.hooks.filter((hook) => {
    return isPlainObject(hook)
      && hook.type === "command"
      && typeof hook.command === "string"
      && isOmxManagedHookCommand(hook.command);
  }).length;
}

export function getMissingManagedCodexHookEvents(
  content: string,
): ManagedHookEventName[] | null {
  const parsed = parseCodexHooksConfig(content);
  if (!parsed) return null;

  return MANAGED_HOOK_EVENTS.filter((eventName) => {
    const entries = Array.isArray(parsed.hooks[eventName])
      ? parsed.hooks[eventName]
      : [];
    return !entries.some((entry) => countManagedHooksInEntry(entry) > 0);
  });
}

export function getManagedCodexHookCommandsForEvent(
  content: string,
  eventName: ManagedHookEventName,
): string[] | null {
  const parsed = parseCodexHooksConfig(content);
  if (!parsed) return null;

  const entries = Array.isArray(parsed.hooks[eventName])
    ? parsed.hooks[eventName]
    : [];
  const commands: string[] = [];

  for (const entry of entries) {
    if (!isPlainObject(entry) || !Array.isArray(entry.hooks)) continue;
    for (const hook of entry.hooks) {
      if (
        isPlainObject(hook) &&
        hook.type === "command" &&
        typeof hook.command === "string" &&
        isOmxManagedHookCommand(hook.command)
      ) {
        commands.push(hook.command);
      }
    }
  }

  return commands;
}

function stripManagedHooksFromEntry(entry: unknown): {
  entry: unknown | null;
  removedCount: number;
} {
  if (!isPlainObject(entry) || !Array.isArray(entry.hooks)) {
    return { entry: cloneJson(entry), removedCount: 0 };
  }

  const nextHooks = entry.hooks.filter((hook) => {
    if (!isPlainObject(hook)) return true;
    return !(
      hook.type === "command" &&
      typeof hook.command === "string" &&
      isOmxManagedHookCommand(hook.command)
    );
  });

  const removedCount = entry.hooks.length - nextHooks.length;
  if (removedCount === 0) {
    return { entry: cloneJson(entry), removedCount: 0 };
  }

  if (nextHooks.length === 0) {
    return { entry: null, removedCount };
  }

  return {
    entry: {
      ...cloneJson(entry),
      hooks: nextHooks,
    },
    removedCount,
  };
}

function serializeCodexHooksConfig(root: JsonObject): string {
  return JSON.stringify(root, null, 2) + "\n";
}

function canonicalJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => canonicalJson(item));
  }
  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalJson(value[key])]),
    );
  }
  return value;
}

function versionForCodexTomlIdentity(value: JsonObject): string {
  const canonical = canonicalJson(value);
  const serialized = JSON.stringify(canonical);
  return `sha256:${createHash("sha256").update(serialized).digest("hex")}`;
}

function normalizedCommandHookIdentity(
  eventName: ManagedHookEventName,
  entry: ManagedHookEntry,
  hook: ManagedHookEntry["hooks"][number],
): JsonObject {
  return {
    event_name: CODEX_HOOK_EVENT_LABELS[eventName],
    ...(entry.matcher ? { matcher: entry.matcher } : {}),
    hooks: [
      {
        type: "command",
        command: hook.command,
        timeout: Math.max(1, hook.timeout ?? 600),
        async: false,
        ...(hook.statusMessage ? { statusMessage: hook.statusMessage } : {}),
      },
    ],
  };
}

function managedHookStateKey(
  hooksPath: string,
  eventName: ManagedHookEventName,
  groupIndex: number,
  handlerIndex: number,
): string {
  return `${hooksPath}:${CODEX_HOOK_EVENT_LABELS[eventName]}:${groupIndex}:${handlerIndex}`;
}

export function buildManagedCodexHookTrustState(
  hooksPath: string,
  pkgRoot: string,
  options: ManagedCodexHookOptions = {},
): Record<string, ManagedCodexHookTrustState> {
  const managedConfig = buildManagedCodexHooksConfig(pkgRoot, {
    ...options,
    ...(options.platform === "win32" && !options.codexHomeDir
      ? { codexHomeDir: dirname(hooksPath) }
      : {}),
  });
  const state: Record<string, ManagedCodexHookTrustState> = {};

  for (const eventName of MANAGED_HOOK_EVENTS) {
    const entries = managedConfig.hooks[eventName] as ManagedHookEntry[];
    entries.forEach((entry, groupIndex) => {
      entry.hooks.forEach((hook, handlerIndex) => {
        if (hook.type !== "command" || !isOmxManagedHookCommand(hook.command)) {
          return;
        }
        const key = managedHookStateKey(
          hooksPath,
          eventName,
          groupIndex,
          handlerIndex,
        );
        state[key] = {
          trusted_hash: versionForCodexTomlIdentity(
            normalizedCommandHookIdentity(eventName, entry, hook),
          ),
        };
      });
    });
  }

  return state;
}

export function buildManagedCodexHookTrustToml(
  hooksPath: string | undefined,
  pkgRoot: string,
  options: ManagedCodexHookOptions = {},
): string {
  if (!hooksPath) return "";
  const state = buildManagedCodexHookTrustState(hooksPath, pkgRoot, options);
  return Object.entries(state)
    .sort(([left], [right]) => left.localeCompare(right))
    .flatMap(([key, hookState]) => [
      `[hooks.state."${escapeTomlBasicString(key)}"]`,
      `trusted_hash = "${escapeTomlBasicString(hookState.trusted_hash)}"`,
      "",
    ])
    .join("\n")
    .trimEnd();
}

function pathSegments(filePath: string): string[] {
  return filePath.split(/[\\/]+/).filter(Boolean);
}

export function isRuntimeCodexHomeMirrorPath(
  hookConfigPath: string,
  cwd: string = process.cwd(),
): boolean {
  if (basename(hookConfigPath) !== "hooks.json") return false;

  const absolutePath = resolve(cwd, hookConfigPath);
  const relativePath = relative(resolve(cwd), absolutePath);
  const segments = pathSegments(relativePath);
  if (relativePath === "" || segments[0] === "..") {
    return false;
  }

  const omxIndex = segments.indexOf(".omx");
  if (omxIndex < 0) return false;

  return (
    segments[omxIndex + 1] === "runtime" &&
    segments[omxIndex + 2] === "codex-home" &&
    segments.length > omxIndex + 4 &&
    segments[segments.length - 1] === "hooks.json"
  );
}

export async function dedupeCodexHookConfigPaths(
  hookConfigPaths: readonly string[],
  cwd: string = process.cwd(),
): Promise<{
  paths: DedupedCodexHookConfigPath[];
  skipped: SkippedCodexHookConfigPath[];
}> {
  const seenRealpaths = new Set<string>();
  const paths: DedupedCodexHookConfigPath[] = [];
  const skipped: SkippedCodexHookConfigPath[] = [];

  for (const hookConfigPath of hookConfigPaths) {
    if (isRuntimeCodexHomeMirrorPath(hookConfigPath, cwd)) {
      skipped.push({
        path: hookConfigPath,
        reason: "runtime_codex_home_mirror",
      });
      continue;
    }

    let canonicalPath: string;
    try {
      canonicalPath = await realpath(hookConfigPath);
    } catch {
      canonicalPath = resolve(cwd, hookConfigPath);
    }

    if (seenRealpaths.has(canonicalPath)) {
      skipped.push({
        path: hookConfigPath,
        reason: "duplicate_realpath",
        canonicalPath,
      });
      continue;
    }

    seenRealpaths.add(canonicalPath);
    paths.push({ path: hookConfigPath, reason: "unique" });
  }

  return { paths, skipped };
}

const DEFAULT_DISCOVER_HOOK_CONFIG_MAX_FILES = 5_000;
const DISCOVER_HOOK_CONFIG_EXCLUDED_DIRS = new Set([
  ".git",
  "node_modules",
  "dist",
  "target",
]);

export async function discoverCodexHookConfigPaths(
  cwd: string = process.cwd(),
  options: DiscoverCodexHookConfigPathsOptions = {},
): Promise<{
  paths: DedupedCodexHookConfigPath[];
  skipped: SkippedCodexHookConfigPath[];
}> {
  const root = resolve(cwd);
  const maxFiles = options.maxFiles ?? DEFAULT_DISCOVER_HOOK_CONFIG_MAX_FILES;
  const pending = [root];
  const candidates: string[] = [];
  let visitedFiles = 0;

  while (pending.length > 0 && visitedFiles < maxFiles) {
    const dir = pending.pop()!;
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);

    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!DISCOVER_HOOK_CONFIG_EXCLUDED_DIRS.has(entry.name)) {
          pending.push(fullPath);
        }
        continue;
      }

      if (!entry.isFile() && !entry.isSymbolicLink()) continue;
      visitedFiles += 1;
      if (entry.name === "hooks.json") candidates.push(fullPath);
      if (visitedFiles >= maxFiles) break;
    }
  }

  return dedupeCodexHookConfigPaths(candidates, root);
}

export function mergeManagedCodexHooksConfig(
  existingContent: string | null | undefined,
  pkgRoot: string,
  hooksPathOrOptions?: string | ManagedCodexHookOptions,
  options: ManagedCodexHookOptions = {},
): string {
  const hooksPath = typeof hooksPathOrOptions === "string" ? hooksPathOrOptions : undefined;
  const providedOptions = typeof hooksPathOrOptions === "object" && hooksPathOrOptions !== null
    ? hooksPathOrOptions
    : options;
  const resolvedOptions = {
    ...providedOptions,
    ...(hooksPath && providedOptions.platform === "win32" && !providedOptions.codexHomeDir
      ? { codexHomeDir: dirname(hooksPath) }
      : {}),
  };
  const managedConfig = buildManagedCodexHooksConfig(pkgRoot, resolvedOptions);
  const parsed =
    typeof existingContent === "string"
      ? parseCodexHooksConfig(existingContent)
      : null;

  const nextRoot = parsed ? cloneJson(parsed.root) : {};
  const nextHooks = parsed ? cloneJson(parsed.hooks) : {};
  const misplacedHookState = isPlainObject(nextHooks.state)
    ? cloneJson(nextHooks.state)
    : {};
  delete nextHooks.state;

  for (const eventName of MANAGED_HOOK_EVENTS) {
    const existingEntries = Array.isArray(nextHooks[eventName])
      ? nextHooks[eventName]
      : [];
    const preservedEntries: unknown[] = [];

    for (const entry of existingEntries) {
      const stripped = stripManagedHooksFromEntry(entry);
      if (stripped.entry !== null) {
        preservedEntries.push(stripped.entry);
      }
    }

    nextHooks[eventName] = [
      ...preservedEntries,
      ...managedConfig.hooks[eventName].map((entry) => cloneJson(entry)),
    ];
  }

  const existingRootState = isPlainObject(nextRoot.state)
    ? cloneJson(nextRoot.state)
    : {};
  const nextState = {
    ...misplacedHookState,
    ...existingRootState,
  };

  const managedTrustState = hooksPath
    ? buildManagedCodexHookTrustState(hooksPath, pkgRoot, resolvedOptions)
    : {};
  for (const [key, hookState] of Object.entries(managedTrustState)) {
    const existingHookState = isPlainObject(nextState[key])
      ? nextState[key]
      : {};
    nextState[key] = {
      ...existingHookState,
      trusted_hash: hookState.trusted_hash,
    };
  }
  if (Object.keys(nextState).length > 0) {
    nextRoot.state = nextState;
  } else if (isPlainObject(nextRoot.state)) {
    delete nextRoot.state;
  }

  if (Object.keys(nextHooks).length > 0) {
    nextRoot.hooks = nextHooks;
  } else {
    delete nextRoot.hooks;
  }

  return serializeCodexHooksConfig(nextRoot);
}

export function removeManagedCodexHooks(
  existingContent: string,
): RemoveManagedCodexHooksResult {
  const parsed = parseCodexHooksConfig(existingContent);
  if (!parsed) {
    return { nextContent: existingContent, removedCount: 0 };
  }

  const nextRoot = cloneJson(parsed.root);
  const nextHooks = cloneJson(parsed.hooks);
  const misplacedHookState = isPlainObject(nextHooks.state)
    ? cloneJson(nextHooks.state)
    : {};
  delete nextHooks.state;
  let removedCount = 0;

  for (const [eventName, rawEntries] of Object.entries(nextHooks)) {
    if (!Array.isArray(rawEntries)) continue;

    const preservedEntries: unknown[] = [];
    for (const entry of rawEntries) {
      const stripped = stripManagedHooksFromEntry(entry);
      removedCount += stripped.removedCount;
      if (stripped.entry !== null) {
        preservedEntries.push(stripped.entry);
      }
    }

    if (preservedEntries.length > 0) {
      nextHooks[eventName] = preservedEntries;
    } else {
      delete nextHooks[eventName];
    }
  }

  if (removedCount === 0) {
    return { nextContent: existingContent, removedCount: 0 };
  }

  const hasRemainingHookEntries = Object.keys(nextHooks).length > 0;
  if (hasRemainingHookEntries) {
    const existingRootState = isPlainObject(nextRoot.state)
      ? cloneJson(nextRoot.state)
      : {};
    const nextState = {
      ...misplacedHookState,
      ...existingRootState,
    };
    if (Object.keys(nextState).length > 0) {
      nextRoot.state = nextState;
    } else if (isPlainObject(nextRoot.state)) {
      delete nextRoot.state;
    }
  } else {
    delete nextRoot.state;
  }

  if (hasRemainingHookEntries) {
    nextRoot.hooks = nextHooks;
  } else {
    delete nextRoot.hooks;
  }

  if (Object.keys(nextRoot).length === 0) {
    return { nextContent: null, removedCount };
  }

  return {
    nextContent: serializeCodexHooksConfig(nextRoot),
    removedCount,
  };
}

export function hasCodexHookEntries(content: string): boolean {
  const parsed = parseCodexHooksConfig(content);
  if (!parsed) return false;

  return Object.entries(parsed.hooks).some(([eventName, rawEntries]) => {
    if (eventName === "state" || !Array.isArray(rawEntries)) return false;
    return rawEntries.some((entry) => {
      return isPlainObject(entry) &&
        Array.isArray(entry.hooks) &&
        entry.hooks.length > 0;
    });
  });
}

export function hasUserCodexHooksAfterManagedRemoval(
  existingContent: string,
): boolean {
  const { nextContent } = removeManagedCodexHooks(existingContent);
  return nextContent !== null && hasCodexHookEntries(nextContent);
}
