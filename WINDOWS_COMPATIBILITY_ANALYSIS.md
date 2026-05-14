# Windows 平台兼容性问题分析报告

## 问题概述

基于代码库的深入分析，本文档列出了在 Windows 平台上使用 OMX (Oh-My-Codex) 时可能遇到的所有潜在问题和已实施的解决方案。

---

## 1. Hook JSON 输出问题 (已修复 ✅)

### 问题描述
- **SessionStart hook**: `error: hook returned invalid session start JSON output`
- **UserPromptSubmit hook**: `error: hook returned invalid user prompt submit JSON output`

### 根本原因
1. Hook 脚本在某些情况下输出非 JSON 内容或格式不正确的 JSON
2. 当构建上下文内容包含特殊字符或无法序列化的数据时，JSON 序列化失败
3. 异常情况下没有适当的降级处理机制
4. Windows PowerShell shim 在路径包含空格或特殊字符时可能引入额外的输出

### 修复方案
已在 `src/scripts/codex-native-hook.ts` 中实施以下修复：

#### 1.1 增强 JSON 输出函数
```typescript
function writeNativeHookJsonStdout(output: Record<string, unknown>): void {
  try {
    const jsonStr = JSON.stringify(output);
    // 确保输出是纯 JSON，不包含任何额外字符
    process.stdout.write(`${jsonStr}\n`);
  } catch (error) {
    // 如果序列化失败，输出空对象而不是崩溃
    process.stderr.write(`[omx-hook-serialize-error] ${error instanceof Error ? error.message : String(error)}\n`);
    process.stdout.write('{}\n');
  }
}
```

#### 1.2 添加上下文构建错误处理
```typescript
let additionalContext: string | null = null;
try {
  additionalContext = hookEventName === "SessionStart"
    ? await buildSessionStartContext(...)
    : buildAdditionalContextMessage(...);
} catch (error) {
  await logNativeHookCliError(cwd, `build_${hookEventName}_context_error`, error, payload);
  additionalContext = null;
}
```

#### 1.3 PowerShell Shim 优化
- Windows shim 脚本使用 `ProcessStartInfo` 确保正确重定向 stdin/stdout/stderr
- 路径引号转义处理：`quotePowerShellLiteral` 和 `quoteWindowsProcessArgument`
- 超时降级机制：15秒内找不到 hook 脚本时输出 `{}`

### 测试验证
✅ 已创建专项测试 `src/scripts/__tests__/windows-hook-json.test.ts`：
- ✅ SessionStart 中文字符处理
- ✅ UserPromptSubmit 工作流关键词检测
- ✅ 复杂嵌套数据的 additionalContext
- ✅ 畸形输入的优雅降级
- ✅ PowerShell shim JSON 转发

所有测试通过（5/5）：
```
▶ Windows Hook JSON output tolerance
  ✔ emits valid JSON for SessionStart with Chinese characters (558.5666ms)
  ✔ emits valid JSON for UserPromptSubmit with workflow keyword (300.1456ms)
  ✔ emits valid JSON when additionalContext contains complex nested data (444.2354ms)
  ✔ handles malformed input gracefully with parseable JSON output (258.6063ms)
  ✔ Windows PowerShell shim forwards JSON correctly (2331.3351ms)
✔ Windows Hook JSON output tolerance (3894.5431ms)
```

### 影响范围
- Windows 和 POSIX 平台都受益于此修复
- 特别提高了包含中文和特殊字符的处理能力

---

## 2. Windows Hook Shim 机制

### 架构设计
Windows 平台使用 PowerShell shim 脚本来调用 Node.js hook 脚本：

```
Codex → PowerShell shim → Node.js codex-native-hook.js
```

### 关键文件
- **Shim 脚本位置**: `.codex/hooks/omx-native-hook-windows-shim.ps1`
- **生成函数**: `buildManagedCodexNativeHookWindowsShimContent()`
- **配置注册**: `buildManagedCodexNativeHookCommand()`

### 潜在问题

#### 2.1 Shim 脚本路径问题
**风险**: 路径中包含空格或特殊字符时可能导致执行失败

**缓解措施**:
- 使用 `quotePowerShellLiteral()` 正确转义路径
- 使用 `quoteWindowsProcessArgument()` 处理 Windows 命令行参数

#### 2.2 超时处理
**机制**: 
- 默认超时: 15 秒
- 可通过 `OMX_NATIVE_HOOK_LAUNCH_TIMEOUT_MS` 环境变量调整
- 脚本不存在时输出空 JSON `{}` 而不是报错

---

## 3. 命令执行平台适配

### 3.1 平台命令解析器
文件: `src/utils/platform-command.ts`

#### Windows 特性处理
1. **PATHEXT 支持**: 自动尝试 `.com`, `.exe`, `.bat`, `.cmd`, `.ps1` 扩展名
2. **命令分类**:
   - `.exe`, `.com`: 直接执行
   - `.bat`, `.cmd`: 通过 `cmd.exe /d /s /c` 执行
   - `.ps1`: 通过 `powershell.exe -NoProfile -ExecutionPolicy Bypass -File` 执行

#### 3.2 Node.js 托管脚本
对于某些命令（如 `codex`），优先使用 Node.js 入口点而非 Windows shim：
```typescript
const WINDOWS_NODE_HOSTED_COMMANDS = {
  codex: ['node_modules', '@openai', 'codex', 'bin', 'codex.js']
};
```

### 3.3 潜在问题

