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

### ✅ 已修复

1. **`writeAtomic` 等5个函数添加 EPERM/EBUSY 重试处理**:
   - 文件: `src/team/state.ts`, `src/exec/followup.ts`, `src/wiki/storage.ts`, `src/scripts/notify-fallback-watcher.ts`, `src/notifications/session-registry.ts`
   - 修复方案: 在 Windows 上遇到 EPERM/EBUSY 时，使用指数退避重试3次（50ms, 100ms, 150ms）
   - 先删除目标文件，再重试 rename 操作
   - 测试验证: 所有并发测试通过（5/5）

2. **PostToolUse LOCK_STALE_MS 延长**:
   - 文件: `src/scripts/notify-hook/team-worker-posttooluse.ts`
   - 修改: 10s → 20s
   - 原因: Windows 上文件系统操作较慢，防病毒软件扫描可能延迟

3. **notify-fallback-watcher 多实例支持**:
   - 文件: `src/cli/index.ts`
   - 修改: PID 文件从 `notify-fallback.pid` 改为 `notify-fallback.{sessionId}.pid`
   - 效果: 多个 owx 进程可以同时运行独立的 watcher，互不干扰

4. **Session Registry 原子写入**:
   - 文件: `src/notifications/session-registry.ts`
   - 修改: `rewriteRegistryUnsafe` 改用 temp+rename 模式
   - 添加: EPERM/EBUSY 重试机制

5. **Windows 并发压力测试**:
   - 文件: `src/scripts/__tests__/windows-concurrency.test.ts`
   - 测试覆盖:
     - ✅ 文件已存在时的并发覆盖写入
     - ✅ 高并发压力测试（20个并发写入）
     - ✅ 快速连续写入（序列化和并发混合）
     - ✅ Windows EPERM/EBUSY 错误恢复
     - ✅ 持续并发写入 100 次

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
| **`session.json`** | ✅ 已修复 | **每个 launch 现在默认使用隔离的 .omx 目录** (v0.17.0+) |
| **`metrics.json`** | ✅ 已修复 | **通过隔离模式，每个 session 有独立 metrics** |
| **`subagent-tracking.json`** | ✅ 已修复 | **通过隔离模式，每个 session 有独立 tracking** |
| **Team State** | ❌ 共享 | **同一项目的 team 状态文件多进程共享** |
| **`notify-fallback.pid`** | ❌ 共享 | **只能有一个 fallback watcher 进程** |
| **`~/.omx/state/` (全局)** | ❌ 跨项目 | **reply-session-registry.jsonl 跨所有项目共享** |
| **Madmax 自动隔离** | ✅ 自动 | `owx launch --madmax` 自动设置 `OMX_ROOT` 创建隔离环境 |

---

### 14.2 ✅ 已修复：`session.json` 多进程乒乓覆盖

**文件**: `src/hooks/session.ts`, `src/cli/index.ts`

**修复方案 (v0.17.0+)**: 默认为每个 `owx launch`/`owx exec` 创建隔离的 `.omx/` 目录。

**机制**:
```typescript
// 默认隔离：每次 launch/exec 自动设置 OMX_ROOT 到 ~/.omx-runs/run-{timestamp}-{random}/
function shouldAutoIsolateLaunch(command, launchArgs, env) {
  if (command !== "launch" && command !== "exec") return false;
  if (env.OMXBOX_ACTIVE === "1") return false;  // 防止双重隔离
  if (env.OMX_NO_ISOLATE === "1") return false;  // 用户明确退出
  return true;  // 默认隔离！
}
```

**效果**:
- 每个进程拥有独立的 `session.json`、`metrics.json`、`subagent-tracking.json`
- 项目资源（`project-memory.json`、`notepad.md`、`setup-scope.json`）通过 symlink/copy 共享
- 完全消除多进程状态竞态

**退出隔离**: `OMX_NO_ISOLATE=1 owx launch` 或 `OMX_NO_BOX=1 owx launch`（兼容旧版）

---

### 14.2b （旧版分析，已通过默认隔离解决）🔴 严重：`session.json` 多进程乒乓覆盖

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

### 14.3 ✅ 已修复（默认隔离）：`metrics.json` 并发重置

