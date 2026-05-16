# Terminus-4B 风格执行子代理方案

## 📋 方案概述

基于 Terminus-4B 论文的核心思想,为 oh-my-codex 实现 **Execution Subagent(执行子代理)** 架构,将终端执行任务委托给专用小模型(如 DeepSeek Flash),同时结合现有速率限制器避免 API 429 错误。

### 核心优势
- ✅ **节省主代理 token**: 减少 30% 的主代理上下文消耗
- ✅ **保持上下文清洁**: 冗长的终端输出不进入主代理上下文
- ✅ **降低成本**: 使用便宜的 DeepSeek Flash 处理终端任务
- ✅ **避免 429 错误**: 集成速率限制器控制请求频率
- ✅ **结构化输出**: 子代理返回精简摘要,而非原始输出

---

## 🏗️ 架构设计

### 1. 整体架构

```
┌─────────────────────────────────────────────────────┐
│                   主代理 (Claude/GPT)                 │
│  - 代码理解、规划、编辑                                │
│  - 接收结构化摘要,不处理原始终端输出                    │
│  - Token 消耗: ~700k (vs 基线 1M+)                   │
└────────────────┬────────────────────────────────────┘
                 │ 委托终端任务
                 │ Query: "运行构建和测试,报告失败详情"
                 ▼
┌─────────────────────────────────────────────────────┐
│          Execution Subagent (DeepSeek Flash)         │
│  - 专用终端执行                                       │
│  - 独立上下文窗口                                     │
│  - 速率限制器控制请求频率                              │
│  - Token 消耗: ~25k (成本极低)                        │
└────────────────┬────────────────────────────────────┘
                 │ 返回结构化摘要
                 │ <final_answer>
                 │   Command: dotnet build
                 │   Summary: Build succeeded, 0 errors
                 │ </final_answer>
                 ▼
┌─────────────────────────────────────────────────────┐
│              主代理继续工作                            │
│  - 基于摘要做出决策                                   │
│  - 上下文保持清洁                                     │
└─────────────────────────────────────────────────────┘
```

### 2. 组件设计

#### 2.1 Execution Subagent 类

```typescript
// src/subagents/execution-subagent.ts

export interface ExecutionSubagentOptions {
  /** 子代理模型,默认 deepseek-flash */
  model?: string;
  /** 最大执行轮次,默认 10 */
  maxTurns?: number;
  /** 命令输出截断大小(字节),默认 60KB */
  maxOutputSize?: number;
  /** 速率限制器实例 */
  rateLimiter?: RateLimiter;
  /** 是否启用,默认 true */
  enabled?: boolean;
}

export interface SubagentQuery {
  /** 自然语言描述的执行任务 */
  query: string;
  /** 用户界面显示的简短描述 */
  description?: string;
}

export interface CommandSummary {
  /** 执行的命令 */
  command: string;
  /** 退出码 */
  exitCode: number;
  /** 执行结果摘要 */
  summary: string;
  /** 关键错误信息(如有) */
  error?: string;
}

export interface SubagentResponse {
  /** 所有执行的命令摘要 */
  commands: CommandSummary[];
  /** 整体执行状态 */
  status: 'success' | 'failure' | 'partial';
  /** 给主代理的最终答案 */
  finalAnswer: string;
  /** 消耗的子代理 token */
  tokensUsed: number;
}

export class ExecutionSubagent {
  private model: string;
  private maxTurns: number;
  private maxOutputSize: number;
  private rateLimiter: RateLimiter;
  private enabled: boolean;

  constructor(options: ExecutionSubagentOptions = {}) {
    this.model = options.model ?? 'deepseek-flash';
    this.maxTurns = options.maxTurns ?? 10;
    this.maxOutputSize = options.maxOutputSize ?? 60 * 1024; // 60KB
    this.rateLimiter = options.rateLimiter ?? createRateLimiterFromEnv();
    this.enabled = options.enabled ?? true;
  }

  /**
   * 执行终端任务并返回结构化摘要
   */
  async execute(query: SubagentQuery): Promise<SubagentResponse> {
    if (!this.enabled) {
      throw new Error('Execution subagent is disabled');
    }

    // 通过速率限制器执行,避免 429 错误
    return this.rateLimiter.execute(async () => {
      return this.runSubagentLoop(query);
    });
  }

  private async runSubagentLoop(query: SubagentQuery): Promise<SubagentResponse> {
    // 1. 初始化子代理上下文
    // 2. 循环执行命令(最多 maxTurns 轮)
    // 3. 收集命令输出
    // 4. 生成结构化摘要
    // 5. 返回最终答案
  }
}
```