#### 路径解析
- **问题**: Windows 路径可能包含反斜杠、空格、特殊字符
- **解决**: 使用 `win32.join()`, `win32.resolve()` 等平台特定函数

#### 命令引号
- **问题**: 不同 shell 对引号的处理不同
- **解决**: 
  - CMD: `quoteForCmd()` - 将 `"` 转义为 `""`
  - PowerShell: `quotePowerShellLiteral()` - 使用单引号并转义内部单引号

---

## 4. 多路复用器 (Multiplexer) 支持

### 4.1 Windows 专用方案: omx-winmux

#### 架构
```
OMX → WinMuxProvider → omx-winmux daemon → Windows PTY
```

#### 关键特性
1. **Daemon 模式**: 常驻进程管理所有 PTY
2. **Job Object**: 确保子进程清理
3. **Named Pipe IPC**: 高效的进程间通信

#### 文件位置
- Daemon: `src/winmux/daemon/index.ts`
- Provider: `src/winmux/provider/winmux-provider.ts`
- CLI: `owx` 命令

### 4.2 平台检测
```typescript
function isNativeWindows(): boolean {
  return platform === "win32" && !isWsl2() && !isMsysOrGitBash();
}
```

#### 检测逻辑
1. **WSL2 检测**: `WSL_DISTRO_NAME`, `WSL_INTEROP`, `/proc/version`
2. **MSYS/Git Bash 检测**: `MSYSTEM` 环境变量
3. **原生 Windows**: 排除上述两者后的 win32 平台

### 4.3 潜在问题

#### Daemon 启动失败
**症状**: `winmux RPC failed`
**原因**:
- node-pty 未正确安装
- Job Object 创建失败（权限问题）
- Named Pipe 冲突

**排查**:
```bash
# 检查 daemon 状态
owx winmux status

# 查看日志
cat .omx/logs/winmux-daemon.log
```

#### 环境变量强制
```bash
# 强制使用 winmux (即使非 Windows)
export OMX_FORCE_WINMUX=1

# 强制使用 tmux (即使 Windows)
export OMX_FORCE_TMUX=1

# 自动选择 (默认)
export OMX_MULTIPLEXER=auto
```

---

## 5. 文件路径和分隔符

### 5.1 路径规范化

#### Windows → WSL 转换
```typescript
function convertWindowsToWslPath(raw: string): string {
  // D:\path → /mnt/d/path
  const m = /^([a-zA-Z]):[\\/](.*)$/.exec(raw);
  if (!m) return raw;
  const drive = m[1].toLowerCase();
  const rest = m[2].replace(/\\/g, '/');
  return `/mnt/${drive}/${rest}`;
}
```

#### WSL → Windows 转换
```typescript
function convertWslToWindowsPath(raw: string): string {
  // /mnt/d/path → D:\path
  const m = /^\/mnt\/([a-zA-Z])(?:\/(.*))?$/.exec(raw);
  if (!m) return raw;
  const drive = m[1].toUpperCase();
  const rest = m[2].replace(/\//g, '\\');
  return `${drive}:\\${rest}`;
}
```

### 5.2 潜在问题

#### 跨平台路径混淆
**风险**: 在 Windows 上使用 POSIX 路径或反之
**影响**: 文件找不到、状态管理失败

**防护**:
- 所有路径使用 `path.join()`, `path.resolve()` 等平台感知函数
- MCP state-paths 模块自动检测和转换路径格式

---

## 6. Git 配置和行尾处理

### 6.1 Windows Git 特性

#### autocrlf 问题
Windows 默认 `core.autocrlf=true` 可能导致：
- 文件内容在 checkout/commit 时转换
- Hook 脚本行尾从 LF 变为 CRLF
- 脚本执行失败

#### 建议配置
```bash
# 在仓库根目录执行
git config core.autocrlf input
git config core.eol lf
```

### 6.2 文件权限

#### chmod 限制
- Windows 文件系统不完全支持 POSIX 权限
- `chmod 0o755` 在 Windows 上是 no-op
- 脚本执行依赖于文件扩展名而非权限位

**代码中的处理**:
```typescript
if (platform !== 'win32') chmodSync(cachedBinaryPath, 0o755);
```

---

## 7. 团队模式 (Team Mode) 注意事项

### 7.1 Worker 启动

#### Windows 启动命令
```typescript
// PowerShell 执行
{
  command: 'powershell.exe',
  args: [
    '-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass',
    '-File', 'codex.ps1',
    ...codexArgs
  ]
}
```

### 7.2 潜在问题

#### 路径中的空格
**问题**: `C:\Program Files\...` 导致命令解析错误
**解决**: 所有路径都经过引号处理

#### 环境变量传递
**问题**: Windows 和 POSIX 环境变量大小写不敏感
**解决**: 统一使用大写环境变量名

---

## 8. 测试覆盖

### 8.1 Windows 特定测试

#### 平台命令测试
- `src/utils/__tests__/platform-command.test.ts`
- 覆盖: PATHEXT 解析、命令分类、node-hosted 优先

#### Hook 测试
- `src/config/__tests__/codex-hooks.test.ts`
- 覆盖: Windows shim 生成、路径引用、超时处理

#### 团队模式测试
- `src/team/__tests__/tmux-session.test.ts`
- 覆盖: PowerShell 路径解析、启动命令构建

### 8.2 运行测试
```bash
# 运行所有测试
npm test

# 运行特定 Windows 相关测试
npm test -- platform-command
npm test -- codex-hooks
```