**文件**: `src/hooks/session.ts` L68-L84, `src/cli/index.ts` L3346

**修复**: 默认隔离确保每个 session 有独立的 `.omx/metrics.json`。

---

### 14.3 （旧版分析）🟡 中等：`metrics.json` 并发重置

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

### 14.4 ✅ 已修复（默认隔离）：`subagent-tracking.json` 无锁读写

**文件**: `src/subagents/tracker.ts` L186-191

**修复**: 默认隔离确保每个 session 有独立的 `subagent-tracking.json`。

---

### 14.4 （旧版分析）🔴 严重：`subagent-tracking.json` 无锁读写

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

| 风险 | 等级 | 影响 | 状态 |
|------|------|------|------|
| session.json 乒乓覆盖 | 🔴 严重 | Hook 上下文混乱，session 丢失 | ✅ 已修复（默认隔离） |
| subagent-tracking 无锁读写 | 🔴 严重 | 子 agent 追踪数据丢失 | ✅ 已修复（默认隔离） |
| metrics.json 并发重置 | 🟡 中等 | HUD 计数不准 | ✅ 已修复（默认隔离） |
| writeAtomic EPERM | 🔴 严重 | 多进程同时写入失败 | ✅ 已修复（EPERM/EBUSY 重试） |
| writeSessionEnd 误删 | 🟡 中等 | 间歇性 session 丢失 | ✅ 已修复（默认隔离） |
| notify watcher 单实例 | 🟡 中等 | 后启动者抢走 watcher | ✅ 已修复（session-scoped PID） |
| session registry 非原子写 | 🟡 中等 | 潜在的registry损坏 | ✅ 已修复（temp+rename） |
| team state 读写竞态 | 🟡 中等 | 任务状态不一致 | ✅ 已加固（已有锁） |
| Git 并发操作 | 🟢 低危 | 偶发性 commit 失败 | ✅ 无需修复 |
| tmux lease 锁 | 🟢 安全 | 无问题 | ✅ 无需修复 |
| Madmax 隔离 | 🟢 安全 | 已有方案 | ✅ 已升级为默认 |
| PostToolUse mkdir 锁 | 🟢 安全 | 10s过期偏短 | ✅ 已修复（延长到20s） |

---

## 17. 改进建议优先级总结

### ✅ 已完成修复

1. **`writeAtomic` 等5个函数添加 EPERM/EBUSY 处理**:
   - 已在 12 节详述
   - 测试验证: 5/5 并发测试通过

2. **`notify-fallback-watcher` 多实例支持**:
   - 已在 12 节详述
   - PID 文件改为 session-scoped

3. **Session Registry 原子写入**:
   - 已在 12 节详述
   - 改用 temp+rename 模式

4. **PostToolUse LOCK_STALE_MS 延长**:
   - 已在 12 节详述
   - 10s → 20s

### 🟡 高优先级（待修复）

5. 添加文件已存在时的并发覆盖写入测试
   - ✅ 已完成: `windows-concurrency.test.ts`

6. ✅ 已完成: 关键路径添加 TOCTOU 防护（try-catch 代替 existsSync 检查，如 src/wiki/storage.ts, src/team/worker-bootstrap.ts, src/winmux 等）

### 🟢 中优先级（待修复）

7. 添加 Windows 并发压力测试
   - ✅ 已完成: 100次并发写入测试

8. ✅ 已完成: 修复 daemon 启动的竞态窗口（使用 flag: \'wx\' 确保 lockfile 创建的原子性，防止多个 daemon 相互覆盖）

---

## 18. 测试建议

```bash
# 推荐在 Windows 上额外运行的测试
node --test dist/team/__tests__/state.test.js --test-name-pattern="writeAtomic"
node --test dist/exec/__tests__/followup.test.js
node --test dist/scripts/__tests__/windows-hook-json.test.js

# 并发压力测试（建议创建）
node --test dist/scripts/__tests__/windows-concurrency.test.js
```

---

## 19. 补充审计 (Addendum) — 后续代码巡查发现

> **审计基线**: 2026-05-15 代码巡查（read-only review）
> **范围**: §1–§18 之外的新发现，仅记录此前文档未覆盖的条目
> **关联引用**: 每个条目末尾用 *See also* 链接到主文档相关章节

