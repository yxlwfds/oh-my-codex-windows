# 执行子代理系统完整指南

## 📋 目录

- [概述](#概述)
- [快速开始](#快速开始)
- [双模式运行](#双模式运行)
- [全局开关](#全局开关)
- [自动降级](#自动降级)
- [使用示例](#使用示例)
- [技术架构](#技术架构)
- [故障排除](#故障排除)

---

## 概述

基于 Terminus-4B 论文设计的执行子代理系统,将终端执行任务委托给 DeepSeek V4 Flash 小模型,节省主代理(Claude/GPT)的 token 消耗(目标 30%)。

### 核心特性

- 🤖 **智能子代理** - DeepSeek V4 Flash (Anthropic 兼容模式)
- 🖥️ **原生模式** - 本地 Shell 直接执行
- 🔄 **灵活切换** - 全局 `--nds` 参数、局部 `--mode` 参数、环境变量
- ⚡ **自动降级** - DeepSeek 失败时自动切换到原生模式
- 💾 **智能缓存** - 基于 query + commit + deps 的应用层缓存
- 🧠 **思考模式** - 根据任务复杂度动态启用 (always/smart/never)

---

## 快速开始

### 1. 安装依赖

```bash
npm install @anthropic-ai/sdk commander chalk
```

### 2. 配置环境变量

**Windows PowerShell:**
```powershell
[Environment]::SetEnvironmentVariable("DEEPSEEK_API_KEY", "sk-xxx", "User")
```

**Linux/macOS:**
```bash
export DEEPSEEK_API_KEY="sk-xxx"
```

### 3. 测试安装

```bash
# 查看配置
owx subagent status

# 执行任务 (默认使用 DeepSeek 子代理)
owx subagent execute -q "运行 dir"
```

---

## 双模式运行

### 模式对比

| 特性 | 子代理模式 🤖 | 原生模式 🖥️ |
|------|-------------|------------|
| **执行引擎** | DeepSeek V4 Flash | 本地 Shell |
| **Token 消耗** | 极低 (子代理承担) | 较高 (主代理承担) |
| **智能思考** | ✅ 支持 | ❌ 不支持 |
| **缓存机制** | ✅ 应用层缓存 | ❌ 无缓存 |
| **多步执行** | ✅ 自动规划 | ❌ 单步执行 |
| **成本** | ¥0.004-0.08/次 | 主代理成本 |
| **适用场景** | 批量任务、探索 | 调试、快速检查 |

### 切换方式

#### 方式 1: `--mode` 参数 (推荐,单次有效)

```bash
# 子代理模式
owx subagent execute --mode subagent -q "运行构建"

# 原生模式
owx subagent execute --mode native -q "运行 ls -la"
```

#### 方式 2: 环境变量 (持久化)

```bash
# Linux/macOS
export OMX_SUBAGENT_MODE=subagent  # 或 native

# Windows PowerShell
$env:OMX_SUBAGENT_MODE="subagent"
```

---

## 全局开关

### `--nds` 参数 (No DeepSeek Subagent)

一键禁用整个会话的 DeepSeek 子代理:

```bash
# 短参数 (推荐)
owx --nds subagent execute -q "运行 dir"

# 长参数
owx --no-deepseek-subagent subagent execute -q "运行 dir"
```

### 优势

- ✅ **全局生效** - 整个会话所有子代理任务都使用原生模式
- ✅ **无需环境变量** - 不需要设置 `OMX_SUBAGENT_MODE`
- ✅ **无副作用** - 不修改真实环境变量
- ✅ **位置灵活** - 可以放在 `owx` 后的任何位置

### 使用场景

```bash
# 调试时查看完整输出
owx --nds subagent execute -q "npm run build 2>&1"

# API 配额用尽时
owx --nds subagent execute -q "运行测试"

# CI/CD 环境 (不依赖外部 API)
owx --nds subagent execute -q "运行构建"
```

---

## 自动降级

### 触发条件

当 DeepSeek 遇到以下错误时,自动降级到原生模式:

- ❌ API Key 无效 (401 错误)
- ❌ API 配额用尽 (429 错误)
- ❌ 网络超时
- ❌ DeepSeek 服务不可用
- ❌ 其他 API 错误

### 降级输出

```
deepseek: 执行子代理任务
deepseek:   查询: 运行 dir
deepseek:   模式: 子代理模式 (DeepSeek V4 Flash)

deepseek: ❌ DeepSeek 执行失败
deepseek:   错误: 401 {"error":{"message":"Authentication Fails..."}}

⚠️  降级到原生模式执行...

🖥️  原生模式执行
   命令: dir
   模式: 原生模式 (本地 Shell 执行)

[完整目录输出...]

💰 资源消耗:
   执行时间: 23ms
   模式: 原生模式 🖥️
   缓存命中: 不适用
```

### 设计特点

- ✅ 错误信息带 `deepseek:` 前缀,明确标识失败原因
- ✅ 降级提示清晰可见 (黄色警告)
- ✅ **执行结果不带前缀**,保持干净的上下文
- ✅ 自动提取命令 (去除 "运行"、"执行" 等中文前缀)

---

## 使用示例

### 基础用法

```bash
# 查看配置
owx subagent status

# 执行简单任务
owx subagent execute -q "运行 dir"

# 执行复杂任务 (带描述)
owx subagent execute -q "运行构建和测试" -d "构建和测试"

# 使用原生模式
owx subagent execute --mode native -q "ls -la"

# 使用全局开关
owx --nds subagent execute -q "npm test"
```

### 批量任务

```bash
# 子代理模式 (利用缓存)
owx subagent execute -q "运行构建"
owx subagent execute -q "运行测试"
owx subagent execute -q "检查覆盖率"

# 第二次执行相同任务会命中缓存
owx subagent execute -q "运行构建"  # 缓存命中 ⚡
```

### 代码中使用

```typescript
import { 
  createExecutionSubagentFromEnv,
  isSubagentEnabled,
  getSubagentMode
} from './subagents/index.js';

// 检查模式
if (isSubagentEnabled()) {
  console.log('使用 DeepSeek 子代理');
}

// 创建并执行
const subagent = createExecutionSubagentFromEnv();
const result = await subagent.execute({
  query: '运行构建和测试,报告失败详情',
  description: '构建和测试'
});

console.log('结果:', result.finalAnswer);
console.log('Token 消耗:', result.tokensUsed);
console.log('缓存命中:', result.fromCache);
```

---

## 技术架构

### 核心组件

```
owx CLI
  ├── --nds 全局开关 (src/cli/index.ts)
  └── subagent 命令 (src/cli/subagent.ts)
       ├── --mode 局部参数
       ├── executeNativeCommand() - 原生模式
       └── executeSubagentCommand() - 子代理模式 (带降级)
            └── try-catch 降级逻辑

子代理核心 (src/subagents/)
  ├── execution-subagent.ts - 执行循环
  ├── cache.ts - 应用层缓存
  ├── mode.ts - 模式检查工具
  ├── prompts.ts - 系统提示词
  └── types.ts - 类型定义
```

### 模式优先级

```
--nds 全局参数 (最高)
  ↓
--mode 局部参数
  ↓
环境变量 OMX_SUBAGENT_MODE
  ↓
默认值 (subagent)
```

### 缓存策略

**缓存键设计:**
```typescript
缓存键 = SHA256(
  query +           // 查询内容
  cwd +             // 工作目录
  commitHash +      // Git 提交哈希
  dependencyHash    // 依赖锁定文件哈希
)
```

**预期命中率:**
- 重复运行构建: 80-90%
- 相同代码库的不同任务: 40-60%
- 不同代码库: 0-10%
- **综合**: 30-50%

### 思考模式策略

| 模式 | 说明 | 适用场景 |
|------|------|---------|
| `always` | 总是启用 | 调试复杂问题 |
| `smart` (默认) | 根据任务复杂度动态启用 | 日常使用 |
| `never` | 总不启用 | CI/CD、批量简单任务 |

**智能判断规则:**
- ✅ 复杂任务 (debug, diagnose, fix) → 启用思考
- ✅ 中等任务 (build, test, install) → 启用思考
- ❌ 简单任务 (ls, cat, pwd) → 不启用思考
- ✅ 之前命令失败 → 启用思考

---

## 故障排除

### 问题 1: DEEPSEEK_API_KEY 未设置

```bash
# Windows PowerShell
[Environment]::SetEnvironmentVariable("DEEPSEEK_API_KEY", "sk-xxx", "User")

# Linux/macOS
export DEEPSEEK_API_KEY="sk-xxx"
```

### 问题 2: 遇到 429 错误 (速率限制)

```bash
# 降低并发数
export OMX_RATE_LIMIT_CONCURRENCY=1

# 增加延迟
export OMX_RATE_LIMIT_DELAY_MS=1000
```

### 问题 3: 缓存不生效

```bash
# 检查缓存配置
export OMX_SUBAGENT_CACHE_ENABLED=true

# 清除缓存重试
owx subagent clear-cache
```

### 问题 4: 响应质量差

```bash
# 启用思考模式
owx subagent execute --thinking always -q "诊断构建失败"

# 或使用更强大的模型
export OMX_SUBAGENT_MODEL=deepseek-v4-flash
```

### 问题 5: DeepSeek 服务不可用

**自动降级已启用**,无需手动干预:

```bash
# 系统会自动降级到原生模式
owx subagent execute -q "运行 dir"
# 如果 DeepSeek 失败,自动使用本地 Shell 执行
```

---

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

---

## 📚 相关文档

- [模式切换指南](./subagent-mode-switch.md)
- [全局开关文档](./global-nds-flag.md)
- [自动降级说明](./subagent-fallback.md)
- [Terminus-4B 论文](./Terminus-4B.pdf)
- [方案设计文档](./execution-subagent-termin.md)
- [使用指南](./execution-subagent-usage.md)
- [实现总结](./execution-subagent-summary.md)

---

## 📅 更新历史

- **2026-05-15**: 完整实现
  - 执行子代理核心 (DeepSeek V4 Flash)
  - 智能思考模式 (always/smart/never)
  - 应用层缓存 (基于 query + commit + deps)
  - 速率限制器集成
  - CLI 管理命令

- **2026-05-15**: 双模式运行
  - 原生模式支持
  - `--mode` 参数切换
  - 模式检查工具

- **2026-05-15**: 自动降级
  - DeepSeek 失败自动降级
  - 智能命令提取
  - 明确的错误提示

- **2026-05-15**: 全局开关
  - `--nds` 短参数
  - `--no-deepseek-subagent` 长参数
  - 全局会话生效

---

## 🎯 最佳实践

### 日常开发

```bash
# 默认使用子代理模式 (智能、高效)
owx subagent execute -q "运行构建和测试"

# 需要完整输出时使用原生模式
owx subagent execute --mode native -q "npm run build 2>&1"
```

### 批量任务

```bash
# 利用缓存加速
owx subagent execute -q "运行构建"
owx subagent execute -q "运行测试"
# 重复执行相同任务会命中缓存 ⚡
```

### 调试问题

```bash
# 使用全局开关禁用 DeepSeek
owx --nds subagent execute -q "npm run build"
# 或使用局部参数
owx subagent execute --mode native -q "npm run build"
```

### CI/CD

```bash
# 使用全局开关,不依赖外部 API
owx --nds subagent execute -q "运行构建"
owx --nds subagent execute -q "运行测试"
```

---

**最后更新**: 2026-05-15  
**版本**: 1.0.0