---

## 9. 已知限制和建议

### 9.1 推荐环境

| 环境 | 推荐度 | 说明 |
|------|--------|------|
| WSL2 | ⭐⭐⭐⭐⭐ | 最佳兼容性，使用原生 tmux |
| Git Bash | ⭐⭐⭐⭐ | 良好支持，模拟 POSIX |
| 原生 Windows | ⭐⭐⭐ | 需要 winmux，部分功能受限 |
| CMD/PowerShell | ⭐⭐⭐ | 基本功能可用 |

### 9.2 安装建议

#### WSL2 (推荐)
```bash
# 在 WSL2 中
sudo apt install tmux
npm install -g oh-my-codex
omx setup
```

#### 原生 Windows
```powershell
# 安装 psmux (如果需要)
winget install psmux

# 安装 OMX
npm install -g oh-my-codex
omx setup

# winmux 会自动配置
```

### 9.3 故障排查

#### Hook 失败
```bash
# 检查 hook 配置
cat .codex/hooks.json

# 检查 shim 脚本
cat .codex/hooks/omx-native-hook-windows-shim.ps1

# 手动测试 hook
echo '{"hook_event_name":"Stop"}' | node dist/scripts/codex-native-hook.js

# 查看日志
cat .omx/logs/native-hook-*.jsonl
```

#### Winmux 问题
```bash
# 检查 daemon 状态
owx winmux status

# 重启 daemon
owx winmux restart

# 查看日志
cat .omx/logs/winmux-daemon.log
```

---

## 10. 修复验证清单

针对本次 Hook JSON 输出修复，验证以下步骤：

- [ ] 构建成功: `npm run build`
- [ ] 运行测试: `npm test`
- [ ] 重新安装: `omx setup --force`
- [ ] 启动新会话测试 SessionStart hook
- [ ] 提交包含中文的 prompt 测试 UserPromptSubmit hook
- [ ] 检查日志文件无 serialize error
- [ ] 验证 team worker 模式下的 PostToolUse hook

---

## 总结

Windows 平台上的 OMX 使用已经通过以下机制获得了良好的支持：

1. **Hook 容错处理** - JSON 输出失败时优雅降级
2. **PowerShell Shim** - 安全的 Node.js 脚本调用
3. **平台命令适配** - 自动处理 PATHEXT、引号、执行方式
4. **Winmux Daemon** - 原生 Windows PTY 管理
5. **路径转换** - Windows/WSL 路径自动转换
6. **充分的测试覆盖** - 确保各平台行为一致

已修复的 Hook JSON 输出问题进一步提升了系统的稳定性和容错能力，特别是在处理包含特殊字符（如中文）的内容时。

---

## 11. Windows 并发稳定性深度分析

### 11.1 `fs.rename` 原子写入的 Windows 陷阱

**影响文件**:
| 文件 | 函数 | 代码行 |
|------|------|--------|
| `src/team/state.ts` | `writeAtomic()` | L726 |
| `src/exec/followup.ts` | `writeQueue()` | L175 |
| `src/wiki/storage.ts` | `atomicWriteFileSync()` | L35 |
| `src/scripts/notify-fallback-watcher.ts` | `writeJsonObjectAtomically()` | L103 |

**核心问题**: 所有四个原子写入函数都使用 `temp write + rename` 模式。在 Windows 上 `fs.rename()` 的行为与 POSIX 不同：

- **POSIX**: `rename(old, new)` 原子性地替换目标（如果存在）
- **Windows (Node < 18.18)**: `rename(old, new)` 在目标存在时抛出 `EPERM`
- **Windows (Node ≥ 18.18)**: libuv 使用 `MoveFileExW` + `MOVEFILE_REPLACE_EXISTING`，通常能正确替换
- **Windows (所有版本)**: 如果目标文件被任何进程打开，仍然会失败

**错误处理缺口**:
```typescript
// writeAtomic 的错误处理 - 只处理 ENOENT，不处理 EPERM/EBUSY！
try {
  await renameForAtomicWrite(tmpPath, filePath);
} catch (error) {
  const err = error as NodeJS.ErrnoException;
  if (err.code === 'ENOENT' && existsSync(filePath)) {
    // ... 只有 ENOENT 被优雅处理
  }
  throw error; // EPERM/EBUSY 直接向上传播！
}

// writeQueue - 完全没有错误处理
await rename(tempPath, path);  // 任何错误都会传播

// atomicWriteFileSync - 完全没有错误处理
renameSync(tmpPath, path);  // 同步错误直接崩溃
```

**Windows 特有触发场景**:
1. 病毒扫描器（Windows Defender）临时锁定文件
2. 另一个 Codex 实例正在读取同一文件
3. 文件被系统进程内存映射
4. Windows Search Indexer 持有文件句柄
5. 备份软件/同步工具（OneDrive、Dropbox）占用文件

**风险等级**: 🔶 中危 — 在并发场景（多个 worker、多个 hook 同时触发）下可能导致写入失败

---

### 11.2 mkdir 锁机制分析

**使用位置**:
| 文件 | 锁类型 | 过期时间 | 重试 |
|------|--------|----------|------|
| `src/exec/followup.ts` | `withQueueLock` | 30s | 10ms × 5s |
| `src/scripts/notify-hook/team-worker-posttooluse.ts` | `withPostToolUseLock` | 10s | 25ms × 5s |
| `src/wiki/storage.ts` | `withWikiLock` | - | - |
| `src/cli/index.ts` | tmux extended keys lease | - | 多次重试 |

