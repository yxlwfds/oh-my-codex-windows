# 执行子代理使用指南

## 📋 概述

基于 Terminus-4B 论文设计的执行子代理,将终端执行任务委托给 DeepSeek 小模型,节省主代理 token 消耗,同时通过智能思考模式和应用层缓存优化性能。

## 🚀 快速开始

### 1. 安装依赖

```bash
# 安装 Anthropic SDK (用于调用 DeepSeek Anthropic 兼容 API)
npm install @anthropic-ai/sdk

# 如果还没有安装 commander 和 chalk (CLI 依赖)
npm install commander chalk
```

### 2. 配置环境变量

创建 `.env` 文件或导出环境变量:

```bash
# DeepSeek API Key (必须)
export DEEPSEEK_API_KEY=sk-xxx

# 子代理配置
export OMX_SUBAGENT_MODEL=deepseek-v4-flash        # 子代理模型
export OMX_SUBAGENT_THINKING_MODE=smart            # 思考模式: always|smart|never
export OMX_SUBAGENT_MAX_TURNS=10                   # 最大执行轮次
export OMX_SUBAGENT_ENABLED=true                   # 是否启用

# 缓存配置
export OMX_SUBAGENT_CACHE_ENABLED=true             # 启用缓存
export OMX_SUBAGENT_CACHE_TTL=3600                 # 缓存有效期 (秒)

# 速率限制配置 (复用现有)
export OMX_RATE_LIMIT_CONCURRENCY=2                # 最大并发数
export OMX_RATE_LIMIT_DELAY_MS=500                 # 请求间隔 (ms)
export OMX_RATE_LIMIT_ENABLED=true                 # 启用速率限制
```

### 3. 测试安装

```bash
# 查看配置
owx subagent status

# 执行简单任务
owx subagent execute -q "运行 ls -la 查看当前目录"
```

## 📖 CLI 命令

### 执行任务

```bash
# 基本用法
owx subagent execute -q "运行构建和测试"

# 完整参数
owx subagent execute \
  -q "运行 npm run build,然后运行 npm test,报告失败详情" \
  -d "构建和测试" \
  --model deepseek-v4-flash \
  --thinking smart \
  --max-turns 10

# 禁用缓存
owx subagent execute -q "运行测试" --no-cache
```

### 查看配置

```bash
owx subagent status
```

输出示例:
```
🔧 Execution Subagent 配置

环境变量:
   DEEPSEEK_API_KEY: 已设置 ✅
   OMX_SUBAGENT_MODEL: deepseek-v4-flash (默认)
   OMX_SUBAGENT_THINKING_MODE: smart (默认)
   OMX_SUBAGENT_MAX_TURNS: 10 (默认)
   OMX_SUBAGENT_ENABLED: true (默认)

速率限制:
   OMX_RATE_LIMIT_CONCURRENCY: 2 (默认)
   OMX_RATE_LIMIT_DELAY_MS: 500 (默认)
   OMX_RATE_LIMIT_ENABLED: true (默认)

缓存统计:
   缓存条目: 15
   缓存大小: 45.23 KB
   最早缓存: 2026-5-15 10:30:00
   最新缓存: 2026-5-15 14:20:00
```

### 管理缓存

```bash
# 清除所有缓存
owx subagent clear-cache

# 清除过期缓存
owx subagent prune-cache
```

### 设置默认参数

```bash
owx subagent set \
  --model deepseek-v4-flash \
  --thinking smart \
  --max-turns 15
```

## 💻 代码中使用

### 基本用法

```typescript
import { createExecutionSubagentFromEnv } from './subagents/index.js';

// 从环境变量创建子代理
const subagent = createExecutionSubagentFromEnv();

// 执行任务
const result = await subagent.execute({
  query: '运行构建和测试,报告失败详情',
  description: '构建和测试'
});

console.log('执行结果:');
console.log(result.finalAnswer);
console.log(`Token 消耗: ${result.tokensUsed}`);
console.log(`缓存命中: ${result.fromCache}`);
```

### 自定义配置

```typescript
import { ExecutionSubagent } from './subagents/index.js';
import { createRateLimiterFromEnv } from './utils/rate-limiter.js';

const subagent = new ExecutionSubagent({
  apiKey: process.env.DEEPSEEK_API_KEY!,
  model: 'deepseek-v4-flash',
  thinkingMode: 'smart',
  maxTurns: 10,
  rateLimiter: createRateLimiterFromEnv(),
  cache: {
    enabled: true,
    ttlMs: 3600_000 // 1 小时
  }
});

const result = await subagent.execute({
  query: '运行 npm test'
});
```

### 批量执行

```typescript
const tasks = [
  '运行构建',
  '运行单元测试',
  '运行集成测试'
];

for (const task of tasks) {
  const result = await subagent.execute({ query: task });
  console.log(`${task}: ${result.status}`);
}
```

## 🎯 思考模式策略

### `always` - 总是启用

**适用场景:**
- 调试复杂问题
- 诊断构建失败
- 分析测试失败原因

**示例:**
```bash
owx subagent execute \
  -q "诊断为什么构建失败" \
  --thinking always
```

### `smart` - 智能决定 (推荐)

**自动判断:**
- ✅ 复杂任务 (debug, diagnose, fix) → 启用思考
- ✅ 中等任务 (build, test, install) → 启用思考
- ❌ 简单任务 (ls, cat, pwd) → 不启用思考
- ✅ 之前命令失败 → 启用思考

**示例:**
```bash
owx subagent execute \
  -q "运行构建和测试" \
  --thinking smart  # 默认
```

### `never` - 总是不启用