#### 2.2 子代理系统提示词

```typescript
// src/subagents/prompts/execution-subagent.md

export const EXECUTION_SUBAGENT_SYSTEM_PROMPT = `
你是一个专门的终端执行助手,负责运行命令并返回结构化摘要。

## 任务
你将收到一个执行任务描述,需要:
1. 运行必要的终端命令来完成任务
2. 解释命令输出
3. 根据结果决定下一步操作
4. 返回结构化的最终答案

## 命令执行规则
- 始终使用同步模式 (sync)
- 设置明确的超时时间(短命令 30s,构建 120s)
- 每轮只调用一次终端工具(不支持并行)
- 自动确认提示(使用 --yes, -y, 或 yes)

## 输出格式(必须)
完成后,必须返回 <final_answer> 标签,包含每个命令的简明摘要:

<final_answer>
Command: dotnet build /testbed/Serilog.sln
Summary: Build succeeded. 9 warnings, 0 errors.

Command: dotnet test /testbed/Serilog.Tests.csproj
Summary: All 769 tests passed, 0 failed, 0 skipped.

Command: dotnet test /testbed/Serilog.ApprovalTests.csproj
Summary: Test Run Failed - 1 failed.
Error: Serilog.received.txt does not match Serilog.approved.txt.
The diff shows new API surface in LoggerAuditSinkConfiguration.
To fix: update the approved snapshot file.
</final_answer>

## 摘要要求
- 包含退出码(成功/失败)
- 提取关键错误信息
- 报告测试数量(通过/失败/跳过)
- 提供可操作的修复建议
- 保持简洁,避免冗长输出

## 可用工具
- run_in_terminal: 执行终端命令
`;
```

#### 2.3 主代理集成指令

```typescript
// src/subagents/prompts/main-agent-instruction.md

export const MAIN_AGENT_SUBAGENT_INSTRUCTION = `
## 使用 Execution Subagent

对于大多数终端执行任务,使用 ExecutionSubagent 工具来运行命令并获取输出的关键部分,而不是直接使用 Terminal 工具。

### 何时使用 ExecutionSubagent
- 运行构建命令
- 执行测试套件
- 安装依赖
- 运行诊断命令
- 任何会产生大量输出的命令

### 何时直接使用 Terminal
- 只需要单个命令的完整输出(不截断)
- 简单的单行命令(如 ls, cat)

### 调用示例
使用 ExecutionSubagent:
\`\`\`
query: "运行构建,然后运行单元测试和集成测试,报告通过/失败数量和错误详情"
description: "运行构建和测试"
\`\`\`

### 重要规则
- 不要并行调用多个 ExecutionSubagent
- 调用一个子代理后,等待其返回结果再继续
- 子代理会返回结构化摘要,直接使用摘要做出决策
- 如果摘要不清楚,可以再次调用子代理并提供更具体的查询
`;
```

---

## 🔧 实现步骤

### Phase 1: 基础架构 (1-2 天)

#### 1.1 创建子代理核心类

**文件结构:**
```
src/subagents/
├── execution-subagent.ts      # 子代理核心类
├── types.ts                   # 类型定义
├── prompts/
│   ├── execution-subagent.md  # 子代理系统提示词
│   └── main-agent-instruction.md  # 主代理集成指令
└── index.ts                   # 导出
```

**关键实现:**
```typescript
// src/subagents/execution-subagent.ts (核心逻辑)