### 19.1 总览 (Summary Table)

| # | 优先级 | 标题 | 类别 | 修复成本 |
|---|--------|------|------|---------|
| 1 | 🔴 P0 | reply-listener daemon Windows 身份校验直接 `return false` | 单实例 / IPC | 中 |
| 2 | 🔴 P0 | PowerShell shim `continue` 在无 loop 上下文中失效 | Hook 启动稳定性 | 低 |
| 3 | 🔴 P0 | `writeSessionStart` / `reconcileNativeSessionStart` 非原子写 | 并发 / 热路径 | 低 |
| 4 | 🟡 P1 | 12+ 处缺 EPERM/EBUSY 重试的"伪原子写" | Windows 并发 | 低（批量） |
| 5 | 🟡 P1 | `runtime/process-tree.ts` Windows 仅 `child.kill`，无法清理子树 | 进程树清理 | 中 |
| 6 | 🟡 P1 | `cli/cleanup.ts` Windows `process.kill` 仅杀单进程 | 多开清理 | 中 |
| 7 | 🟡 P1 | `mcp/bootstrap.listProcessTable` Windows 直接 `return null` | 多开去重 | 中 |
| 8 | 🟢 P2 | `notify-fallback-state.json` 缺 session-scope（PID 已修，state 未修） | 多开（无隔离时） | 低 |
| 9 | 🟢 P2 | watcher / reply-listener 未监听 `SIGBREAK` | Windows 信号 | 低 |
| 10 | 🟢 P2 | 三处遗留 `shell: true`（doctor / agents / autoresearch） | Windows 兼容 | 低 |
| 11 | 🟢 P2 | `team/worktree.ts` `branchExists` 缺 `windowsHide` | 一致性 | 低 |
| 12 | 🟢 P2 | `linkProjectResources` Windows dir symlink 无 junction fallback | 隔离启动 | 低 |
| 13 | 🟢 P2 | `team/state/locks.ts` mkdir/writeFile 间隙存在僵尸锁窗口 | 并发恢复 | 中 |

---

### 19.2 P0 必修

#### 19.2.1 reply-listener daemon 身份校验在 Windows 直接放弃 🔴

**位置**: `src/notifications/reply-listener.ts:295`

```typescript
// reply-listener.ts L288-303
try {
  const platform = options.platform ?? process.platform;
  if (platform === 'linux') {
    const cmdline = readFileSync(`/proc/${pid}/cmdline`, 'utf-8');
    return cmdline.includes(DAEMON_IDENTITY_MARKER);
  }
  if (process.platform === 'win32') return false;   // ← Windows 永远视为"非 daemon 进程"
  // POSIX: ps -p <pid> -o args=
  const { result } = spawnPlatformCommandSync('ps', ...);
```

**根因 (Root cause)**: Windows 上没有 `/proc`，也没有走 `tasklist` / `wmic` 兜底，函数直接返回 `false`。这导致 `isDaemonRunning()` 在 Windows 上**永远报告 daemon 不存在**。

**影响 (Impact)**:
1. 启动新 reply-listener 时，`removePidFile()` 会被错误触发 → 把存活的 daemon 的 PID 文件删掉
2. 紧接着启动新 daemon → 两份 daemon 共存 → 抢占同一 SQLite registry → 锁竞争 + 重复回复
3. 多 owx 并发时表现尤为严重，本质上 daemon 单实例机制在 Windows 上失效

**最佳实践 (Recommended fix)**: 复用 `src/cli/cleanup.ts` 中已有的 `WINDOWS_PROCESS_DISCOVERY_SCRIPT`（基于 `Get-CimInstance Win32_Process`），抽到 `src/utils/process-list.ts` 共享，验证目标 PID 的 CommandLine 包含 `DAEMON_IDENTITY_MARKER`。

**See also**: §14.8（reply-session-registry 并发）、§7（Windows 进程探测）。

---

#### 19.2.2 PowerShell shim 内 `continue` 在无循环上下文中失效 🔴

**位置**: `src/config/codex-hooks.ts:188`

