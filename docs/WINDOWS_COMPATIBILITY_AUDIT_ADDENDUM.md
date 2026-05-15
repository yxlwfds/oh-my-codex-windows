# Windows 平台兼容性 — 补充审计 (Addendum)

> **交叉引用**：见 [`../WINDOWS_COMPATIBILITY_ANALYSIS.md`](../WINDOWS_COMPATIBILITY_ANALYSIS.md) 主文档
> **审计范围**：本轮代码巡查（read-only），不含已被主文档覆盖的条目
> **日期**：2026-05-14
> **审计基线**：当前 `HEAD`，目标版本 ≥ v0.17.0+

---

## 总览 (Summary Table)

| # | 优先级 | 问题 | 类别 | 关键文件 | 修复成本 |
|---|--------|------|------|----------|----------|
| 1 | **P0** | reply-listener Windows 身份校验直接 `return false` | 安全/平台适配 | `src/notifications/reply-listener.ts` | 中 |
| 2 | **P0** | PowerShell shim 内 `continue` 在无循环上下文中失效 | 脚本 bug | `src/config/codex-hooks.ts` | 低 |
| 3 | **P0** | `writeSessionStart` / `reconcileNativeSessionStart` 非原子写 | 数据完整性 | `src/hooks/session.ts` | 中 |
| 4 | **P1** | 12+ 处缺 EPERM/EBUSY 重试的"伪原子写" | 并发稳定性 | 多个文件（见详表） | 中 |
| 5 | **P1** | `runtime/process-tree.ts` Windows 无法清理子进程树 | 进程管理 | `src/runtime/process-tree.ts` | 中 |
| 6 | **P1** | `cli/cleanup.ts` Windows 上 `process.kill` 仅杀单进程 | 进程管理 | `src/cli/cleanup.ts` | 中 |
| 7 | **P1** | `mcp/bootstrap.listProcessTable` Windows 返回 `null` | 功能缺失 | `src/mcp/bootstrap.ts` | 中 |
| 8 | **P2** | `notify-fallback-state.json` 缺 session-scope | 多进程隔离 | `src/scripts/notify-fallback-watcher.ts` | 低 |
| 9 | **P2** | Watcher/reply-listener 未监听 `SIGBREAK` | 进程清理 | `src/scripts/notify-fallback-watcher.ts`, `src/notifications/reply-listener.ts` | 低 |
| 10 | **P2** | 三处遗留 `shell: true`（doctor / agents / autoresearch） | 安全/平台适配 | 3 个文件 | 低 |
| 11 | **P2** | `worktree.branchExists` 缺 `windowsHide` | 平台适配 | `src/team/worktree.ts` | 低 |
| 12 | **P2** | `linkProjectResources` Windows dir symlink 无 junction fallback | 平台适配 | `src/cli/index.ts` | 低 |
| 13 | **P2** | `team/state/locks.ts` mkdir/writeFile 间隙僵尸锁窗口 | 并发稳定性 | `src/team/state/locks.ts` | 低 |

---

## P0 必修

### 1. reply-listener Windows 身份校验直接 `return false`

**位置**：`@src/notifications/reply-listener.ts:279-313`

```ts
// @src/notifications/reply-listener.ts:279-295
export function isReplyListenerProcess(
  pid: number,
  options: {
    platform?: NodeJS.Platform;
    env?: NodeJS.ProcessEnv;
    existsImpl?: typeof existsSync;
    spawnImpl?: typeof spawnSync;
  } = {},
): boolean {
  try {
    const platform = options.platform ?? process.platform;
    if (platform === 'linux') {
      const cmdline = readFileSync(`/proc/${pid}/cmdline`, 'utf-8');
      return cmdline.includes(DAEMON_IDENTITY_MARKER);
    }
    if (process.platform === 'win32') return false;  // ← 直接返回 false
    // macOS and other POSIX systems
    const { result } = spawnPlatformCommandSync('ps', ['-p', String(pid), '-o', 'args='], ...);
    if (result.status !== 0 || result.error) return false;
    return (result.stdout ?? '').includes(DAEMON_IDENTITY_MARKER);
  } catch {
    return false;
  }
}
```

**根因 (Root cause)**：Windows 上没有 `/proc` 文件系统，`ps` 命令也不可用，但直接 `return false` 意味着 `isReplyListenerProcess` 在 Windows 上**永远无法验证** daemon 进程身份。