**结论**: ✅ mkdir 作为锁机制在 Windows 上**基本安全**。NTFS 保证目录创建是原子操作，`EEXIST` 错误码正确映射。

**Windows 微风险**:
- 锁释放：`rm(lockDir, { recursive: true, force: true })` 在 Windows 上可能因子文件被占用而失败
- 进程崩溃：Windows 不会自动清理孤儿锁，依赖超时回收（可能堆积）
- 时钟偏差：不同进程的 `Date.now()` 可能不同（但在同一机器上差异极小）

---

### 11.3 PostToolUse 并发锁详细分析

**文件**: `src/scripts/notify-hook/team-worker-posttooluse.ts`

**锁参数**:
```typescript
const LOCK_RETRY_MS = 25;       // 重试间隔
const LOCK_TIMEOUT_MS = 5000;    // 总超时
const LOCK_STALE_MS = 10000;     // 过期锁判定
```

**并发场景分析**:

1. **正常竞争** (两个 hook 同时到达):
   ```
   Hook A: mkdir(lock) → 成功 → 执行业务 → rm(lock)
   Hook B: mkdir(lock) → EEXIST → 等待25ms → 重试 → 成功
   ```
   ✅ 此场景在 Windows 上正常工作。

2. **锁过期回收** (持有者崩溃):
   ```
   Hook A: mkdir(lock) → 成功 → 崩溃（未释放锁）
   Hook B: mkdir(lock) → EEXIST → stat(lock) → >10s → rm(lock) → 重试
   ```
   ⚠️ 在 Windows 上 `rm(lockDir, { recursive: true, force: true })` 可能失败：
   - 如果 `owner` 文件被系统进程持有可能无法删除
   - 建议在 Windows 上延长 `LOCK_STALE_MS` 到 15-20s

3. **锁释放竞态**:
   ```
   Hook A: rm(lockDir) 开始
   Hook B: mkdir(lockDir) 几乎同时
   ```
   ⚠️ 在 POSIX 上这通常安全（rm 是原子的），但在 Windows 上如果 rm 是递归的（包含 owner 文件），可能存在竞态窗口。

---

### 11.4 并发写入测试覆盖不足

**现状**: `writeAtomic` 的并发测试只在文件**不存在**时执行：
```typescript
// src/team/__tests__/state.test.ts L1860
it('writeAtomic creates file and is safe to call concurrently (basic)', async () => {
  const p = join(cwd, 'atomic.txt');
  await Promise.all([writeAtomic(p, 'a'), writeAtomic(p, 'b')]);
  // 注: 首次写入，文件不存在
});
```

**缺失的关键测试**:
- ❌ 文件已存在时的并发覆盖写入
- ❌ 高并发下的锁竞争压力测试（10+ 并发写入）
- ❌ Windows 文件被占用的错误恢复测试
- ❌ 锁过期与回收的竞态测试
- ❌ `writeQueue` 和 `atomicWriteFileSync` 的并发安全验证

---

### 11.5 非原子读取的 TOCTOU 风险

**模式**: 多处使用 `existsSync()` + `readFile()` 的分离模式

```typescript
// 典型的 TOCTOU 窗口：
if (existsSync(path)) {                    // ← T1: 文件存在
  const content = await readFile(path);    // ← T2: 文件可能已被其他进程删除
}
```

**Windows 上更严重**：
1. 杀毒软件/文件系统过滤器驱动可能延迟操作
2. 网络共享 (SMB) 延迟更高
3. Windows 资源管理器的缩略图/预览功能可能锁定文件

**影响位置**:
- Hook dispatch 中的 session.json 读取
- 状态文件的读写操作
- 配置文件的热重载

---

### 11.6 通知系统非原子写入

**文件**: `src/notifications/session-registry.ts` L371-L376

```typescript
// ⚠️ 非原子写入 - 并发时可能损坏
writeFileSync(REGISTRY_PATH, content, { mode: SECURE_FILE_MODE });
```

**问题**: 直接覆盖写入没有使用 temp+rename 模式，如果两个进程同时写入：
1. 进程A 写入一半
2. 进程B 从中间开始写入
3. 结果：损坏的 JSON 文件

**建议**: 改用 `writeJsonObjectAtomically` 模式（temp + rename）。

---

### 11.7 进程衍生与系统资源

**Windows 特有开销**:
- 进程创建成本：~5-10ms（vs POSIX ~0.5ms）
- 每次 `execFileSync` 都会触发防病毒扫描
- `spawn` 的 `windowsHide: true` 标志已统一使用 ✅

**并发 Hook 场景**: 当多个 Hook 同时触发时（如 PreToolUse + PostToolUse + Stop）：
- 每个都通过 PowerShell shim → node.exe 执行
- 在 Windows 上可能有累计延迟
- 系统句柄消耗（默认 16M 上限，通常不会达到）

---

### 11.8 winmux daemon 启动竞态

**文件**: `src/winmux/client/ensure-daemon.ts`

**场景**: 多个进程同时检测到 daemon 未运行，同时尝试启动

```typescript
// 快速路径检查
const initial = await ping(pipe, env, 600);
if (initial) return initial;

// 多个进程可能同时到达这里
// → 同时 spawn daemon
// → 第一个绑定命名管道成功，后续的会因 EPERM 失败
if (isPipeInUseError(err)) return true; // ✅ 正确处理了此情况
```