**适用场景:**
- 批量任务处理 (成本优先)
- 简单命令执行
- CI/CD 流水线

**示例:**
```bash
owx subagent execute \
  -q "运行 ls -la" \
  --thinking never
```

## 💾 缓存策略

### 缓存键设计

缓存基于:
1. **查询内容** - 任务描述
2. **仓库路径** - 当前工作目录
3. **Git 提交哈希** - 当前代码版本
4. **依赖锁定文件哈希** - package-lock.json, Cargo.lock 等

### 缓存失效

缓存在以下情况失效:
- ✅ 代码变更 (新的 commit)
- ✅ 依赖变更 (lock 文件变化)
- ✅ 超过 TTL (默认 1 小时)
- ✅ 手动清除

### 缓存命中率

| 场景 | 预期命中率 |
|------|-----------|
| 重复运行构建 | 80-90% |
| 相同代码库的不同任务 | 40-60% |
| 不同代码库 | 0-10% |
| **综合** | **30-50%** |

## 📊 性能对比

### 配置对比

| 配置 | 响应质量 | 速度 | 成本/次 | 命中率 |
|------|---------|------|---------|--------|
| 无思考 + 无缓存 | ⭐⭐ | 快 | ¥0.08 | 0% |
| 有思考 + 无缓存 | ⭐⭐⭐⭐ | 中 | ¥0.12 | 0% |
| 无思考 + 有缓存 | ⭐⭐ | 极快 | ¥0.00 (缓存) | 30-50% |
| **有思考 + 有缓存** | **⭐⭐⭐⭐** | **快** | **¥0.06** (平均) | **30-50%** |

### 与主代理对比

| 指标 | 无子代理 | 子代理 (DeepSeek) |
|------|---------|------------------|
| 主代理 Token | 1,010k | 693k (-31%) |
| 子代理 Token | - | 25k |
| 总成本 | $$$$ | $ |
| 解决率 | 46.7% | 46.7% |

## 🔧 集成到现有系统

### 集成到探索模式

```typescript
// src/cli/explore.ts
import { createExecutionSubagentFromEnv } from '../subagents/index.js';

async function exploreProject() {
  const subagent = createExecutionSubagentFromEnv();

  // 使用子代理运行构建和测试
  const buildResult = await subagent.execute({
    query: '运行构建,报告错误',
    description: '探索项目构建状态'
  });

  console.log('构建结果:', buildResult.finalAnswer);

  // 主代理基于摘要继续工作
  // ...
}
```

### 集成到团队系统

```typescript
// src/team/worker.ts
import { createExecutionSubagentFromEnv } from '../subagents/index.js';

async function workerTask() {
  const subagent = createExecutionSubagentFromEnv();

  // Worker 使用子代理执行测试
  const testResult = await subagent.execute({
    query: '运行单元测试,报告失败测试',
    description: '执行测试'
  });

  // 将结果报告给 Leader
  // ...
}
```

## ⚠️ 注意事项

### API 密钥安全

```bash
# ✅ 正确: 使用环境变量
export DEEPSEEK_API_KEY=sk-xxx

# ❌ 错误: 不要硬编码
const apiKey = 'sk-xxx'; // 不安全!
```

### 速率限制

- ✅ 子代理已集成速率限制器
- ✅ 默认配置: 2 并发, 500ms 间隔
- ✅ 根据 API 配额调整

### 成本控制

```bash
# 查看 DeepSeek 余额
# https://platform.deepseek.com/

# 估算成本
单次子代理调用: ~25k tokens
成本: 25k × ¥3/MTok = ¥0.075

每天 100 次调用: ¥7.5
每月 3000 次调用: ¥225
```

### 错误处理

```typescript
try {
  const result = await subagent.execute({ query: '运行测试' });
  
  if (result.status === 'failure') {
    console.error('执行失败:');
    console.error(result.finalAnswer);
    process.exit(1);
  }
} catch (error) {
  console.error('子代理调用失败:', error.message);
  
  // 回退到直接执行
  // ...
}
```

## 🐛 故障排除

### 问题: DEEPSEEK_API_KEY 未设置

```bash
# 解决方案
export DEEPSEEK_API_KEY=sk-xxx

# 或添加到 .env 文件
echo "DEEPSEEK_API_KEY=sk-xxx" >> .env
```

### 问题: 遇到 429 错误

```bash
# 降低并发数
export OMX_RATE_LIMIT_CONCURRENCY=1

# 增加延迟
export OMX_RATE_LIMIT_DELAY_MS=1000
```

### 问题: 缓存不生效

```bash
# 检查缓存配置
export OMX_SUBAGENT_CACHE_ENABLED=true

# 清除缓存重试
owx subagent clear-cache
```

### 问题: 响应质量差

```bash
# 启用思考模式
export OMX_SUBAGENT_THINKING_MODE=always

# 或使用模型
export OMX_SUBAGENT_MODEL=deepseek-v4-flash
```

## 📚 相关资源

- **Terminus-4B 论文**: `Terminus-4B.pdf`
- **方案设计文档**: `docs/issues/execution-subagent-termin.md`
- **速率限制器**: `src/utils/rate-limiter.ts`
- **子代理核心**: `src/subagents/execution-subagent.ts`
- **缓存模块**: `src/subagents/cache.ts`
- **系统提示词**: `src/subagents/prompts.ts`

## 📅 更新历史

- **2026-05-15**: 初始版本实现
  - 支持 DeepSeek V4 Flash (Anthropic 兼容模式)
  - 智能思考模式 (always/smart/never)
  - 应用层缓存 (基于 query + commit + deps)
  - 速率限制器集成
  - CLI 管理命令