**影响 (Impact)**：
- `isDaemonRunning()` 调用 `isReplyListenerProcess(pid)` → 在 Windows 上永远返回 `false`
- 导致 `isDaemonRunning()` 总是返回 `false`（经历过 `isProcessRunning` 检查后立即失败）
- daemon 的 PID 文件被当作"stale"删除，但实际 daemon 可能仍在运行
- 由于 `stopDaemon()` 也依赖此函数，无法安全停止 daemon
- 多个 daemon 实例可能同时启动，造成竞态

**最佳实践 (Recommended fix)**：
在 Windows 上使用 `wmic process where ProcessId={pid} get CommandLine` 或 PowerShell `Get-CimInstance Win32_Process -Filter "ProcessId = {pid}" | Select-Object -ExpandProperty CommandLine` 读取命令行，在结果中匹配 `DAEMON_IDENTITY_MARKER`。

```ts
if (platform === 'win32') {
  const result = spawnPlatformCommandSync(
    'powershell.exe',
    ['-NoProfile', '-Command',
     `Get-CimInstance Win32_Process -Filter "ProcessId = ${pid}" | Select-Object -ExpandProperty CommandLine`],
    { encoding: 'utf-8', timeout: 3000, windowsHide: true },
    platform, options.env, options.existsImpl, options.spawnImpl,
  );
  return (result.stdout ?? '').includes(DAEMON_IDENTITY_MARKER);
}
```

**关联引用 (See also)**：主文档 §4 (Multiplexer), §11.7 (进程衍生)

---

### 2. PowerShell shim 内 `continue` 在无循环上下文中失效

**位置**：`@src/config/codex-hooks.ts:143-199`

```powershell
# @src/config/codex-hooks.ts:164-189 (生成的 shim 脚本内容)
while (-not (Test-Path -LiteralPath $hookScript)) {
  # ... timeout logic
}                                                                         # ← while 循环在此结束
$startInfo = [System.Diagnostics.ProcessStartInfo]::new()
$startInfo.FileName = ...
$process = [System.Diagnostics.Process]::new()
$process.StartInfo = $startInfo
try {
  $null = $process.Start()
} catch {
  if ([DateTime]::UtcNow -ge $deadline) {
    [Console]::Out.WriteLine('{}')
    exit 0
  }
  Start-Sleep -Milliseconds 200
  continue                                                               # ← continue 在 while 循环之外！
}
```

**根因 (Root cause)**：`continue` 语句（L188）位于 `while` 循环（L164-L170）**之后**，不在任何循环上下文中。PowerShell 的 `continue` 只能用于 `while`/`for`/`foreach`/`do` 循环块内部。此处若 `$process.Start()` 抛出异常且未超时，`continue` 会失败，错误被静默吞没或导致脚本行为不可预期。

**影响 (Impact)**：
- 当 `node.exe` 进程启动失败（例如正在被 Defender 扫描、临时被锁定）且 shim 未超时时，不会重试
- 后续 `$process.StandardOutput.ReadToEndAsync()` 等语句在 catch 块之后仍会执行，但 `$process` 可能处于未启动或异常状态
- 导致 SessionStart 等关键 hook 可能输出垃圾或超时，进而触发 Codex 的 hook 超时降级

**最佳实践 (Recommended fix)**：
将整个 `try/catch` + `$process.Start()` 逻辑包在一个 `while ($true)` 或 `do { ... } while` 循环中，使 `continue` 真正实现重试语义：

```powershell
do {
  try {
    $null = $process.Start()
    break
  } catch {
    if ([DateTime]::UtcNow -ge $deadline) {
      [Console]::Out.WriteLine('{}')
      exit 0
    }
    Start-Sleep -Milliseconds 200
    continue
  }
} while ($true)
```

> 也可是 `while ($true) { try { $null = $process.Start(); break } catch { ... continue } }`。

**关联引用 (See also)**：主文档 §2 (Windows Hook Shim 机制)

---

### 3. `writeSessionStart` / `reconcileNativeSessionStart` 非原子写

**位置**：`@src/hooks/session.ts:287-315`, `@src/hooks/session.ts:323-370`

```ts
// @src/hooks/session.ts:287-315
export async function writeSessionStart(cwd, sessionId, options = {}): Promise<SessionState> {
  const stateDir = omxStateDir(cwd);
  await mkdir(stateDir, { recursive: true });
  // ...
  const state = createSessionState(cwd, sessionId, pid, platform, linuxIdentity, { ... });
  await writeFile(sessionPath(cwd), JSON.stringify(state, null, 2));  // ← 直接 writeFile，非 temp+rename
  // ...
}

// @src/hooks/session.ts:323-370
export async function reconcileNativeSessionStart(cwd, nativeSessionId, options = {}): Promise<SessionState> {
  const existing = await readUsableSessionState(cwd, { ... });
  // ...
  await writeFile(sessionPath(cwd), JSON.stringify(state, null, 2));  // ← 同样直接 writeFile
  // ...
}
```

