# API 速率限制问题与解决方案

## 问题描述

### 错误信息
```
exceeded retry limit, last status: 429 Too Many Requests
```

### 问题场景
- Codex CLI 在执行探索模式或文件读取操作时，同时发起多个文件读取请求
- 例如：并行读取多个 PHP 文件（`config/console.php`, `models/SystemInstallForm.php`, `controllers/InstallController.php`, `web/install.php`, `web/index.php`）
- API 请求频率过高，触发服务端速率限制（429 错误）

### 根本原因
1. **并发请求过多**：探索模式默认并行读取多个文件，没有速率限制
2. **请求间隔太短**：连续 API 调用之间没有足够的延迟
3. **Prompt 限制未强制执行**：虽然 `explore.md` 中有 "Batch no more than 5 file reads at once" 的提示，但实际执行时没有硬性限制

## 解决方案

### 1. 速率限制器库
**文件**: `src/utils/rate-limiter.ts`

提供以下功能：
- **并发控制**：限制同时进行的请求数量（默认 3）
- **延迟控制**：请求之间的最小间隔时间（默认 200ms）
- **批量执行**：支持批量操作并自动应用速率限制
- **可配置**：通过代码或环境变量配置

#### 使用示例
```typescript
import { createRateLimiter } from './utils/rate-limiter.js';

// 创建速率限制器
const limiter = createRateLimiter({
  maxConcurrency: 2,      // 最多 2 个并发请求
  minDelayMs: 500,        // 每个请求间隔 500ms
  enabled: true,          // 启用限制
});

// 单个请求
const result = await limiter.execute(async () => {
  return await readFile(filePath);
});

// 批量请求
const files = ['file1.php', 'file2.php', 'file3.php'];
await limiter.executeBatch(files, async (file) => {
  const content = await readFile(file);
  // 处理文件内容
});
```

### 2. 命令行配置工具
**文件**: `src/cli/rate-limit.ts`

已集成到 `owx` 命令中，提供友好的配置界面。

#### 命令用法

```bash
# 查看当前配置
owx rate-limit status

# 查看配置及环境变量示例
owx rate-limit status --env

# 设置参数
owx rate-limit set --concurrency 2 --delay 500

# 快捷设置（短参数）
owx rate-limit set -c 2 -d 500

# 使用预设配置
owx rate-limit preset conservative  # 保守模式：1并发, 1000ms间隔
owx rate-limit preset moderate      # 适中模式：2并发, 500ms间隔
owx rate-limit preset aggressive    # 激进模式：5并发, 100ms间隔

# 启用/禁用
owx rate-limit enable
owx rate-limit disable

# 重置为默认
owx rate-limit reset
```

#### 预设配置说明

| 预设名称 | 并发数 | 延迟 (ms) | 适用场景 |
|---------|--------|-----------|----------|
| `conservative` | 1 | 1000 | 严格的 API 限制，或调试阶段 |
| `moderate` | 2 | 500 | **推荐**，平衡速度和稳定性 |
| `aggressive` | 5 | 100 | 本地 API 或高配额场景 |

### 3. 环境变量配置

在终端中设置环境变量（优先级高于配置文件）：

**Linux/Mac:**
```bash
export OMX_RATE_LIMIT_CONCURRENCY=2
export OMX_RATE_LIMIT_DELAY_MS=500
export OMX_RATE_LIMIT_ENABLED=true
```

**Windows PowerShell:**
```powershell
$env:OMX_RATE_LIMIT_CONCURRENCY="2"
$env:OMX_RATE_LIMIT_DELAY_MS="500"
$env:OMX_RATE_LIMIT_ENABLED="true"
```

**Windows CMD:**
```cmd
set OMX_RATE_LIMIT_CONCURRENCY=2
set OMX_RATE_LIMIT_DELAY_MS=500
set OMX_RATE_LIMIT_ENABLED=true
```

### 4. 配置文件位置

配置文件保存在：
```
~/.omx/config/rate-limit.json
```

格式：
```json
{
  "concurrency": 2,
  "delayMs": 500,
  "enabled": true
}
```

## 快速开始

### 推荐配置（避免 429 错误）