```powershell
# buildManagedCodexNativeHookWindowsShimContent() 生成的 shim 片段
try {
  $null = $process.Start()
} catch {
  if ([DateTime]::UtcNow -ge $deadline) {
    [Console]::Out.WriteLine('{}')
    exit 0
  }
  Start-Sleep -Milliseconds 200
  continue   # ← 此处没有外层循环！
}
$stdoutTask = $process.StandardOutput.ReadToEndAsync()
```

**根因**: `try/catch` 块**不在任何循环里**。PowerShell 的 `continue` 在无 `for` / `while` / `do` / `foreach` 上下文中：
- 等同于"跳出当前作用域"（部分版本）或抛出 `ContinueException`（严格模式）
- 既不会重试 `$process.Start()`，也不会跳过后续 `$stdoutTask = ...`

实际行为：
1. `$process.Start()` 偶发失败（如 `node.exe` 被防病毒短暂挂起）
2. catch 走完后**立即继续执行** `$process.StandardOutput.ReadToEndAsync()`
3. `$process` 对象未启动 → NullReferenceException → shim 异常退出（非 0 exitcode）
4. Codex 报 `error: hook returned invalid <event> JSON output`（与 §1 现象一致，但根因不同）

**最佳实践**: 用 `while ($true) { try { $null = $process.Start(); break } catch { ...; continue } }` 把 try/catch 包进真正的循环。

**See also**: §1（Hook JSON 输出）、§2.1（Shim 路径）。本条目是 §1 修复后残留的边角问题。

---

#### 19.2.3 `writeSessionStart` / `reconcileNativeSessionStart` 非原子写 🔴

**位置**: `src/hooks/session.ts:306` 与 `src/hooks/session.ts:363`

```typescript
// writeSessionStart
await writeFile(sessionPath(cwd), JSON.stringify(state, null, 2));

// reconcileNativeSessionStart
await writeFile(sessionPath(cwd), JSON.stringify(state, null, 2));
```

**根因**: 直接 `writeFile` 覆盖目标文件，未走 temp + rename 模式，且无 EPERM/EBUSY 处理。`session.json` 是 **SessionStart hook 热路径**，每次会话开始或 Codex 重新连接时都会触发。

**影响**:
- §14.2 已通过"默认隔离"缓解多进程乒乓覆盖
- 但 `OMX_NO_ISOLATE=1` / 共享 `OMX_ROOT` / CI / 同 worker 复用同 `cwd` 等场景仍会复活旧问题
- 在 Windows 上 `writeFile` 的部分写入窗口 + Defender 锁定会让其他进程读到截断的 JSON

**最佳实践**: 复用已加固的 `writeAtomic`（§12.1，含 EPERM/EBUSY 重试），把这两处改成原子写入。

**See also**: §14.2、§14.5、§12.1。

---

### 19.3 P1 应修

#### 19.3.1 12+ 处缺 EPERM/EBUSY 重试的"伪原子写" 🟡

§12.1 已加固 5 个核心原子写函数。本轮巡查发现还有以下未对齐 Windows 重试模式的写入点（直接 `rename` 失败抛出，或 `writeFile` 覆盖）：

| 文件 | 函数 / 行号 | 当前模式 |
|------|------------|---------|
| `src/state/operations.ts:78` | `writeAtomicFile` | rename 失败仅 unlink tmp，不重试 |
| `src/runtime/run-state.ts:146` | `writeAtomicFile` | 同上 |
| `src/hooks/triage-state.ts:100` | `renameSync` | swallow catch，状态可能不一致 |
| `src/hooks/codebase-map.ts:97` | `rename` | catch 删 tmp，无重试 |
| `src/scripts/notify-hook/team-worker.ts:346` | heartbeat write | 无错误处理 |
| `src/scripts/notify-hook/team-worker.ts:565` | prev-state write | swallow catch |
| `src/scripts/notify-hook/team-worker.ts:614` | cooldown deferred | swallow catch |
| `src/scripts/notify-hook/team-worker.ts:659` | cooldown notify | swallow catch |
| `src/scripts/notify-hook/ralph-session-resume.ts:128` | `writeJsonAtomic` | 无重试 |
| `src/scripts/notify-hook/team-worker-stop.ts:56` | `writeStopNudgeState` | 无重试 |
| `src/scripts/notify-fallback-watcher.ts:794` | `writeRalphSteerTimestamp` | 无重试 |
| `src/scripts/notify-fallback-watcher.ts:1090` | `persistReboundRalphPaneState` | 无重试 |
| `src/mcp/memory-server.ts:301` | notepad PRIORITY | 无重试 |
| `src/mcp/memory-server.ts:322` | notepad WORKING MEMORY | 无重试 |
| `src/mcp/memory-server.ts:343` | notepad MANUAL | 无重试 |