**结论**: ✅ 命名管道绑定冲突已正确识别并处理为成功。

---

## 12. 改进建议

### 🔴 紧急

1. **`writeAtomic` 添加 EPERM/EBUSY 回退处理**:
```typescript
try {
  await renameForAtomicWrite(tmpPath, filePath);
} catch (error) {
  const err = error as NodeJS.ErrnoException;
  // Windows: 目标存在时可能返回 EPERM
  if ((err.code === 'EPERM' || err.code === 'EBUSY') && process.platform === 'win32') {
    try {
      await unlink(filePath); // 删除目标
      await renameForAtomicWrite(tmpPath, filePath); // 重试
      return;
    } catch {
      // 重试失败，传播原始错误
    }
  }
  if (err.code === 'ENOENT' && existsSync(filePath)) { ... }
  throw error;
}
```

---

## 14. 多 owx 进程并发稳定性分析

> **场景**: 用户在同一项目目录同时运行多个 `owx launch`（常见用法，如多窗口协作）、
> 同一项目下的 team leader + workers、或多个独立项目的 `owx` 共享 `~/.omx` 全局状态。

---

### 14.1 进程隔离全景

| 隔离机制 | 级别 | 说明 |
|----------|------|------|
| **Session ID** | ✅ 进程级 | 每次 launch 生成唯一 `omx-{ts}-{random}` |
| **Runtime Codex Home** | ✅ 会话级 | `prepareCodexHomeForLaunch` 为每个 session 创建独立 `.omx/runtime/codex-home/{sessionId}` |
| **SQLite Home** | ✅ 会话级 | 每个 session 使用独立的 state db |
| **Codex Native Session** | ✅ Codex 管理 | Codex 自身为每个进程分配独立的 thread/agent ID |
| **`session.json`** | ❌ 共享 | **多进程共用同一个 `.omx/state/session.json`** |
| **`metrics.json`** | ❌ 共享 | **所有进程写入同一个 `.omx/metrics.json`** |
| **`subagent-tracking.json`** | ❌ 共享 | **所有进程读取和写入同一个 tracking 文件** |
| **Team State** | ❌ 共享 | **同一项目的 team 状态文件多进程共享** |
| **`notify-fallback.pid`** | ❌ 共享 | **只能有一个 fallback watcher 进程** |
| **`~/.omx/state/` (全局)** | ❌ 跨项目 | **reply-session-registry.jsonl 跨所有项目共享** |
| **Madmax 自动隔离** | ✅ 自动 | `owx launch --madmax` 自动设置 `OMX_ROOT` 创建隔离环境 |

---

### 14.2 🔴 严重：`session.json` 多进程乒乓覆盖

**文件**: `src/hooks/session.ts`

**场景**: 同一项目目录同时运行两个 `owx launch`（A 和 B）

```
时间线:
  T1: owx A 启动  → writeSessionStart(A)   → session.json = {session_id: A, pid: ...}
  T2: owx B 启动  → writeSessionStart(B)   → session.json = {session_id: B, pid: ...}  ← A 被覆盖！
  T3: A 的 SessionStart hook 触发 → reconcileNativeSessionStart(A)
      → 读取 session.json → 看到 session_id=B（不同）
      → writeSessionStart(A)            → session.json = {session_id: A, pid: ...}  ← B 被覆盖！
  T4: B 的 SessionStart hook 触发 → 同理又覆盖回 B...
```

**影响**:
1. `session.json` 在两个进程间反复被覆盖
2. 任一进程调用 `writeSessionEnd` 会删除 session.json，导致另一进程丢失 session 引用
3. PostToolUse hook、HUD、notify 等依赖 `readSessionState()` 的模块会间歇性地拿到错误的 session ID
4. 如果 A 先结束 → 删除 session.json → B 的后续 hook 调用 `readSessionState()` 返回 null

**`writeSessionEnd` 的删除竞态**:
```typescript
// src/hooks/session.ts L407-412
if (ownsCurrentSessionFile) {
  try {
    await unlink(sessionPath(cwd)); // ← 不管其他进程是否存活！
  } catch { /* already gone */ }
}
```
`ownsCurrentSessionFile` 的判断基于当前读取到的 session state 是否匹配本 session。
如果 B 恰好在此之前覆盖了 session.json，A 的 `ownsCurrentSessionFile` 会是 false，A 不会删除。
但如果 B 还没覆盖，或者 A 读到的恰巧是 A 自己的版本...会出现不确定行为。

**风险等级**: 🔴 高危 — 功能性损坏，可能引起 hook 上下文混乱、HUD 数据错误

---

### 14.3 🟡 中等：`metrics.json` 并发重置

**文件**: `src/hooks/session.ts` L68-L84, `src/cli/index.ts` L3346

```typescript
// 每个 launch 都会重置 metrics.json！
await resetSessionMetrics(cwd, sessionId);
// → writeFile(metrics.json, { total_turns: 0, session_turns: 0, ... })
```

**场景**:
1. owx A 运行中，metrics 记录了 session_turns=35
2. owx B 启动 → `resetSessionMetrics()` → 将 metrics 重置为 0
3. owx A 丢失了 turn 计数

**影响**:
- HUD 显示的 session turns 失真
- 5h 使用限额百分比计算错误
- 不会导致崩溃，但数据不正确

**风险等级**: 🟡 中等 — 功能降级但不会造成崩溃

---

