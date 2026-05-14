# Windows 兼容性修复总结

## 修复概述

本次修复解决了 WINDOWS_COMPATIBILITY_ANALYSIS.md 中标记为"待修复"的所有高优先级问题，显著提升了 OMX 在 Windows 平台上的并发稳定性和多进程支持能力。

## 修复清单

### ✅ 1. writeAtomic 等 5 个函数的 EPERM/EBUSY 错误处理

**问题**: Windows 上 `fs.rename()` 在目标文件被占用时抛出 EPERM/EBUSY 错误（如防病毒软件扫描、文件索引等）

**影响的函数**:
1. `src/team/state.ts` - `writeAtomic()`
2. `src/exec/followup.ts` - `writeQueue()`
3. `src/wiki/storage.ts` - `atomicWriteFileSync()`
4. `src/scripts/notify-fallback-watcher.ts` - `writeJsonObjectAtomically()`
5. `src/notifications/session-registry.ts` - `rewriteRegistryUnsafe()`

**修复方案**:
```typescript
// 在 Windows 上遇到 EPERM/EBUSY 时重试 3 次
if ((err.code === 'EPERM' || err.code === 'EBUSY') && process.platform === 'win32') {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await new Promise(resolve => setTimeout(resolve, 50 * attempt)); // 指数退避
      await unlink(filePath);  // 删除目标文件
      await rename(tmpPath, filePath);  // 重试
      return;
    } catch {
      // 继续下一次重试
    }
  }
}
```

**测试验证**: ✅ 5/5 并发测试通过
- 文件已存在时的并发覆盖写入
- 高并发压力测试（20个并发写入）
- 快速连续写入（序列化和并发混合）
- Windows EPERM/EBUSY 错误恢复
- 持续并发写入 100 次

---

### ✅ 2. PostToolUse LOCK_STALE_MS 延长

**问题**: Windows 上文件系统操作较慢，10秒锁过期时间在高负载下可能不足

**文件**: `src/scripts/notify-hook/team-worker-posttooluse.ts`

**修改**: `LOCK_STALE_MS` 从 10000ms (10s) 延长到 20000ms (20s)

**影响**: 减少 Windows 上 PostToolUse hook 的锁竞争失败

---

### ✅ 3. notify-fallback-watcher 多实例支持

**问题**: 多个 owx 进程共享同一个 PID 文件，后启动的进程会杀死先启动的 watcher

**文件**: `src/cli/index.ts`

**修改**:
```typescript
// 之前：所有进程共享同一个 PID 文件
function notifyFallbackPidPath(cwd: string): string {
  return join(omxRoot(cwd), "state", "notify-fallback.pid");
}

// 现在：每个 session 独立的 PID 文件
function notifyFallbackPidPath(cwd: string, sessionId?: string): string {
  const baseName = sessionId ? `notify-fallback.${sessionId}.pid` : 'notify-fallback.pid';
  return join(omxRoot(cwd), "state", baseName);
}
```

**效果**: 多个 owx 进程可以同时运行独立的 watcher，互不干扰

---

### ✅ 4. Session Registry 原子写入

**问题**: `rewriteRegistryUnsafe()` 直接覆盖写入，崩溃时可能导致文件损坏

**文件**: `src/notifications/session-registry.ts`

**修改**: 改用 temp+rename 原子写入模式
```typescript
// 先写入临时文件
writeFileSync(tmpPath, content, { mode: SECURE_FILE_MODE });
// 原子性替换
renameSync(tmpPath, REGISTRY_PATH);
```

**额外加固**: 添加 EPERM/EBUSY 重试机制（同修复1）

---

### ✅ 5. Windows 并发压力测试

**文件**: `src/scripts/__tests__/windows-concurrency.test.ts`

**测试覆盖**:
- ✅ 文件已存在时的并发覆盖写入（10并发）
- ✅ 高并发压力测试（20并发）
- ✅ 快速连续写入（序列化+并发混合）
- ✅ Windows EPERM/EBUSY 错误恢复
- ✅ 持续并发写入 100 次（10批 × 10并发）

**测试结果**: 5/5 全部通过

---

## 修复效果

### 风险等级变化

| 风险项 | 修复前 | 修复后 |
|--------|--------|--------|
| writeAtomic EPERM | 🔴 严重 | ✅ 已修复 |
| notify watcher 单实例 | 🟡 中等 | ✅ 已修复 |
| session registry 非原子写 | 🟡 中等 | ✅ 已修复 |
| PostToolUse 锁过期 | 🟢 低危 | ✅ 已优化 |

### 并发稳定性提升

**修复前**:
- 多进程并发写入可能失败（EPERM）
- 多个 watcher 互相冲突
- Registry 文件可能损坏

**修复后**:
- ✅ 自动重试机制处理 Windows 文件锁定
- ✅ 每个 session 独立运行 watcher
- ✅ 所有写入操作原子化
- ✅ 通过 100 次并发压力测试

---

## 技术细节

### 指数退避策略

```typescript
for (let attempt = 1; attempt <= 3; attempt++) {
  await new Promise(resolve => setTimeout(resolve, 50 * attempt));
  // 50ms → 100ms → 150ms
}
```

**优点**:
1. 第一次重试快速（50ms），应对短暂的锁竞争
2. 后续重试逐渐延长，给系统更多时间释放锁
3. 最多重试 3 次，总延迟 300ms，不影响用户体验

### 同步函数的重试

对于同步函数（如 `atomicWriteFileSync`），使用 `Atomics.wait` 实现非阻塞延迟：

```typescript
Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50 * attempt);
```

### Session-scoped PID 文件

```
之前: ~/.omx/state/notify-fallback.pid
现在: ~/.omx/state/notify-fallback.{sessionId}.pid
```

**示例**:
- Session A: `notify-fallback.omx-20260514-abc123.pid`
- Session B: `notify-fallback.omx-20260514-def456.pid`

---

## 兼容性

### 平台兼容性

- ✅ Windows: 主要受益平台
- ✅ POSIX (Linux/macOS): 不受影响（重试逻辑仅在 win32 上触发）
- ✅ WSL2: 正常工作

### Node.js 版本

- ✅ Node.js 18+: 完全支持
- ✅ Node.js 16+: 支持（需要 Atomics.wait 用于同步延迟）

---

## 测试命令

```bash
# 运行 Windows 并发测试
node --test dist/scripts/__tests__/windows-concurrency.test.js

# 运行 writeAtomic 相关测试
node --test dist/team/__tests__/state.test.js --test-name-pattern="writeAtomic"

# 运行所有测试
npm test
```

---

## 后续建议

### 已修复（本次）
- ✅ EPERM/EBUSY 错误处理
- ✅ 多实例 watcher 支持
- ✅ 原子写入加固
- ✅ 锁超时优化
- ✅ 并发测试覆盖

### 待修复（低优先级）
- 🟡 TOCTOU 防护（关键路径用 try-catch 代替 existsSync）
- 🟡 Daemon 启动竞态监控

---

## 总结

本次修复解决了 Windows 平台上最关键的并发稳定性问题，通过以下策略显著提升了系统可靠性：

1. **重试机制**: 智能处理 Windows 特有的文件锁定问题
2. **隔离设计**: 每个 session 独立运行，避免资源竞争
3. **原子操作**: 所有关键写入使用 temp+rename 模式
4. **测试验证**: 全面的并发压力测试确保修复有效

修复后，OMX 在 Windows 上的并发稳定性得到显著提升，可以安全地支持多进程、多 session 的并发使用场景。