async runSubagentLoop(query: SubagentQuery): Promise<SubagentResponse> {
  const commands: CommandSummary[] = [];
  let currentTurn = 0;
  let conversationHistory = [
    { role: 'system', content: EXECUTION_SUBAGENT_SYSTEM_PROMPT },
    { role: 'user', content: query.query }
  ];

  while (currentTurn < this.maxTurns) {
    // 1. 调用 LLM API (通过速率限制器)
    const response = await this.callLLM(conversationHistory);
    
    // 2. 解析工具调用
    const toolCall = this.parseToolCall(response);
    
    if (!toolCall) {
      // 没有工具调用,生成最终答案
      const finalAnswer = this.extractFinalAnswer(response);
      return {
        commands,
        status: this.determineStatus(commands),
        finalAnswer,
        tokensUsed: response.tokensUsed
      };
    }

    // 3. 执行终端命令
    const output = await this.executeCommand(toolCall.command);
    
    // 4. 截断输出
    const truncatedOutput = this.truncateOutput(output, this.maxOutputSize);
    
    // 5. 添加到对话历史
    conversationHistory.push(
      { role: 'assistant', content: response.content },
      { role: 'tool', content: truncatedOutput }
    );

    // 6. 记录命令摘要
    commands.push({
      command: toolCall.command,
      exitCode: output.exitCode,
      summary: this.generateSummary(output),
      error: output.stderr
    });

    currentTurn++;
  }

  // 达到最大轮次,强制返回最终答案
  return this.forceFinalAnswer(commands);
}
```

#### 1.2 集成速率限制器

```typescript
// 在子代理中使用现有速率限制器
import { createRateLimiterFromEnv } from '../utils/rate-limiter.js';

class ExecutionSubagent {
  private rateLimiter: RateLimiter;

  constructor(options: ExecutionSubagentOptions = {}) {
    // 使用现有的速率限制器
    this.rateLimiter = options.rateLimiter ?? createRateLimiterFromEnv();
  }

  async execute(query: SubagentQuery): Promise<SubagentResponse> {
    // 所有 LLM API 调用都通过速率限制器
    return this.rateLimiter.execute(async () => {
      return this.runSubagentLoop(query);
    });
  }

  private async callLLM(messages: Message[]): Promise<LLMResponse> {
    // 实际调用 DeepSeek API
    // 这个调用会被速率限制器控制频率
    const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.DEEPSEEK_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: this.model,
        messages,
        max_tokens: 4000
      })
    });

    // 处理 429 错误
    if (response.status === 429) {
      throw new Error('Rate limit exceeded, please adjust rate limiter settings');
    }

    return response.json();
  }
}
```

---

### Phase 2: CLI 集成 (1-2 天)

#### 2.1 添加子代理 CLI 命令

```typescript
// src/cli/subagent.ts

import { Command } from 'commander';
import { ExecutionSubagent } from '../subagents/execution-subagent.js';
import { createRateLimiterFromEnv } from '../utils/rate-limiter.js';

export function registerSubagentCommands(program: Command) {
  const subagentCmd = program.command('subagent')
    .description('管理执行子代理');

  // 执行子代理任务
  subagentCmd.command('execute')
    .description('通过子代理执行终端任务')
    .requiredOption('-q, --query <query>', '任务描述')
    .option('-d, --description <desc>', '简短描述')
    .option('--model <model>', '子代理模型', 'deepseek-flash')
    .action(async (opts) => {
      const subagent = new ExecutionSubagent({
        model: opts.model,
        rateLimiter: createRateLimiterFromEnv()
      });

      console.log(`🤖 执行子代理任务: ${opts.description || opts.query}`);
      
      const result = await subagent.execute({
        query: opts.query,
        description: opts.description
      });

      console.log('\n📊 执行结果:');
      console.log(result.finalAnswer);
      console.log(`\n💰 消耗 Token: ${result.tokensUsed}`);
      console.log(`📝 执行命令数: ${result.commands.length}`);
    });

  // 查看子代理配置
  subagentCmd.command('status')
    .description('查看子代理配置')
    .action(() => {
      console.log('🔧 Execution Subagent 配置:');
      console.log(`  模型: ${process.env.OMX_SUBAGENT_MODEL || 'deepseek-flash'}`);
      console.log(`  最大轮次: ${process.env.OMX_SUBAGENT_MAX_TURNS || 10}`);
      console.log(`  速率限制: ${process.env.OMX_RATE_LIMIT_ENABLED || 'true'}`);
      console.log(`  并发数: ${process.env.OMX_RATE_LIMIT_CONCURRENCY || 3}`);
      console.log(`  延迟: ${process.env.OMX_RATE_LIMIT_DELAY_MS || 200}ms`);
    });

  // 设置子代理参数
  subagentCmd.command('set')
    .description('设置子代理参数')
    .option('--model <model>', '子代理模型')
    .option('--max-turns <n>', '最大轮次')
    .action((opts) => {
      // 保存到配置文件
      console.log('✅ 配置已更新');
    });
}
```

#### 2.2 集成到探索模式

```typescript
// src/cli/explore.ts (修改现有代码)