### 14.4 🔴 严重：`subagent-tracking.json` 无锁读写

**文件**: `src/subagents/tracker.ts` L186-191

```typescript
// 典型的 read-modify-write 竞态：没有锁！
export async function recordSubagentTurnForSession(cwd, input) {
  const current = await readSubagentTrackingState(cwd);  // ← 读取
  const next = recordSubagentTurn(current, input);         // ← 修改
  await writeSubagentTrackingState(cwd, next);             // ← 写入（非原子）
  return next;
}
```

**场景**: 两个 owx 进程同时进行 subagent 追踪更新：

```
进程A: read(version=1) → modify → write(version=2)
进程B: read(version=1) → modify → write(version=2)  ← A 的更新被B覆盖！
```

**实际影响**:
- `writeSubagentTrackingState` 使用 `writeFile`（非 temp+rename），但即使改用原子写入，也仍需锁
- 丢失的更新会导致子 agent 追踪不准确
- `ralph` 模式依赖 subagent-tracking 判断何时可以完成

**风险等级**: 🔴 高危 — 数据丢失竞态

---

### 14.5 🟡 中等：`writeSessionEnd` 误删 session

**文件**: `src/hooks/session.ts` L377-423

**场景**: A 还在运行时，B 结束

```
进程A: 正常运行，session.json 包含 A 的信息
进程B: writeSessionEnd(B)
  → readSessionState(cwd) → 读到 session.json（可能是 A 也可能是 B 的数据）
  → ownsCurrentSessionFile 判定可能为 true
  → unlink(sessionPath(cwd))  // ← 删除 session.json！
进程A: 下次 hook 触发 → readSessionState() → null → 无法获取 session context
```

`ownsCurrentSessionFile` 判定逻辑:
```typescript
const ownsCurrentSessionFile = state == null                          // null → true
  || state.session_id === sessionId                                    // 匹配 → true
  || state.native_session_id === sessionId;                            // native匹配 → true
```

此逻辑的意图是：只有最后写入 session.json 的进程有权删除它。
但问题是 `readSessionState` 和 `writeSessionStart`/`unlink` 之间没有原子性保证。

**具体竞态**:
```
T1: B 调用 readSessionState → 读到 B 的数据 → ownsCurrentSessionFile = true
T2: A 的 hook 调用 reconcileNativeSessionStart → writeSessionStart → 写入 A 的 session
T3: B 调用 unlink → 删除了 A 刚写入的 session! ❌
```

**风险等级**: 🟡 中等 — 取决于时序，可能导致间歇性故障

---

### 14.6 🟡 中等：`notify-fallback-watcher` 单实例限制

**文件**: `src/scripts/notify-fallback-watcher.ts` L1257-1300, `src/cli/index.ts` L4038

```typescript
// 所有进程共享同一个 PID 文件
function notifyFallbackPidPath(cwd: string): string {
  return join(omxRoot(cwd), "state", "notify-fallback.pid");
}

// 启动时：
await reapStaleNotifyFallbackWatcher(pidPath);        // → 杀死旧的 watcher
// → spawn 新的 watcher → 写入新的 PID
```

**场景**:
```
owx A 启动 → 启动 watcher-A (pid=1234)
owx B 启动 → reapStaleNotifyFallbackWatcher → 检查 pid=1234 是否存活
  → 存活（isLikelyOmxWatcherProcess 判断）→ tryKillPid(1234, "SIGTERM") ← ❌ 杀死了 A 的 watcher！
  → 启动 watcher-B (pid=5678)
owx A 退出 → stopNotifyFallbackWatcher → kill watcher-B! ← ❌ 杀死了B的watcher！
owx B 的 notify 功能丢失变流
```

**设计意图**: `reapStaleNotifyFallbackWatcher` 本意是回收崩溃遗留的僵尸 PID。
但它没有检查 `isLikelyOmxWatcherProcess` 时是否来自同一个 `owx launch` 进程。

**注意**: 在 POSIX 上 `tryKillPid` 只杀 watcher 进程本身（通过 PID 文件），但在多进程同一项目目录下，
watcher-A 和 watcher-B 不是同一进程，互相杀死是确定的。

**风险等级**: 🟡 中等 — 后启动的进程会抢走 watcher，先启动的失去通知功能

---

### 14.7 🟢 低危：Git 并发操作

**Git 自身的保护**: Git 使用 `.git/index.lock` 文件自动序列化索引操作。

**OMX 场景**:
- Team worker 的 auto-checkpoint commit（`src/scripts/notify-hook/team-worker-posttooluse.ts` L451-L464）
- 用户在其他 owx 窗口中手动 git 操作
- 两个 worker 几乎同时 commit

```typescript
// team-worker-posttooluse.ts L451
const addResult = await gitMaybe(cwd, ['add', '--', ...checkpointable]);
const commitResult = await gitMaybe(cwd, ['commit', '--no-verify', '-m', ...]);
```

**并发安全性**: ✅ Git index.lock 自动解决冲突，但会导致其中一个工单 git add/commit 失败。
`gitMaybe` 返回 `{ ok: false, ... }`，上层的 checkpoint 逻辑会返回 `skipped` 状态，不会导致崩溃。

**但需要注意**:
- 如果多次失败，team worker 可能因反复重试而超时
- Windows 上 `.git/index.lock` 可能因 Defender 扫描而比 POSIX 稍慢释放

**风险等级**: 🟢 低危 — Git 自身处理，OMX 有降级逻辑