**根因 (Root cause)**：两处关键 session 状态写入均使用 `writeFile` 直接覆盖，而非 `writeFile(tmp) → rename(tmp, target)` 的原子写入模式。虽然在 v0.17.0+ 默认隔离模式下多进程 session.json 竞态已被消除，但**同一进程内崩溃**场景下仍然危险：

```
进程调用 writeFile → 写入一半 → 崩溃/断电
→ session.json 内容被截断/损坏
→ 后续 hook 读取 → JSON.parse 失败 → session state = null
```

**影响 (Impact)**：
- **崩溃场景**：进程意外终止时，`session.json` 可能处于半写入状态
- HUD、通知、hook 上下文等依赖 `readSessionState()` 的模块在进程重启后读取到损坏的 JSON
- `writeSessionEnd` 在读取到 `null`/损坏状态时，`ownsCurrentSessionFile` 判断异常
- 默认隔离模式的隔离目录位于 `~/.omx-runs/run-*`，崩溃后残留损坏文件影响故障排查

**最佳实践 (Recommended fix)**：
将 `writeFile` 替换为 `writeFile(tmp) → rename(tmp, target)` + Windows EPERM/EBUSY 重试（与主文档 §11.1 已修复的 5 处一致）：

```ts
import { renameForAtomicWrite } from '../utils/atomic-write.js';

async function writeSessionFile(cwd, state) {
  const targetPath = sessionPath(cwd);
  const tmpPath = targetPath + '.tmp.' + process.pid;
  await writeFile(tmpPath, JSON.stringify(state, null, 2));
  await renameForAtomicWrite(tmpPath, targetPath);  // 含 EPERM/EBUSY 重试
}
```

**关联引用 (See also)**：主文档 §11.1 (原子写入陷阱), §14.2 (session.json 乒乓覆盖)

---

## P1 应修

### 4. 12+ 处缺 EPERM/EBUSY 重试的"伪原子写"

**主文档已修复的 5 处**（不再重复）：
- `src/team/state.ts` `writeAtomic()`
- `src/exec/followup.ts` `writeQueue()`
- `src/wiki/storage.ts` `atomicWriteFileSync()`
- `src/scripts/notify-fallback-watcher.ts` `writeJsonObjectAtomically()`
- `src/notifications/session-registry.ts` `rewriteRegistryUnsafe()`

**本轮新发现的未修复伪原子写**（均使用 `temp → rename` 模式但无 EPERM/EBUSY 重试）：

| # | 文件 | 函数/位置 | 代码行 | 写类型 | 风险 |
|---|------|-----------|--------|--------|------|
| 4a | `src/runtime/run-state.ts` | `writeRunState()` | L150 | `async rename` | 多进程 run state 竞态 |
| 4b | `src/mcp/memory-server.ts` | `writeNote()` (2处) | L301, L322 | `async rename` | MCP note 写入失败 |
| 4c | `src/scripts/notify-hook/team-worker-stop.ts` | stop hook | L56 | `async rename` | worker stop 状态丢失 |
| 4d | `src/notifications/reply-listener.ts` | log rotation | L142 | `renameSync` | 日志轮转失败，无重试 |
| 4e | `src/state/operations.ts` | `writeState()` | L82 | `async rename` | 通用状态写入失败 |
| 4f | `src/scripts/notify-fallback-watcher.ts` | log rotation / cooldown | L412, L794 | `async rename` | watcher 日志/状态损坏 |
| 4g | `src/scripts/notify-fallback-watcher.ts` | `writeWatcherState()` | L1090 | `async rename` | watcher 状态丢失 |
| 4h | `src/scripts/notify-hook/team-worker.ts` | heartbeat / state / cooldown | L348, L567, L623, L666 | `async rename` | worker 心跳/状态损坏 |
| 4i | `src/scripts/notify-hook/team-dispatch.ts` | dispatch state | L187 | `async rename` | dispatch 状态损坏 |
| 4j | `src/scripts/notify-hook/ralph-session-resume.ts` | resume state | L128 | `async rename` | ralph 恢复状态丢失 |
| 4k | `src/cli/setup.ts` | config backup | L377 | `async rename` | setup 备份失败 |
| 4l | `src/team/runtime-cli.ts` | panes state | L113 | `async rename` | panes 状态损坏 |

**根因 (Root cause)**：所有这些位置都实现了 `writeFile(tmpPath) → rename(tmpPath, targetPath)` 模式，但 `rename` 失败后的错误处理不完整——仅 catch 通用错误或保留默认向上抛，没有针对 Windows EPERM/EBUSY 的重试逻辑。

