# 子代理模式切换指南

## 📋 概述

执行子代理支持两种运行模式,可以根据需求灵活切换:

1. **子代理模式 (Subagent Mode)** - 使用 DeepSeek V4 Flash 执行终端任务
2. **原生模式 (Native Mode)** - 使用本地 Shell 直接执行命令

## 🎯 两种模式对比

| 特性 | 子代理模式 🤖 | 原生模式 🖥️ |
|------|-------------|------------|
| **执行引擎** | DeepSeek V4 Flash (Anthropic API) | 本地 Shell (PowerShell/Bash) |
| **Token 消耗** | 极低 (子代理承担) | 较高 (主代理承担) |
| **智能思考** | ✅ 支持 | ❌ 不支持 |
| **缓存机制** | ✅ 应用层缓存 | ❌ 无缓存 |
| **速率限制** | ✅ 内置限制器 | ❌ 无限制 |
| **多步执行** | ✅ 自动规划 | ❌ 单步执行 |
| **成本** | ¥0.004-0.08/次 | 主代理成本 |
| **适用场景** | 批量任务、探索模式 | 调试、一次性任务 |

## 🔄 切换模式

### 方法 1: 启动参数 (推荐,最方便)

```bash
# 使用 --mode 参数临时切换 (不影响环境变量)

# 切换到子代理模式
owx subagent execute --mode subagent -q "运行构建和测试"

# 切换到原生模式
owx subagent execute --mode native -q "运行 ls -la"

# 优势: 无需设置环境变量,每次执行时指定即可
```

### 方法 2: 环境变量 (持久化配置)

**Linux/macOS:**
```bash
# 切换到子代理模式
export OMX_SUBAGENT_MODE=subagent

# 切换到原生模式
export OMX_SUBAGENT_MODE=native
```

**Windows PowerShell:**
```powershell
# 切换到子代理模式
$env:OMX_SUBAGENT_MODE="subagent"

# 切换到原生模式
$env:OMX_SUBAGENT_MODE="native"
```

**Windows CMD:**
```cmd
# 切换到子代理模式
set OMX_SUBAGENT_MODE=subagent

# 切换到原生模式
set OMX_SUBAGENT_MODE=native
```

### 方法 3: CLI 命令 (提示信息)

```bash
# 查看当前模式
owx subagent status

# 切换到子代理模式
owx subagent mode subagent

# 切换到原生模式
owx subagent mode native
```

> **注意**: CLI 命令只是提示信息,实际切换需要设置环境变量或使用 `--mode` 参数。

## 📊 查看当前模式

```bash
owx subagent status
```

输出示例 (子代理模式):
```
🔧 Execution Subagent 配置

运行模式:
   OMX_SUBAGENT_MODE: 子代理模式 (DeepSeek) 🤖

环境变量:
   DEEPSEEK_API_KEY: 已设置 ✅
   ...
```

输出示例 (原生模式):
```
🔧 Execution Subagent 配置

运行模式:
   OMX_SUBAGENT_MODE: 原生模式 (本地执行) 🖥️

环境变量:
   DEEPSEEK_API_KEY: 已设置 ✅
   ...
```

## 💻 代码中使用

### 检查当前模式

```typescript
import { 
  getSubagentMode, 
  isSubagentEnabled, 
  isNativeMode,
  getModeDescription 
} from './subagents/index.js';

// 获取模式
const mode = getSubagentMode(); // 'subagent' | 'native'

// 检查是否启用子代理
if (isSubagentEnabled()) {
  console.log('使用 DeepSeek 子代理');
}

// 检查是否原生模式
if (isNativeMode()) {
  console.log('使用本地 Shell 执行');
}

// 获取模式描述
console.log(getModeDescription());
// 输出: "子代理模式 (DeepSeek V4 Flash)" 或 "原生模式 (本地 Shell 执行)"
```

### 根据模式选择执行方式

```typescript
import { isSubagentEnabled, createExecutionSubagentFromEnv } from './subagents/index.js';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

async function executeTask(query: string) {
  if (isSubagentEnabled()) {
    // 使用子代理模式
    const subagent = createExecutionSubagentFromEnv();
    const result = await subagent.execute({ query });
    console.log('子代理结果:', result.finalAnswer);
    return result;
  } else {
    // 使用原生模式
    const { stdout, stderr } = await execAsync(query);
    console.log('原生执行结果:', stdout);
    return { stdout, stderr };
  }
}
```

## 🎯 使用场景建议

### 使用子代理模式 🤖

**推荐场景:**
- ✅ 批量执行任务 (构建、测试、检查)
- ✅ 探索模式 (需要多步执行和智能摘要)
- ✅ 重复性任务 (可以利用缓存)
- ✅ 成本敏感场景 (节省主代理 token)
- ✅ 复杂调试 (需要智能思考模式)

**示例:**
```bash
# 探索项目结构
owx subagent execute -q "分析项目结构,列出主要模块和依赖"

# 批量测试
owx subagent execute -q "运行单元测试,报告失败测试和覆盖率"

# 构建检查
owx subagent execute -q "运行构建,如果有错误请详细分析原因"
```

### 使用原生模式 🖥️

**推荐场景:**
- ✅ 快速单次命令执行
- ✅ 调试子代理问题
- ✅ API 配额用尽时
- ✅ 需要完整输出 (子代理会摘要)
- ✅ 本地开发快速迭代

**示例:**
```bash
# 简单命令
owx subagent execute -q "ls -la"

# 需要完整输出
owx subagent execute -q "cat package.json"

# 调试时绕过子代理
$env:OMX_SUBAGENT_MODE="native"
owx subagent execute -q "npm run build"
```