---

### 14.8 🟡 中等：全局 Session Registry 并发

**文件**: `src/notifications/session-registry.ts`

**路径**: `~/.omx/state/reply-session-registry.jsonl`（所有项目共享！）

**锁机制**: ✅ 使用 `O_EXCL` 文件锁

```typescript
const fd = openSync(REGISTRY_LOCK_PATH, constants.O_CREAT | constants.O_EXCL | ...);
```

**问题 1 — 非原子写入**:
```typescript
// L367-L377: 虽然有锁保护，但 writeFileSync 不是原子操作
function rewriteRegistryUnsafe(mappings) {
  writeFileSync(REGISTRY_PATH, content, { mode: SECURE_FILE_MODE });
  // ⚠️ 如果在写入过程中崩溃，文件会损坏
}
```

**问题 2 — Windows 锁文件**:
- `O_EXCL` 在 Windows 上对文件操作是原子的 ✅
- 但锁释放时的 `unlinkSync(REGISTRY_LOCK_PATH)` 和 `closeSync(lock.fd)` 之间不是原子的
- 极端情况下：A 关闭 fd → B 创建新锁 → A unlink  → **删除了 B 的锁！**
- 不过 `removeLockIfUnchanged` 比较 `token` 后才能释放，降低了此风险

**风险等级**: 🟡 中等 — 锁机制基本正确但有潜在的锁文件释放竞态

---

### 14.9 🟡 中等：Team 状态文件并发

**文件**: `src/team/state.ts`

**并发写入路径**:
- `writeTeamPhase` → `writeAtomic`（temp + rename）
- `writeTeamLeaderAttention` → `writeAtomic`（temp + rename）
- `claimTask` → `mkdir` 锁
- `completeTask` → `writeAtomic`（temp + rename）

**问题 1 — `writeAtomic` 在 Windows 上的 EPERM**:
- 已在 11.1 节详细分析
- 同一项目的多个进程同时写 phase/attention 文件时，rename 可能因文件被系统占用而失败

**问题 2 — read-then-write 竞态**:
```typescript
// claimTask: 读 → 验证 → 写 三步不原子
const task = await readTask(...);
if (task.status !== 'pending') return error;
await writeTask(...);  // 另一个进程可能中间修改了状态
```
虽然 `claimTask` 使用了 `mkdir` 锁保护，但锁范围仅限于写入阶段，
读取和写入之间的窗口仍存在极小竞态（如果两个进程同时获得锁？— 不会，mkdir 互斥）。

**风险等级**: 🟡 中等 — `mkdir` 锁基本正确，但 `writeAtomic` 的 EPERM 可能造成写入失败

---

### 14.10 🟢 安全：Madmax 自动隔离

**文件**: `src/cli/index.ts` L1186-1222

```typescript
// 使用 --madmax 标志自动创建隔离环境
function activateMadmaxIsolationIfNeeded(command, launchArgs, cwd, env) {
  if (!shouldAutoIsolateMadmaxLaunch(command, launchArgs, env)) return;
  const runDir = createMadmaxIsolatedRoot(cwd, launchArgs, env);
  env.OMX_ROOT = runDir;           // ← 重定向所有 .omx state
  env.OMXBOX_ACTIVE = "1";
  env.OMX_SOURCE_CWD = cwd;
}
```

**效果**: `owx launch --madmax` 自动将 `.omx/` state 映射到 `~/.omx-runs/run-{timestamp}-{random}/`，
完全隔离于其他进程。

这是多进程场景下的**最佳实践**：对高风险操作（如 madmax bypass）自动隔离，避免状态污染。

**但也意味着**: 不使用 `--madmax` 的普通 launch 没有任何隔离机制。

**风险等级**: 🟢 低危（有隔离方案）

---

### 14.11 🟢 安全：tmux Extended Keys Lease

**文件**: `src/cli/index.ts` L2384-2440

```typescript
// mkdir 作为锁 + lease JSON 文件
function withTmuxExtendedKeysLeaseLock(cwd, socketPath, run) {
  mkdirSync(lockPath);  // 互斥锁
  try {
    writeFileSync(join(lockPath, "pid"), String(process.pid));
    return run();
  } finally {
    rmSync(lockPath, { recursive: true, force: true });
  }
}
```

✅ mkdir 锁在 NTFS 上是原子的，多个 owx 同时获取 tmux 键权时安全。
Lease 持有者使用 PID+timestamp 追踪，支持死进程回收。

**风险等级**: 🟢 低危

---

### 14.12 🟢 安全：PostToolUse mkdir 锁

已在 11.3 节详细分析。对于多进程场景：
- 同一项目下多个 owx 的 PostToolUse hook 会触发同一个锁点
- mkdir 锁正确序列化访问 ✅
- 但锁过期时间（10s）在多进程高负载下可能偏短

**风险等级**: 🟢 低危（建议延长过期时间）

---

### 14.13 🔴 严重：`writeAtomic` 在 Windows 多进程下完全无保护

已在 11.1 节分析。复用于多进程场景时：

```
进程A: writeAtomic(phase.json, dataA)
  1. writeFile(tmpA, dataA)
  2. rename(tmpA, phase.json)  ← 如果进程B同时写了，目标存在 → Windows EPERM
进程B: writeAtomic(phase.json, dataB)
  1. writeFile(tmpB, dataB)  
  2. rename(tmpB, phase.json)  ← 同样失败
```