```bash
# 1. 使用适中预设（推荐）
owx rate-limit preset moderate

# 2. 验证配置
owx rate-limit status

# 3. 或在会话中设置环境变量（临时生效）
# Linux/Mac
export OMX_RATE_LIMIT_CONCURRENCY=2
export OMX_RATE_LIMIT_DELAY_MS=500

# Windows PowerShell
$env:OMX_RATE_LIMIT_CONCURRENCY="2"
$env:OMX_RATE_LIMIT_DELAY_MS="500"
```

### 调试模式（保守配置）

如果遇到持续的 429 错误，可以使用更保守的设置：

```bash
owx rate-limit preset conservative
```

## 集成到代码中

### 在文件读取操作中应用

```typescript
import { createRateLimiterFromEnv } from './utils/rate-limiter.js';

// 从环境变量创建限制器
const limiter = createRateLimiterFromEnv();

// 在并行文件读取时应用限制
async function readMultipleFiles(filePaths: string[]): Promise<string[]> {
  const results: string[] = [];
  
  await limiter.executeBatch(filePaths, async (filePath) => {
    const content = await readFile(filePath, 'utf-8');
    results.push(content);
  });
  
  return results;
}
```

### 在探索模式中应用

探索模式的文件读取操作应该通过速率限制器进行：

```typescript
// 示例：探索模式中的批量文件读取
const filesToRead = await discoverFilesToRead();

const limiter = createRateLimiterFromEnv();

await limiter.executeBatch(filesToRead, async (file) => {
  const content = await readFile(file.path, 'utf-8');
  processFileContent(file, content);
});
```

## 监控和调试

### 查看当前状态

```bash
owx rate-limit status --env
```

输出示例：
```
📊 OMX 速率限制配置

  状态: ✅ 已启用
  最大并发数: 2
  请求间隔: 500ms

  配置文件: /Users/username/.omx/config/rate-limit.json

💡提示: 使用 "owx rate-limit set" 修改配置

🔧 环境变量配置方式

在终端中设置以下环境变量:
  export OMX_RATE_LIMIT_CONCURRENCY=2
  export OMX_RATE_LIMIT_DELAY_MS=500
  export OMX_RATE_LIMIT_ENABLED=true
```

### 运行时监控

在代码中监控速率限制器状态：

```typescript
const status = limiter.getStatus();
console.log(`活跃请求: ${status.activeCount}, 队列长度: ${status.queueLength}`);
```

## 故障排除

### 问题：仍然遇到 429 错误

**解决方案：**
1. 降低并发数：`owx rate-limit set --concurrency 1`
2. 增加延迟：`owx rate-limit set --delay 1000`
3. 使用保守预设：`owx rate-limit preset conservative`
4. 检查 API 配额是否已用尽

### 问题：速度太慢

**解决方案：**
1. 提高并发数：`owx rate-limit set --concurrency 5`
2. 减少延迟：`owx rate-limit set --delay 100`
3. 使用激进预设：`owx rate-limit preset aggressive`
4. 临时禁用（不推荐）：`owx rate-limit disable`

### 问题：配置不生效

**排查步骤：**
1. 检查配置文件是否存在：`ls -la ~/.omx/config/rate-limit.json`
2. 检查环境变量是否覆盖：`echo $OMX_RATE_LIMIT_CONCURRENCY`
3. 重启终端会话
4. 验证命令：`owx rate-limit status`

## 相关资源

- **Prompt 限制**：`prompts/explore.md` 中定义了 "Batch no more than 5 file reads at once"
- **速率限制器实现**：`src/utils/rate-limiter.ts`
- **CLI 工具实现**：`src/cli/rate-limit.ts`
- **主 CLI 集成**：`src/cli/index.ts`（已添加 `rate-limit` 命令）

## 待完成工作

- [ ] 在探索模式 (`src/cli/explore.ts`) 中集成速率限制器
- [ ] 在团队系统中集成速率限制器（`src/team/`）
- [ ] 添加自动重试机制（遇到 429 时自动等待并重试）
- [ ] 在 HUD 中显示当前速率限制状态
- [ ] 添加性能基准测试，验证不同配置的影响

## 更新历史

- **2026-05-15**: 创建速率限制器库和 CLI 配置工具