**影响 (Impact)**：在 Windows 上，当目标文件被 Defender、Search Indexer、OneDrive 等短暂锁定时，这些写入会直接失败。在并发场景（多个 worker hook 同时触发、多个 `owx exec` 进程）下尤其明显。

**最佳实践 (Recommended fix)**：
参照主文档 §11.1 已修复方案，抽取统一的 `src/utils/atomic-write.ts`：

```ts
// src/utils/atomic-write.ts (建议新建)
import { rename, writeFile } from 'fs/promises';

const EPERM_RETRY_DELAYS_MS = [50, 100, 150];

export async function atomicWriteWithRetry(
  targetPath: string,
  content: string,
  options?: { encoding?: BufferEncoding },
): Promise<void> {
  const tmpPath = `${targetPath}.tmp.${process.pid}`;
  await writeFile(tmpPath, content, options?.encoding ?? 'utf-8');
  for (let i = 0; i <= EPERM_RETRY_DELAYS_MS.length; i++) {
    try {
      await rename(tmpPath, targetPath);
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if ((code === 'EPERM' || code === 'EBUSY') && i < EPERM_RETRY_DELAYS_MS.length) {
        await new Promise(r => setTimeout(r, EPERM_RETRY_DELAYS_MS[i]));
        continue;
      }
      throw err;
    }
  }
}
```

然后逐批将所有伪原子写替换为 `atomicWriteWithRetry()`。

**关联引用 (See also)**：主文档 §11.1 (原子写入陷阱), §14.13 (多进程 writeAtomic EPERM)

---

### 5. `runtime/process-tree.ts` Windows 无法清理子进程树

**位置**：`@src/runtime/process-tree.ts:41-59`

```ts
// @src/runtime/process-tree.ts:41-59
function killProcessTree(child: ChildProcess, platform: NodeJS.Platform, signal: NodeJS.Signals): void {
  if (child.pid === undefined) return;
  try {
    if (platform === 'win32') {
      child.kill(signal);                                    // ← 仅 kill 直接子进程
      return;
    }
    // Children are launched as a detached process group on POSIX
    process.kill(-child.pid, signal);                        // ← POSIX: 负 PID 杀死整棵进程树
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ESRCH') return;
    try {
      child.kill(signal);
    } catch (fallbackErr) {
      if ((fallbackErr as NodeJS.ErrnoException).code !== 'ESRCH') throw fallbackErr;
    }
  }
}
```

**根因 (Root cause)**：Windows 上 `child.kill(signal)` 只终止直接子进程（wrapper 进程），不包含其子进程（孙进程）。Node.js 在 Windows 上没有等同 POSIX `-pid` 的进程组信号机制。此外，第 206-207 行的 `sweepProcessGroupAfterParentExit` 中 `if (platform === 'win32') return;` 也跳过了 Windows 的进程树清理。

**影响 (Impact)**：
- `runProcessTreeWithTimeout()` 超时终止后，孙进程可能变为孤儿进程继续运行
- MCP server 进程（由 wrapper 启动的 Node.js 子进程）泄漏
- 内存/CPU 资源泄漏，尤其在高频 `owx exec` 场景下
- `cleanupOnParentExit` 在 Windows 上不可靠

**最佳实践 (Recommended fix)**：
在 Windows 上使用 `taskkill /F /T /PID {pid}` 杀死整个进程树：

```ts
if (platform === 'win32') {
  try {
    // /T = tree kill, /F = force
    execFileSync('taskkill', ['/F', '/T', '/PID', String(child.pid)], {
      windowsHide: true, stdio: 'ignore',
    });
  } catch {
    child.kill('SIGKILL');
  }
  return;
}
```

**关联引用 (See also)**：主文档 §11.7 (进程衍生与系统资源), §11.8 (winmux daemon)

---

### 6. `cli/cleanup.ts` Windows 上 `process.kill` 仅杀单进程

**位置**：`@src/cli/cleanup.ts:423`

```ts
// @src/cli/cleanup.ts:423
const sendSignal = dependencies.sendSignal ?? ((pid: number, signal: NodeJS.Signals) => process.kill(pid, signal));
```

以及 `defaultIsPidAlive` (L360-367) 仅使用 `process.kill(pid, 0)` 而没有用 `taskkill` 作为补充来验证存活。

**根因 (Root cause)**：`owx cleanup` 命令依赖默认的 `process.kill(pid, signal)` 发送信号。在 Windows 上 `process.kill` 只能终止单个指定 PID 的进程，无法递归清理子进程。如果 MCP server 是 spawn 一个 wrapper 后再启动 worker 的模式，wrapper 被杀死但 worker 存活。