**最佳实践**: 抽出公共工具 `src/utils/atomic-write.ts`（导出 `atomicRenameWithWindowsRetry(tmp, dest)`），全项目替换为统一 helper。当前的 5 处 ad-hoc 重试逻辑会被吸收进同一函数。

**See also**: §11.1、§12.1。

---

#### 19.3.2 `runtime/process-tree.ts` Windows 无法清理子进程树 🟡

**位置**: `src/runtime/process-tree.ts:41-47`

```typescript
function killProcessTree(child: ChildProcess, platform: NodeJS.Platform, signal: NodeJS.Signals): void {
  if (child.pid === undefined) return;
  try {
    if (platform === 'win32') {
      child.kill(signal);   // ← 仅 TerminateProcess，只杀直接子进程
      return;
    }
    process.kill(-child.pid, signal);   // POSIX: 杀整个进程组
```

**根因**: Windows 上 `child.kill(...)` ≡ `TerminateProcess(<pid>)`，**不会传递到孙子进程**。如果 child 又 spawn 了二级进程（极常见：`tmux` / `powershell -File` / `pwsh -File <script>` 又拉起 node），这些孙子进程会成为孤儿。

**最佳实践**: Windows 分支调用 `taskkill /T /F /PID <pid>`（`/T` 杀整个进程树，`/F` 强制）。建议封装到 `src/utils/process-tree.ts` 的 `killTreeForPlatform()` 通用函数。

**See also**: §11.7、§7（Windows 进程开销）。

---

#### 19.3.3 `cli/cleanup.ts` Windows 上 `process.kill` 仅杀单进程 🟡

**位置**: `src/cli/cleanup.ts:423`

```typescript
const sendSignal = dependencies.sendSignal
  ?? ((pid: number, signal: NodeJS.Signals) => process.kill(pid, signal));
```

**根因**: cleanup 用于回收 MCP server 孤儿。Windows 上 `process.kill` 等价于 `TerminateProcess`，与 19.3.2 同源问题。MCP server 自身 spawn 的工具子进程会脱挂，演化为真正的孤儿。

**最佳实践**: Windows 分支用 `execFileSync('taskkill', ['/T', '/F', '/PID', String(pid)], { windowsHide: true })`。复用 19.3.2 的 helper。

**See also**: §14.6、§19.3.2。

---

#### 19.3.4 MCP duplicate sibling detection 在 Windows 完全禁用 🟡

**位置**: `src/mcp/bootstrap.ts:116-121`

```typescript
export function listProcessTable(
  readPs: typeof execFileSync = execFileSync,
): ProcessTableEntry[] | null {
  if (process.platform === 'win32') {
    return null;   // ← Windows 直接放弃，导致 analyzeDuplicateSiblingState 拿不到数据
  }
  // POSIX: ps -axo pid=,ppid=,command=
```

**根因**: Windows 上 `listProcessTable` 直接 return null，因此 `analyzeDuplicateSiblingState`、`older_duplicate` / `newer_sibling` 仲裁逻辑在 Windows 上**全部失效**。多 owx 同时启动时可能拉起多份同入口的 MCP server，并发写入共享状态。

**最佳实践**: Windows 分支用 `Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId, CommandLine` 输出 CSV/JSON 后解析。`src/cli/cleanup.ts` 已有 `WINDOWS_PROCESS_DISCOVERY_SCRIPT`，应抽到 `src/utils/process-list.ts` 与 19.2.1 共用。

**See also**: §14.8、§19.2.1。

---

### 19.4 P2 可修

#### 19.4.1 `notify-fallback-state.json` 缺 session-scope 🟢