## ⚙️ 持久化配置

### Windows 永久环境变量

```powershell
# 永久设置为子代理模式
[Environment]::SetEnvironmentVariable("OMX_SUBAGENT_MODE", "subagent", "User")

# 永久设置为原生模式
[Environment]::SetEnvironmentVariable("OMX_SUBAGENT_MODE", "native", "User")
```

### Linux/macOS 永久环境变量

在 `~/.bashrc` 或 `~/.zshrc` 中添加:

```bash
# 子代理模式
export OMX_SUBAGENT_MODE=subagent

# 或原生模式
export OMX_SUBAGENT_MODE=native
```

## 🔧 环境变量优先级

子代理模式的判断优先级:

1. **环境变量 `OMX_SUBAGENT_MODE`** - 最高优先级
2. **默认值** - 如果未设置,默认使用 `subagent` 模式

```typescript
// 内部实现
function getSubagentMode(): SubagentMode {
  const mode = process.env.OMX_SUBAGENT_MODE?.trim().toLowerCase();
  if (mode === 'native') {
    return 'native';
  }
  return 'subagent'; // 默认
}
```

## 📝 完整示例

### 场景 1: 开发时临时切换 (使用 --mode 参数)

```bash
# 日常开发使用子代理模式
owx subagent execute --mode subagent -q "运行构建和测试"

# 调试问题时临时使用原生模式,查看完整输出
owx subagent execute --mode native -q "npm run build 2>&1"

# 无需设置环境变量,每次执行时指定即可
```

### 场景 2: CI/CD 中使用环境变量

```bash
# CI/CD 环境中,使用环境变量配置
export OMX_SUBAGENT_MODE=native
export OMX_SUBAGENT_ENABLED=false

# 执行构建
npm run build
npm test
```

### 场景 3: 批量任务使用子代理模式

```bash
# 批量分析项目 (使用 --mode 参数)
owx subagent execute --mode subagent -q "分析项目依赖"
owx subagent execute --mode subagent -q "检查构建状态"
owx subagent execute --mode subagent -q "运行单元测试"

# 第二次执行相同任务会命中缓存
owx subagent execute --mode subagent -q "分析项目依赖"  # 缓存命中 ⚡
```

## ⚠️ 注意事项

### 子代理模式

- ✅ 需要有效的 `DEEPSEEK_API_KEY`
- ✅ 受 DeepSeek API 速率限制
- ✅ 输出会被子代理摘要 (可能丢失细节)
- ✅ 支持智能缓存,重复任务更快
- ✅ **失败时自动降级到原生模式**

### 原生模式

- ⚠️ 主代理承担所有 token 消耗
- ⚠️ 无缓存机制
- ⚠️ 无智能思考
- ✅ 输出完整,适合调试
- ✅ 不依赖外部 API

## 🔄 自动降级机制

当子代理模式遇到以下错误时,会**自动降级到原生模式**:

- ❌ API Key 无效 (401 错误)
- ❌ API 配额用尽 (429 错误)
- ❌ 网络超时
- ❌ DeepSeek 服务不可用
- ❌ 其他 API 错误

**降级输出示例:**

```
deepseek: 执行子代理任务
deepseek:   查询: 运行 dir
deepseek:   模式: 子代理模式 (DeepSeek V4 Flash)

deepseek: ❌ DeepSeek 执行失败
deepseek:   错误: 401 {"error":{"message":"Authentication Fails..."}}

⚠️  降级到原生模式执行...

🖥️  原生模式执行
   命令: dir
   模式: 子代理模式 (DeepSeek V4 Flash)

[目录列表输出...]

💰 资源消耗:
   执行时间: 23ms
   模式: 原生模式 🖥️
   缓存命中: 不适用
```

**设计特点:**
- ✅ 错误信息带 `deepseek:` 前缀,明确标识失败原因
- ✅ 降级提示清晰可见
- ✅ 执行结果不带前缀,保持干净的上下文
- ✅ 自动提取命令 (去除 "运行"、"执行" 等中文前缀)

## 🐛 故障排除

### 问题: 模式切换不生效

```bash
# 检查环境变量是否正确设置
echo $env:OMX_SUBAGENT_MODE  # PowerShell
echo $OMX_SUBAGENT_MODE      # Linux/macOS

# 确认值正确 (必须是 "subagent" 或 "native")
owx subagent status
```

### 问题: 子代理模式报 API 错误

```bash
# 检查 API Key
echo $env:DEEPSEEK_API_KEY

# 临时切换到原生模式
$env:OMX_SUBAGENT_MODE="native"
```

### 问题: 原生模式输出被截断

```bash
# 原生模式应该输出完整内容
# 如果被截断,检查是否是子代理模式
owx subagent status

# 确保是原生模式
$env:OMX_SUBAGENT_MODE="native"
```

## 📚 相关资源

- **执行子代理使用指南**: `docs/issues/execution-subagent-usage.md`
- **实现总结**: `docs/issues/execution-subagent-summary.md`
- **核心代码**: `src/subagents/execution-subagent.ts`
- **模式工具**: `src/subagents/mode.ts`
- **CLI 命令**: `src/cli/subagent.ts`

## 📅 更新历史

- **2026-05-15**: 添加模式切换功能
  - 新增 `OMX_SUBAGENT_MODE` 环境变量
  - 新增 `owx subagent mode` 命令
  - 新增模式检查工具 (`src/subagents/mode.ts`)
  - 支持子代理/原生两种模式