**影响 (Impact)**：
- `owx cleanup` 在 Windows 上清理不彻底
- 孤儿 MCP server 子进程残留
- 清理候选（orphaned MCP servers with ppid=1）虽然被杀，但其子进程仍在运行

**最佳实践 (Recommended fix)**：
在 Windows 上使用 `taskkill /F /T /PID` 替代 `process.kill` 进行进程清理，与 Issue #5 共用同一个 `killProcessTree` 工具函数。

**关联引用 (See also)**：主文档 §9.3 (故障排查 - Winmux 问题)

---

### 7. `mcp/bootstrap.listProcessTable` Windows 返回 null

**位置**：`@src/mcp/bootstrap.ts:116-132`

```ts
// @src/mcp/bootstrap.ts:116-132
export function listProcessTable(
  readPs: typeof execFileSync = execFileSync,
): ProcessTableEntry[] | null {
  if (process.platform === 'win32') {
    return null;                                               // ← 直接放弃，禁用重复检测
  }

  try {
    const output = readPs('ps', ['axww', '-o', 'pid=,ppid=,command='], {
      encoding: 'utf-8',
      windowsHide: true,
    });
    return parseProcessTable(output);
  } catch {
    return null;
  }
}
```

**根因 (Root cause)**：`ps` 命令在 Windows 上不存在，但未提供替代方案。

**影响 (Impact)**：
- `listProcessTable()` 返回 `null` → 调用方 `runDuplicateSiblingWatchdog()` (L436-441) 将 `duplicateObservedAtMs` 设为 `null`
- Windows 上**完全无法检测**同一 MCP server 的重复实例
- MCP bootstrap 的 duplicate detection 功能在 Windows 上形同虚设
- 可能导致两套 MCP state/memory servers 同时运行，状态不一致

**最佳实践 (Recommended fix)**：
使用 `cleanup.ts` 已有的 PowerShell 进程列表脚本（`WINDOWS_PROCESS_DISCOVERY_SCRIPT`, L29-34）或 `tasklist /FO CSV` 在 Windows 上获取进程表：

```ts
if (process.platform === 'win32') {
  try {
    const output = execFileSync('powershell.exe', [
      '-NoProfile', '-Command',
      'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,CommandLine | ConvertTo-Csv -NoTypeInformation',
    ], { encoding: 'utf-8', windowsHide: true });
    return parseWindowsCsvProcessTable(output);
  } catch {
    return null;
  }
}
```

**关联引用 (See also)**：`src/cli/cleanup.ts` L29-34 (已有 PowerShell 进程发现脚本可复用)

---

## P2 可修

### 8. `notify-fallback-state.json` 缺 session-scope

**位置**：`@src/scripts/notify-fallback-watcher.ts:164`

```ts
// @src/scripts/notify-fallback-watcher.ts:164
const statePath = join(stateDir, 'notify-fallback-state.json');
//                                    ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
//                                    无 sessionId 后缀！
```

对比已修复的 PID 文件（主文档 §12.3）：
```ts
// 已修复：PID 文件带 sessionId
const pidFilePath = resolve(argValue('--pid-file', join(stateDir, 'notify-fallback.pid')));  // 但实际传入了 sessionId
```

**根因 (Root cause)**：PID 文件在 §12.3 中已改为 `notify-fallback.{sessionId}.pid`，但 state 文件 (`notify-fallback-state.json`) 仍使用全局路径，多个 session 的 watcher 共享同一 state 文件。

**影响 (Impact)**：
- 不同 session 的 watcher 互相覆盖 `dispatch_drain`、`leader_nudge`、`authority_backoff` 等运行时状态
- Watcher 的 authority-only backoff 逻辑在 session A 看到的可能是 session B 的状态
- 低影响：因为 `notify-fallback.pid` 已隔离，两个 watcher 本身不会同时运行太久（后启动的会 kill 先启动的）

**最佳实践 (Recommended fix)**：
将 `statePath` 也改为 session-scoped，与 PID 文件保持一致：

```ts
const statePath = join(stateDir, `notify-fallback-state.${sessionId}.json`);
```

**关联引用 (See also)**：主文档 §12.3 (notify-fallback-watcher 多实例支持)

---

### 9. Watcher/reply-listener 未监听 `SIGBREAK`

**位置**：
- `@src/scripts/notify-fallback-watcher.ts:2005-2007`
- `@src/notifications/reply-listener.ts:906-907`