import { ExecutionSubagent } from '../subagents/execution-subagent.js';
import { createRateLimiterFromEnv } from '../utils/rate-limiter.js';

// 在探索模式中集成子代理
async function exploreWithSubagent(options: ExploreOptions) {
  const subagent = new ExecutionSubagent({
    model: 'deepseek-flash',
    rateLimiter: createRateLimiterFromEnv()
  });

  // 示例:使用子代理运行构建和测试
  const result = await subagent.execute({
    query: `
      1. 运行 npm install 安装依赖
      2. 运行 npm run build 构建项目
      3. 运行 npm test 执行测试
      4. 报告所有失败和错误详情
    `,
    description: '探索项目构建和测试状态'
  });

  console.log('📊 构建和测试结果:');
  console.log(result.finalAnswer);

  // 主代理基于摘要继续工作,不需要处理原始输出
  return result;
}
```

---

### Phase 3: 配置和环境 (0.5 天)

#### 3.1 环境变量配置

```bash
# .env 配置示例

# 子代理配置
OMX_SUBAGENT_MODEL=deepseek-flash          # 子代理模型
OMX_SUBAGENT_MAX_TURNS=10                  # 最大执行轮次
OMX_SUBAGENT_ENABLED=true                  # 是否启用子代理

# DeepSeek API
DEEPSEEK_API_KEY=sk-xxx                    # DeepSeek API 密钥

# 速率限制配置 (复用现有)
OMX_RATE_LIMIT_CONCURRENCY=2               # 最大并发数
OMX_RATE_LIMIT_DELAY_MS=500                # 请求间隔 (ms)
OMX_RATE_LIMIT_ENABLED=true                # 启用速率限制
```

#### 3.2 配置文件

```json
// ~/.omx/config/subagent.json
{
  "model": "deepseek-flash",
  "maxTurns": 10,
  "enabled": true,
  "maxOutputSize": 61440,
  "rateLimiter": {
    "maxConcurrency": 2,
    "minDelayMs": 500,
    "enabled": true
  }
}
```

---

## 📊 性能对比

### 预期效果 (基于 Terminus-4B 论文数据)

| 指标 | 无子代理 | 子代理 (Opus) | 子代理 (DeepSeek Flash) |
|------|---------|--------------|------------------------|
| 主代理 Token | 1,010k | 693k (-31%) | 693k (-31%) |
| 子代理 Token | - | 25k | 25k |
| 总成本 | $$$$ | $$$ | $ |
| 主代理终端调用 | 6.2 次/实例 | 1.7 次/实例 (-73%) | 1.7 次/实例 (-73%) |
| 解决率 | 46.7% | 46.7% | 46.7% |

### 成本估算

假设:
- Claude Sonnet: $15/MTok (输入) + $75/MTok (输出)
- DeepSeek Flash: $0.2/MTok (输入) + $1.0/MTok (输出)

**单实例成本对比:**
```
无子代理:
  1,010k tokens × $15/MTok = $15.15

子代理 (Opus):
  主代理: 693k × $15/MTok = $10.40
  子代理: 25k × $75/MTok = $1.88
  总计: $12.28 (节省 19%)

子代理 (DeepSeek Flash):
  主代理: 693k × $15/MTok = $10.40
  子代理: 25k × $1.0/MTok = $0.03
  总计: $10.43 (节省 31%)
```

---

## 🎯 与现有方案的结合

### 速率限制器 + 子代理 = 完整解决方案

```
┌──────────────────────────────────────────────┐
│              主代理 (Claude/GPT)               │
│  需要执行终端命令                              │
└──────────────┬───────────────────────────────┘
               │
               ▼
┌──────────────────────────────────────────────┐
│          Execution Subagent 类                 │
│  1. 接收任务查询                               │
│  2. 创建子代理上下文                           │
└──────────────┬───────────────────────────────┘
               │
               ▼
┌──────────────────────────────────────────────┐
│            RateLimiter (现有)                  │
│  ✓ 控制并发数 (默认 2)                         │
│  ✓ 控制请求间隔 (默认 500ms)                   │
│  ✓ 避免 429 错误                              │
└──────────────┬───────────────────────────────┘
               │
               ▼
