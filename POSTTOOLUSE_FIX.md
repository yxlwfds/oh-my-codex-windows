# PostToolUse Hook 并发问题修复说明

## 问题描述

在使用 oh-my-codex (OMX) 项目时，PostToolUse hook 会出现以下错误：
```
• PostToolUse hook (failed)
  error: hook exited with code 1
```

特别是在并行任务较多时（超过 5 个），失败几率显著增高。

## 根本原因

通过分析代码发现，PostToolUse hook 失败的主要原因包括：

### 1. Git 操作竞争条件
多个并行 worker 同时执行 git 操作时会发生冲突：
- `git add` - 添加文件到暂存区
- `git commit` - 创建提交
- `git status` - 检查状态
- `git rev-parse` - 解析 HEAD

### 2. 文件写入竞争
多个 hook 实例同时写入共享文件：
- `posttooluse-dedupe.json` - 去重标记文件
- `heartbeat.json` - 心跳状态文件
- Ledger 文件 - 操作日志记录
- Team event 文件 - 团队事件记录

### 3. 缺少并发控制
原 `handleTeamWorkerPostToolUseSuccess` 函数没有使用任何锁机制来保护临界区操作，导致：
- 文件内容被覆盖
- Git 索引损坏
- 状态不一致

## 解决方案

### 实现细节

在 `src/scripts/notify-hook/team-worker-posttooluse.ts` 中添加了基于目录的锁机制：

```typescript
// 锁配置参数
const LOCK_RETRY_MS = 25;        // 重试间隔：25ms
const LOCK_TIMEOUT_MS = 5000;    // 获取锁超时：5秒
const LOCK_STALE_MS = 10000;     // 锁过期时间：10秒

// 锁目录路径
// {stateRoot}/team/{teamName}/workers/{workerName}/.lock.posttooluse/
```

### 锁机制特点

1. **原子性**：使用 `mkdir` 的原子性来判断锁的获取
2. **所有权标记**：在锁目录中写入 `owner` 文件标识持有者
3. **自动清理**：操作完成后自动释放锁
4. **过期恢复**：检测并清理超时未释放的 stale lock
5. **超时机制**：避免死锁，5 秒后放弃并抛出错误

### 工作流程

```
1. 尝试创建锁目录
   ├─ 成功 → 写入 owner 文件 → 执行临界区操作
   └─ 失败 (EEXIST)
       ├─ 检查是否为过期锁 → 是 → 删除后重试
       └─ 否 → 等待 25ms 后重试
           └─ 超过 5 秒 → 抛出超时错误

2. 执行临界区操作（受保护）
   - writeHeartbeat
   - checkpointIfEligible (git 操作)
   - appendLedger
   - appendLeaderSignal
   - writeDedupeMarker

3. 释放锁
   - 验证 owner 文件
   - 删除锁目录
```

## 代码变更

### 修改的文件

- `src/scripts/notify-hook/team-worker-posttooluse.ts`

### 主要变更

1. **新增锁管理函数**
   - `lockOwnerToken()` - 生成唯一的锁持有者令牌
   - `maybeRecoverStaleLock()` - 恢复过期锁
   - `withPostToolUseLock()` - 锁包装器函数

2. **修改主函数**
   - 将 `handleTeamWorkerPostToolUseSuccess` 的核心逻辑包裹在锁内
   - 确保所有文件写入和 git 操作都在临界区内执行

## 预期效果

### 改进前
- 并行任务 > 5 时，失败率显著增高
- 错误信息：`hook exited with code 1`
- 可能原因：git 冲突、文件覆盖、状态不一致

### 改进后
- 支持高并发场景（理论上无上限，取决于锁等待时间）
- 串行化每个 worker 的 PostToolUse hook 执行
- 自动处理死锁和过期锁
- 失败时提供明确的超时错误信息

## 注意事项

1. **性能影响**：引入锁机制后会有一定的性能开销（最多等待 5 秒）
2. **锁粒度**：锁是基于 `team/worker` 粒度的，不同 worker 之间不会互相阻塞
3. **超时处理**：如果某个 hook 执行时间过长（> 5 秒），可能会触发超时
4. **兼容性**：此更改向后兼容，不需要修改配置

## 测试建议

在并行任务场景下测试：
```bash
# 启动多个并行 worker
omx team launch --workers 10

# 观察 hook 执行情况
tail -f .omx/logs/native-hook-*.jsonl
```

## 故障排查

如果仍然出现 hook 失败，检查以下日志：

1. **Hook 执行日志**：`.omx/logs/native-hook-{date}.jsonl`
2. **Team 状态**：`.omx/state/team/{teamName}/`
3. **锁状态**：`.omx/state/team/{teamName}/workers/{workerName}/.lock.posttooluse/`

常见错误及解决方案：

| 错误信息 | 原因 | 解决方案 |
|---------|------|---------|
| `Timed out acquiring PostToolUse lock` | 锁持有者执行时间过长 | 检查是否有卡住的 git 操作 |
| `identity_worktree_mismatch` | worker 工作目录不匹配 | 检查 OMX_TEAM_INTERNAL_WORKER 环境变量 |
| `git_commit_conflict` | Git 合并冲突 | 手动解决冲突后继续 |

## 后续优化建议

1. **可配置的超时时间**：通过环境变量 `OMX_POSTTOOLUSE_LOCK_TIMEOUT_MS` 调整
2. **监控和告警**：记录锁等待时间，监控并发冲突频率
3. **乐观锁优化**：对于读多写少的场景，考虑使用乐观锁
4. **批量操作**：合并多个小文件写入为单次操作

## 相关代码

- 锁实现参考：`src/team/state/locks.ts`
- Git 操作：`checkpointIfEligible()` 函数
- 状态写入：`writeHeartbeat()`, `writeDedupeMarker()`
- 事件记录：`appendTeamEvent()`, `appendLedger()`