```ts
// notify-fallback-watcher.ts:2005-2007 — 无 SIGBREAK
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGHUP', () => shutdown('SIGHUP'));
// 缺少: process.on('SIGBREAK', () => shutdown('SIGBREAK'));

// reply-listener.ts:906-907 — 无 SIGHUP 和 SIGBREAK
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
// 缺少: process.on('SIGHUP', shutdown);
// 缺少: process.on('SIGBREAK', shutdown);
```

**对比**：`winmux/daemon/lifecycle.ts` L83-115 已正确监听 `SIGBREAK`，可作为参考实现。

**根因 (Root cause)**：`SIGBREAK` 是 Windows 上的 `Ctrl+Break` 信号等效物。当用户在 Windows Terminal 或 Console 中按 `Ctrl+Break` 或关闭窗口时，进程收到 `SIGBREAK`。不处理此信号导致 watcher/daemon 无法优雅退出。

**影响 (Impact)**：
- 用户关闭终端窗口时，watcher 不能及时清理 PID 文件和释放资源
- reply-listener 无法在终端关闭时安全停止轮询
- 残留的 PID 文件导致下次启动时触发 `reapStaleNotifyFallbackWatcher` 误杀

**最佳实践 (Recommended fix)**：
为两个文件均添加 SIGBREAK 处理（以及 reply-listener 补上 SIGHUP）。参照 `winmux/daemon/lifecycle.ts`：

```ts
// 兼容 Node.js 类型系统
process.on('SIGBREAK' as NodeJS.Signals, () => shutdown('SIGBREAK'));
```

**关联引用 (See also)**：`src/winmux/daemon/lifecycle.ts` L83-115 (正确实现参考)

---

### 10. 三处遗留 `shell: true`

| # | 文件 | 位置 | 上下文 |
|---|------|------|--------|
| 10a | `src/cli/doctor.ts` | L1169 | hook smoke test: `spawnSync(entrypoint.command, ..., { shell: true, ... })` |
| 10b | `src/cli/agents.ts` | L219 | 编辑器启动: `spawnSync(editor, [path], { shell: true, ... })` |
| 10c | `src/autoresearch/runtime.ts` | L478 | sandbox evaluator: `spawnSync(contract.sandbox.evaluator.command, { shell: true, ... })` |

**根因 (Root cause)**：`shell: true` 在 Windows 上通过 `cmd.exe /d /s /c` 执行命令，带来以下问题：
1. **参数转义差异**：`cmd.exe` 的引号规则与直接 `CreateProcess` 不同
2. **命令注入风险**：用户输入拼接到 shell 命令中时，可能被注入额外命令
3. **% 环境变量展开**：`cmd.exe` 会展开 `%VAR%`，可能导致意外行为
4. **性能开销**：多一层 `cmd.exe` 进程启动

**影响 (Impact)**：
- `doctor.ts`：hook smoke test 可能在路径含空格时解析错误
- `agents.ts`：编辑器打开在 Windows 上可能失败或行为不同（`vi` 在 Windows 上非原生）
- `autoresearch/runtime.ts`：sandbox evaluator 在 Windows 上路径和参数处理不一致

**最佳实践 (Recommended fix)**：
将 `shell: true` 替换为 `spawnPlatformCommandSync`（项目已有封装），实现平台感知的命令执行：

```ts
// doctor.ts 示例修复
import { spawnPlatformCommandSync } from '../utils/platform-command.js';
// 替代 shell: true 的 spawnSync
const { result } = spawnPlatformCommandSync(entrypoint.command, [], {
  cwd,
  env: { ...process.env, OMX_NATIVE_HOOK_DOCTOR_SMOKE: "1" },
  input: payload,
  timeout: 5_000,
});
```

**关联引用 (See also)**：`src/utils/platform-command.ts` (平台命令封装)

---

### 11. `worktree.branchExists` 缺 `windowsHide`

**位置**：`@src/team/worktree.ts:115-121`

```ts
// @src/team/worktree.ts:115-121
function branchExists(repoRoot: string, branchName: string): boolean {
  const result = spawnSync('git', ['show-ref', '--verify', '--quiet', `refs/heads/${branchName}`], {
    cwd: repoRoot,
    encoding: 'utf-8',
    // 缺少: windowsHide: true
  });
  return result.status === 0;
}
```

**对比**：同一文件中 `isWorktreeDirty` (L123-128) 已正确添加 `windowsHide: true`。

**根因 (Root cause)**：`spawnSync` 调用没有设置 `windowsHide: true`，导致在 Windows 上每次调用 `git show-ref` 会闪烁 CMD 窗口。