┌──────────────────────────────────────────────┐
│         DeepSeek Flash API                     │
│  - 执行终端命令                                │
│  - 生成结构化摘要                              │
│  - 低成本 ($0.03/实例)                         │
└──────────────┬───────────────────────────────┘
               │
               ▼
┌──────────────────────────────────────────────┐
│         返回结构化摘要给主代理                  │
│  - 主代理上下文保持清洁                        │
│  - 节省 30% token                             │
│  - 避免 429 错误                              │
└──────────────────────────────────────────────┘
```

---

## 🚀 快速开始

### 1. 安装和配置

```bash
# 设置环境变量
export DEEPSEEK_API_KEY=sk-xxx
export OMX_SUBAGENT_MODEL=deepseek-flash
export OMX_RATE_LIMIT_CONCURRENCY=2
export OMX_RATE_LIMIT_DELAY_MS=500

# 查看配置
owx subagent status

# 测试子代理
owx subagent execute -q "运行 npm install && npm run build,报告结果"
```

### 2. 在代码中使用

```typescript
import { ExecutionSubagent } from './subagents/execution-subagent.js';
import { createRateLimiterFromEnv } from './utils/rate-limiter.js';

// 创建子代理实例
const subagent = new ExecutionSubagent({
  model: 'deepseek-flash',
  rateLimiter: createRateLimiterFromEnv()
});

// 执行任务
const result = await subagent.execute({
  query: '运行测试套件,报告失败的测试和错误详情',
  description: '运行测试'
});

console.log(result.finalAnswer);
```

---

## ⚠️ 注意事项

### 1. 速率限制是必须的

**即使使用 DeepSeek Flash,仍然需要速率限制器:**
- DeepSeek 也有 API 限制
- 多个子代理实例并发时会触发限流
- 现有 `rate-limiter.ts` 可以直接复用

### 2. 模型选择建议

| 场景 | 推荐模型 | 原因 |
|------|---------|------|
| 日常开发 | deepseek-flash | 便宜、快速、够用 |
| 复杂构建 | deepseek-chat | 更强的推理能力 |
| 关键任务 | claude-sonnet | 最高可靠性 |

### 3. 与现有团队系统的关系

oh-my-codex 已经有**团队子代理**机制 (`src/team/worker-bootstrap.ts`),本方案是**补充**而非替代:
- **团队子代理**: 用于并行任务分解 (多个 worker 协作)
- **执行子代理**: 用于终端执行委托 (单个专用模型)

两者可以**同时使用**:
```
团队 Leader
  ├─ Worker 1 (架构师)
  │    └─ 使用执行子代理运行构建
  ├─ Worker 2 (实现者)
  │    └─ 使用执行子代理运行测试
  └─ Worker 3 (测试者)
       └─ 使用执行子代理运行集成测试
```

---

## 📝 待完成工作

- [ ] **Phase 1**: 实现 ExecutionSubagent 核心类
  - [ ] 创建 `src/subagents/execution-subagent.ts`
  - [ ] 编写系统提示词
  - [ ] 实现子代理循环逻辑
  - [ ] 集成速率限制器

- [ ] **Phase 2**: CLI 集成
  - [ ] 创建 `src/cli/subagent.ts`
  - [ ] 添加 `owx subagent` 命令
  - [ ] 集成到探索模式
  - [ ] 集成到团队系统

- [ ] **Phase 3**: 测试和优化
  - [ ] 编写单元测试
  - [ ] 端到端测试 (SWE-Bench 风格)
  - [ ] 性能基准测试
  - [ ] 成本分析

- [ ] **Phase 4**: 文档和示例
  - [ ] 更新 README
  - [ ] 编写使用示例
  - [ ] 添加配置指南

---

## 🔗 相关资源

- **Terminus-4B 论文**: `Terminus-4B.pdf` (本文档的核心灵感来源)
- **现有速率限制器**: `src/utils/rate-limiter.ts`
- **速率限制 CLI**: `src/cli/rate-limit.ts`
- **团队子代理**: `src/team/worker-bootstrap.ts`
- **API 限流问题**: `docs/issues/api-rate-limiting.md`

---

## 📅 更新历史

- **2026-05-15**: 创建方案文档,基于 Terminus-4B 论文设计架构