**位置**: `src/scripts/notify-fallback-watcher.ts:164`

```typescript
const stateDir = join(omxDir, 'state');
const statePath = join(stateDir, 'notify-fallback-state.json');   // ← 没有 sessionId
const pidFilePath = resolve(argValue('--pid-file', join(stateDir, 'notify-fallback.pid')));
```

**根因**: §14.6 已把 PID 文件改成 `notify-fallback.{sessionId}.pid`，但同期生成的 state 文件仍是固定名。当用户禁用默认隔离（`OMX_NO_ISOLATE=1` / 共享 `OMX_ROOT`）时，多 watcher 同写一个 state 文件 → ralph steer state、authority backoff 等数据互相覆盖。

**最佳实践**: 把 `statePath` 一并改成 `notify-fallback-state.{sessionId}.json`，并在隔离禁用模式下加 mkdir 锁保护写入路径。

**See also**: §14.6。

---

#### 19.4.2 watcher / reply-listener 未监听 `SIGBREAK` 🟢

**位置**: `src/scripts/notify-fallback-watcher.ts:2005-2007`、`src/scripts/hook-derived-watcher.ts`、`src/notifications/reply-listener.ts`

```typescript
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGHUP', () => shutdown('SIGHUP'));
// ← 缺 SIGBREAK，Ctrl+Break 不会触发优雅关闭
```

**根因**: Windows 不传递 `SIGHUP`；按 `Ctrl+Break` 触发的是 `SIGBREAK`。`src/winmux/daemon/lifecycle.ts:115` 已经做对了（同时监听 SIGBREAK），但 watcher 系列脚本漏掉。结果：在 Windows 控制台用 Ctrl+Break 关闭 watcher 不会跑 shutdown，会留下僵尸 PID 文件 + state 残留。

**最佳实践**: 所有可能在 Windows 上常驻的脚本统一补 `process.on('SIGBREAK' as NodeJS.Signals, ...)`，与 winmux daemon 保持一致。建议抽到 `src/utils/lifecycle-signals.ts`。

**See also**: §11.8、winmux daemon `installLifecycle`。

---

#### 19.4.3 三处遗留 `shell: true` 风险 🟢

| 位置 | 风险 |
|------|------|
| `src/cli/doctor.ts:1161-1171` | smoke test 跑 `powershell.exe -File <shim>`，过 `shell: true`，shim 路径含空格时丢参；且**未设 `windowsHide`**，会闪 console 窗口 |
| `src/cli/agents.ts:216-221` | `editor ?? 'vi'` — Windows 上 vi 默认不存在；`shell: true` 让 path 暴露给 cmd 解析 |
| `src/autoresearch/runtime.ts:475-481` | `contract.sandbox.evaluator.command` 是任意字符串，`shell: true` 等价于命令注入入口 |

**最佳实践**: 三处都改为 `execFile(command, args, { windowsHide: true, ... })` + argv 拆分，避免 shell 解析。doctor 的 smoke 应该改为：

```typescript
spawnSync('powershell.exe',
  ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', shimPath],
  { encoding: 'utf-8', windowsHide: true, ... });
```

**See also**: §3.3、§11.7。

---

#### 19.4.4 `team/worktree.ts:116` `branchExists` 缺 `windowsHide` 🟢

```typescript
function branchExists(repoRoot: string, branchName: string): boolean {
  const result = spawnSync('git', ['show-ref', '--verify', '--quiet', `refs/heads/${branchName}`], {
    cwd: repoRoot,
    encoding: 'utf-8',
    // ← 缺 windowsHide: true（同文件其他 9 处 git 调用都有）
  });
```

**根因**: 同一文件其他 git 调用都有 `windowsHide: true`，唯独此处遗漏。Windows 上若被 `cmd /c` 包过，会偶发闪一下黑窗。一致性问题。

**最佳实践**: 加一行 `windowsHide: true`。

**See also**: §11.7。

---

#### 19.4.5 `linkProjectResources` Windows dir symlink 无 junction fallback 🟢

**位置**: `src/cli/index.ts:1285-1291`