**影响 (Impact)**：
- 视觉闪烁：在 `owx team` 创建 worktree 时（`provisionWorktree` 调用 `branchExists` 检查分支是否已存在），每次都会弹闪 cmd 窗口
- 与项目整体规范不一致（项目中几乎所有 `spawn`/`spawnSync` 调用已统一使用 `windowsHide: true`）

**最佳实践 (Recommended fix)**：
一行修复，与 `isWorktreeDirty` 保持一致：

```ts
const result = spawnSync('git', ['show-ref', '--verify', '--quiet', `refs/heads/${branchName}`], {
  cwd: repoRoot,
  encoding: 'utf-8',
  windowsHide: true,      // ← 加上
});
```

**关联引用 (See also)**：主文档 §11.7 (进程衍生, `windowsHide` 统一使用)

---

### 12. `linkProjectResources` Windows dir symlink 无 junction fallback

**位置**：`@src/cli/index.ts:1256-1292`

```ts
// @src/cli/index.ts:1272-1273, 1287
// 文件 symlink
symlinkSync(sourcePath, targetPath, "file");

// plans 目录 symlink
symlinkSync(sourcePlansDir, targetPlansDir, "dir");  // ← 在无管理员权限的 Windows 上失败
```

**对比**：同一文件中 `linkOrCopyCodexHomeEntry` (L690-701) 已正确实现 junction fallback：

```ts
// @src/cli/index.ts:693 (正确实现)
await symlink(source, destination, stat.isDirectory() && process.platform === "win32" ? "junction" : undefined);
```

**根因 (Root cause)**：`linkProjectResources` 使用 `"dir"` 类型创建目录符号链接，这在 Windows 上**需要管理员权限**（或开发者模式）。`"junction"` 类型的 NTFS junction 不需要管理员权限，是 Windows 上目录链接的最佳实践。

此外，`linkOrCopyCodexHomeEntry` 有 `catch { copyFile/cp }` fallback 但 `linkProjectResources` 的 plans 目录链接没有 copy fallback。

**影响 (Impact)**：
- 普通用户（无管理员权限）使用 `owx launch` 自动隔离时，plans 目录链接失败
- `setup-scope.json` 等共享资源无法通过 symlink 共享到隔离目录，只能靠 `copyFileSync` fallback
- plans 目录直接链接失败且无 fallback → plans 目录在隔离 session 中不可用

**最佳实践 (Recommended fix)**：
1. 目录 symlink 使用 `"junction"` 替代 `"dir"`（与 `linkOrCopyCodexHomeEntry` 一致）
2. 为 plans 目录链接也添加 `copy` fallback

```ts
// 文件 - 保持 file 类型
try {
  symlinkSync(sourcePath, targetPath, "file");
} catch { copyFileSync(sourcePath, targetPath); }

// plans 目录 - 使用 junction
try {
  symlinkSync(sourcePlansDir, targetPlansDir, process.platform === "win32" ? "junction" : "dir");
} catch {
  cpSync(sourcePlansDir, targetPlansDir, { recursive: true, force: true });
}
```

**关联引用 (See also)**：`src/cli/index.ts` L690-701 (`linkOrCopyCodexHomeEntry` - 正确实现)

---

### 13. `team/state/locks.ts` mkdir/writeFile 间隙僵尸锁窗口

**位置**：`@src/team/state/locks.ts:80-110` (以及其他三个锁函数)

```ts
// @src/team/state/locks.ts:80-110 (withTeamLock 为例)
export async function withTeamLock<T>(...): Promise<T> {
  // ...
  while (true) {
    try {
      await mkdir(lockDir);                        // ← 步骤 1: 获取锁
      try {
        await writeFile(ownerPath, ownerToken, 'utf8');  // ← 步骤 2: 写入 owner
      } catch (error) {
        await rm(lockDir, { recursive: true, force: true });
        throw error;
      }
      break;
    } catch (error) {
      // ... 重试/超时逻辑
    }
  }
  // ... 执行业务 ... finally 释放锁
}
```

**同时影响的其他锁函数**：
- `withScalingLock` (L34-78)：同样的 mkdir → writeFile 间隙
- `withTaskClaimLock` (L125-167)：同样的 mkdir → writeFile 间隙（且步骤分离更明显）
- `withMailboxLock` (L169-218)：同样的 mkdir → writeFile 间隙

**根因 (Root cause)**：锁的获取分为两步：`mkdir`（创建锁目录）和 `writeFile`（写入 owner token）。两者之间不是原子操作。如果进程在步骤 1 和步骤 2 之间崩溃（或在步骤 2 中写入失败但 rm 也失败），锁目录存在但没有 owner 文件，形成**僵尸锁**——其他进程无法通过 `maybeRecoverStaleLock` 判断该锁是否过期（因为 `stat(lockDir).mtimeMs` 需要 lockDir 存在，但没有 owner 文件无法区分是"正在获取中"还是"僵尸"）。