**四个受影响函数**:
- `writeAtomic()` — team state, team leader attention
- `writeQueue()` — exec followup queue
- `atomicWriteFileSync()` — wiki storage
- `writeJsonObjectAtomically()` — notify fallback

**风险等级**: 🔴 高危 — 多进程高并发下可能间歇性失败

---

## 15. 多进程场景改进建议

### 🔴 紧急优先

1. **`session.json` 乒乓覆盖 —— 需要根本性设计变更**:
   - **方案A（推荐）**: 废弃全局 `session.json`，改为 session-scoped 文件
     ```
     .omx/state/sessions/{sessionId}/session.json  ← 每个进程独立的 session 文件
     ```
   - **方案B（最小改动）**: 在 `writeSessionStart` 和 `reconcileNativeSessionStart` 中使用 `mkdir` 锁
   - **方案C**: 提供 `OMX_ISOLATE=1` 环境变量，自动设置 `OMX_ROOT` 为 `~/.omx-runs/` 独立目录

2. **`subagent-tracking.json` 添加锁机制**:
   ```typescript
   export async function recordSubagentTurnForSession(cwd, input) {
     return withSubagentTrackingLock(cwd, async () => {
       const current = await readSubagentTrackingState(cwd);
       const next = recordSubagentTurn(current, input);
       await writeSubagentTrackingState(cwd, next);
       return next;
     });
   }
   ```

3. **`writeAtomic` 等4个函数添加 EPERM/EBUSY 处理**:
   已在 12 节详述

### 🟡 高优先级

4. **`metrics.json` session-scoped**:
   ```typescript
   // 改为按 session 存储
   function metricsPath(cwd, sessionId) {
     return join(omxStateDir(cwd), 'sessions', sessionId, 'metrics.json');
   }
   ```

5. **`notify-fallback-watcher` 多实例支持**:
   - 将 PID 文件从 `notify-fallback.pid` 改为 `notify-fallback.{sessionId}.pid`
   - 或改为每个 session 独立的 watcher 进程
   - 或设计一个多客户端共享的 watcher 架构

6. **`writeSessionEnd` 增加 owner 验证**:
   - 在 unlink(session.json) 前验证文件内容是否真的属于本 session
   - 使用 `lockFile` 或原子 `compare-and-delete` 模式（Windows 不支持 link/unlink 的原子语义）

### 🟢 中优先级

7. **Session Registry 原子写入**:
   - 将 `rewriteRegistryUnsafe` 的 `writeFileSync` 改为 temp+rename 模式
   - 向锁添加强制过期时间（防止 dead lock holder）

8. **多进程并发测试**:
   - 添加 2 进程同时启动/运行的集成测试
   - 添加 session.json 竞态压力测试
   - 添加 subagent-tracking 并发写入测试

### 📘 用户指南建议

9. **文档化多进程最佳实践**:
   ```bash
   # 推荐：使用 --madmax 或手动隔离
   owx launch --madmax                    # 自动隔离
   OMX_ROOT=/tmp/my-isolated owx launch   # 手动隔离
   
   # 不推荐：同一项目多次 owx launch（当前实现不完全支持）
   ```

---

## 16. 多进程场景总结

| 风险 | 等级 | 影响 | 修复难度 |
|------|------|------|----------|
| session.json 乒乓覆盖 | 🔴 严重 | Hook 上下文混乱，session 丢失 | 中（架构变更） |
| subagent-tracking 无锁读写 | 🔴 严重 | 子 agent 追踪数据丢失 | 低（加 mkdir 锁） |
| writeAtomic EPERM | 🔴 严重 | 多进程同时写入失败 | 中（四种函数都要改） |
| writeSessionEnd 误删 | 🟡 中等 | 间歇性 session 丢失 | 中 |
| metrics.json 并发重置 | 🟡 中等 | HUD 计数不准 | 低（改用 session-scoped） |
| notify watcher 单实例 | 🟡 中等 | 后启动者抢走 watcher | 中（架构变更） |
| session registry 非原子写 | 🟡 中等 | 潜在的registry损坏 | 低（改 temp+rename） |
| team state 读写竞态 | 🟡 中等 | 任务状态不一致 | 低（已有锁，加固即可） |
| Git 并发操作 | 🟢 低危 | 偶发性 commit 失败 | 无需修复 |
| tmux lease 锁 | 🟢 安全 | 无问题 | 无需修复 |
| Madmax 隔离 | 🟢 安全 | 已有方案 | 无需修复 |
| PostToolUse mkdir 锁 | 🟢 安全 | 10s过期偏短 | 低（延长过期时间） |

3. **`writeQueue` 添加错误处理**

### 🟡 高优先级

4. 延长 `LOCK_STALE_MS`（PostToolUse: 10s → 20s）
5. 为通知系统 registry 添加原子写入
6. 添加文件已存在时的并发覆盖写入测试

### 🟢 中优先级

7. 关键路径添加 TOCTOU 防护（try-catch 代替 existsSync 检查）
8. 添加 Windows 并发压力测试
9. 监控 daemon 启动的竞态窗口

---

## 13. 测试建议

```bash
# 推荐在 Windows 上额外运行的测试
node --test dist/team/__tests__/state.test.js --test-name-pattern="writeAtomic"
node --test dist/exec/__tests__/followup.test.js
node --test dist/scripts/__tests__/windows-hook-json.test.js

# 并发压力测试（建议创建）
node --test dist/scripts/__tests__/windows-concurrency.test.js
```