```typescript
if (existsSync(sourcePlansDir)) {
  try {
    symlinkSync(sourcePlansDir, targetPlansDir, "dir");   // ← Win 需要 SeCreateSymbolicLinkPrivilege
  } catch {
    // Non-critical: plans can be session-specific
  }
}
```

**根因**: Windows 上 `symlinkSync(..., "dir")` 默认要求 Admin 或开发者模式。普通用户落 catch 后 plans/ 在隔离目录里完全缺失，注释说"non-critical"，但实际上 plans 目录的丢失会破坏 ralph PRD 跨进程可见性。

**最佳实践**: catch 内补 `symlinkSync(target, path, 'junction')` 兜底（NTFS junction 不需要特权），仍失败再考虑 `cp -r` 快照。

**See also**: §14.10（Madmax 自动隔离）。

---

#### 19.4.6 `team/state/locks.ts` mkdir/writeFile 间隙的僵尸锁窗口 🟢

**位置**: `src/team/state/locks.ts:46-65` 等 4 处（withScalingLock / withTeamLock / withTaskClaimLock / withMailboxLock）

```typescript
while (true) {
  try {
    await mkdir(lockDir);
    try {
      await writeFile(ownerPath, ownerToken, 'utf8');
    } catch (error) {
      await rm(lockDir, { recursive: true, force: true });
      throw error;
    }
    break;
```

**根因**: 进程 A `mkdir` 成功 → 进程 A 在 `writeFile(ownerPath)` 之前崩溃 → 锁目录存在但无 owner 文件。当前 `maybeRecoverStaleLock` 基于 `mtimeMs > lockStaleMs` 判定，所以**所有竞争者必须 busy-wait 到 stale 超时**（5–10 秒级）才能回收。

**最佳实践**: 在 `maybeRecoverStaleLock` 中加快速路径——"owner 文件不存在且 lockDir 已 ≥ 数百毫秒"立即视为 stale 回收，可显著缩短异常恢复时间。

**See also**: §11.2、§11.3。

---

### 19.5 建议补充的测试

| 覆盖目标 | 建议测试 | 备注 |
|---------|---------|------|
| 19.2.1 | reply-listener Win 身份校验集成测试 | 用 mocked Win32_Process 输出验证 `isReplyListenerProcess` 正确返回 true/false |
| 19.2.2 | shim Start 失败的退避循环 | 用 mock node.exe 路径制造首次 Start 失败，验证 shim 不抛出 NRE |
| 19.2.3 | `writeSessionStart` 多进程并发 | 与现有 `windows-concurrency.test.ts` 同框架，验证最终 session.json 是 valid JSON |
| 19.3.1 | `atomicRenameWithWindowsRetry` 单元测试 | 模拟 EPERM/EBUSY 触发重试，验证最终 rename 成功 |
| 19.3.2 / 19.3.3 | Windows 进程树终止 | 仅 win32 启用，spawn 子→孙进程，断言 `taskkill /T /F` 后所有 PID 不存在 |
| 19.3.4 | `listProcessTable` Win 实现 | mock `Get-CimInstance` CSV 输出，验证 duplicate detection 正确分类 |

---

### 19.6 修复路线图 (Fix Roadmap)

按风险与工作量推荐合入顺序：

1. **P0 三条独立合入**（建议各自一个 PR）
   - `fix(notifications): verify reply-listener daemon identity on Windows` (19.2.1)
   - `fix(hooks): wrap PowerShell shim Start retry in real loop` (19.2.2)
   - `fix(hooks): make writeSessionStart atomic with Windows EPERM retry` (19.2.3)

2. **P1 共享基础设施**（一个 refactor PR + 多个 follow-up）
   - `refactor: extract atomicRenameWithWindowsRetry helper` （19.3.1，含 12+ 处替换）
   - `feat(utils): unify killTreeForPlatform via taskkill /T /F on Windows`（19.3.2 + 19.3.3）
   - `feat(mcp): enable listProcessTable on Windows via Get-CimInstance`（19.3.4，与 19.2.1 共享 helper）

3. **P2 housekeeping**（可合并为单一 PR）
   - 19.4.1 / 19.4.2 / 19.4.4 / 19.4.5 行级补丁
   - 19.4.3 三处 `shell: true` → `execFile`
   - 19.4.6 lock 快速回收路径