对于 `withTaskClaimLock`（L125-167），问题更严重：步骤 1 获取锁后立即退出 while 循环，步骤 2 在 try/finally 中写入 owner。这意味着锁目录在步骤 1 后已对其他进程可见，但 owner 尚未写入——本质上是 TOCTOU 竞态窗口。

**影响 (Impact)**：
- 进程崩溃后留下无 owner 的僵尸锁目录
- `maybeRecoverStaleLock` 依赖 `lockDir` 的 `mtimeMs`，如果创建和写入间隔极短（同毫秒），可能误判为未过期
- 在高负载/高频锁竞争场景下，僵尸锁累积导致后续进程无法获取锁
- `withTaskClaimLock` 尤其脆弱：锁目录创建和 owner 写入之间没有 `try { writeFile } catch { rm }` 的保护

**最佳实践 (Recommended fix)**：
将 `mkdir` 和 `writeFile` 合并为原子操作，方法是在锁目录内使用 `O_CREAT | O_EXCL` 的文件锁模式：

```ts
// 方案 A：使用独占文件锁代替目录锁
const lockFd = openSync(lockFilePath, constants.O_CREAT | constants.O_EXCL | constants.O_RDWR);
// 如果成功，立即写入 owner
writeFileSync(lockFd, ownerToken);
// 释放: closeSync(lockFd); unlinkSync(lockFilePath);
```

或至少确保 mkdir 成功后立即写入 owner（不经过 try/finally 间隙）：

```ts
// 方案 B：在同一个 try 块内完成 mkdir + writeFile
try {
  await mkdir(lockDir);
  await writeFile(ownerPath, ownerToken, 'utf8');
} catch (error) {
  // mkdir 失败或 writeFile 失败 → 统一清理
  try { await rm(lockDir, { recursive: true, force: true }); } catch {}
  if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
  // ... 重试逻辑
}
```

**关联引用 (See also)**：主文档 §11.2 (mkdir 锁机制分析), §14.12 (PostToolUse mkdir 锁)

---

## 建议补充的测试

| 测试项 | 覆盖范围 | 优先级 |
|--------|----------|--------|
| `writeSessionStart` 多进程并发覆盖 | 崩溃场景下 session.json 完整性 | P0 |
| PowerShell shim `Start` 失败的退避路径 | shim 内 `continue` 重试逻辑 | P0 |
| `runtime/process-tree` Windows 进程树 (`taskkill /T /F`) 断言 | 子进程清理完整性 | P1 |
| `mcp/bootstrap` Windows duplicate detection 覆盖 | `listProcessTable` 在 Windows 上的替代实现 | P1 |
| `notify-fallback-state.json` session-scoped 路径隔离 | 多 session watcher 状态隔离 | P2 |
| reply-listener SIGBREAK 清理验证 | Windows 信号处理正确性 | P2 |
| `team/state/locks.ts` 僵尸锁恢复覆盖 | mkdir/writeFile 间隙崩溃场景 | P2 |

---

## 修复路线图

- **P0**（三条优先合入）：修复 reply-listener 身份校验、PowerShell shim `continue` bug、`writeSessionStart` 原子写
- **P1**（基础设施统一收口）：抽取 `src/utils/atomic-write.ts` + `src/utils/process-list.ts`，替换 12+ 处伪原子写 + Windows 进程树清理 + `listProcessTable` 替代实现
- **P2**（一行/两行级修补）：可在 P1 相同 PR 顺手处理 — `windowsHide`、`SIGBREAK`、`shell: true` 替换、`junction` fallback、僵尸锁窗口

---

## 后续动作（不在本次 PR 内）

文档落地后，按 P0 → P1 → P2 顺序开 issue 或单独 PR：

1. `fix(notifications): verify reply-listener daemon identity on Windows`
2. `fix(hooks): wrap PowerShell shim Start retry in a loop`
3. `fix(hooks): make writeSessionStart atomic with Windows EPERM retry`
4. `refactor: extract atomicRenameWithWindowsRetry helper` (+ 12 处替换)
5. `fix(runtime): kill process tree via taskkill on Windows` (含 cleanup.ts)
6. `feat(mcp): enable listProcessTable on Windows via WMIC`
7. P2 杂项可合并为一个 housekeeping PR

---

*审计基线 commit*：当前 `HEAD` (2026-05-14)
*审计引擎*：read-only code walkthrough
