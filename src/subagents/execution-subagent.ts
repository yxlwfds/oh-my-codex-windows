/**
 * 执行子代理核心类
 * 
 * 基于 Terminus-4B 论文设计,将终端执行任务委托给 DeepSeek 小模型,
 * 通过 Anthropic 兼容 API 调用,支持智能思考模式和应用层缓存。
 */

import Anthropic from '@anthropic-ai/sdk';
import { execSync } from 'child_process';
import type {
  ExecutionSubagentOptions,
  SubagentQuery,
  SubagentResponse,
  CommandSummary,
  CommandResult,
  ThinkingMode
} from './types.js';
import { SubagentCache } from './cache.js';
import { getSubagentSystemPrompt } from './prompts.js';
import { createRateLimiterFromEnv, type RateLimiter } from '../utils/rate-limiter.js';

export class ExecutionSubagent {
  private client: Anthropic;
  private cache: SubagentCache;
  private rateLimiter: RateLimiter;
  private model: string;
  private thinkingMode: ThinkingMode;
  private maxTurns: number;
  private maxOutputSize: number;
  private enabled: boolean;

  constructor(options: ExecutionSubagentOptions) {
    // 初始化 Anthropic 客户端 (使用 DeepSeek Anthropic 兼容模式)
    this.client = new Anthropic({
      apiKey: options.apiKey,
      baseURL: 'https://api.deepseek.com/anthropic'
    });

    this.model = options.model ?? 'deepseek-v4-flash';
    this.thinkingMode = options.thinkingMode ?? 'smart';
    this.maxTurns = options.maxTurns ?? 10;
    this.maxOutputSize = options.maxOutputSize ?? 60 * 1024; // 60KB
    this.enabled = options.enabled ?? true;

    // 初始化缓存
    this.cache = new SubagentCache(options.cache);

    // 初始化速率限制器
    this.rateLimiter = options.rateLimiter ?? createRateLimiterFromEnv();
  }

  /**
   * 执行终端任务
   */
  async execute(query: SubagentQuery): Promise<SubagentResponse> {
    if (!this.enabled) {
      throw new Error('Execution subagent is disabled');
    }

    // 通过速率限制器执行,避免 429 错误
    return this.rateLimiter.execute(async () => {
      // 1. 尝试从缓存获取
      const cached = await this.cache.get(query.query);
      if (cached) {
        return { ...cached, fromCache: true };
      }

      // 2. 执行子代理循环
      const result = await this.runLoop(query.query);

      // 3. 保存到缓存
      await this.cache.set(query.query, result);

      return { ...result, fromCache: false };
    });
  }

  /**
   * 子代理执行循环
   */
  private async runLoop(query: string): Promise<SubagentResponse> {
    const commands: CommandSummary[] = [];
    let messages: Anthropic.MessageParam[] = [
      { role: 'user', content: query }
    ];

    let turn = 0;

    while (turn < this.maxTurns) {
      // 1. 评估任务复杂度,决定是否启用思考模式
      const enableThinking = this.shouldEnableThinking(query, commands);

      // 2. 调用 DeepSeek API
      const response = await this.callLLM(messages, enableThinking);

      // 3. 查找工具调用
      const toolBlock = response.content.find(
        (block: Anthropic.ContentBlock): block is Anthropic.ToolUseBlock => block.type === 'tool_use'
      );

      if (!toolBlock) {
        // 没有工具调用 = 子代理完成,提取最终答案
        const finalAnswer = this.extractFinalAnswer(response);
        
        return {
          commands,
          status: this.determineStatus(commands),
          finalAnswer,
          tokensUsed: response.usage?.input_tokens + response.usage?.output_tokens || 0,
          fromCache: false,
          thinkingEnabled: enableThinking
        };
      }

      // 4. 执行终端命令
      const { command, timeout } = toolBlock.input as { command: string; timeout?: number };
      const result = await this.runCommand(command, timeout ?? 30000);

      // 5. 截断输出
      const truncatedOutput = this.truncateOutput(result);

      // 6. 记录命令摘要
      commands.push({
        command,
        exitCode: result.exitCode,
        summary: this.generateSummary(result),
        error: result.stderr ? this.extractError(result.stderr) : undefined
      });

      // 7. 添加工具结果到对话
      messages = [
        ...messages,
        { role: 'assistant', content: response.content },
        {
          role: 'user',
          content: [{
            type: 'tool_result',
            tool_use_id: toolBlock.id,
            content: truncatedOutput
          }]
        }
      ];

      turn++;
    }

    // 达到最大轮次,强制返回最终答案
    return this.forceFinalAnswer(commands);
  }

  /**
   * 评估是否应该启用思考模式
   */
  private shouldEnableThinking(query: string, commands: CommandSummary[]): boolean {
    switch (this.thinkingMode) {
      case 'always':
        return true;
      case 'never':
        return false;
      case 'smart':
      default:
        return this.assessComplexity(query, commands);
    }
  }

  /**
   * 评估任务复杂度
   */
  private assessComplexity(query: string, commands: CommandSummary[]): boolean {
    const lowerQuery = query.toLowerCase();
    const commandText = commands.map(c => c.summary).join(' ');

    // 复杂任务: 需要诊断、调试、多步推理
    const complexKeywords = [
      'debug', 'diagnose', 'why', 'fix', 'analyze', 'troubleshoot',
      '错误', '失败', '失败的原因', '诊断'
    ];

    if (complexKeywords.some(keyword => lowerQuery.includes(keyword))) {
      return true;
    }

    // 如果之前的命令失败了,需要思考下一步
    if (commands.some(c => c.exitCode !== 0)) {
      return true;
    }

    // 简单任务: 单条命令,无需推理
    const simpleKeywords = ['^ls', '^cat', '^pwd', '^echo', '^whoami'];
    if (simpleKeywords.some(pattern => new RegExp(pattern).test(lowerQuery))) {
      return false;
    }

    // 中等任务: 构建、测试、安装
    const mediumKeywords = ['build', 'test', 'install', 'run', 'npm', 'yarn'];
    if (mediumKeywords.some(keyword => lowerQuery.includes(keyword))) {
      return true; // 中等任务也启用思考
    }

    // 默认启用思考
    return true;
  }

  /**
   * 调用 DeepSeek API (Anthropic 格式)
   */
  private async callLLM(
    messages: Anthropic.MessageParam[],
    enableThinking: boolean
  ): Promise<Anthropic.Message> {
    return this.client.messages.create({
      model: this.model,
      max_tokens: enableThinking ? 8000 : 4000,
      system: getSubagentSystemPrompt(enableThinking),
      
      // 启用思考模式 (DeepSeek 忽略 budget_tokens,但类型定义需要)
      thinking: enableThinking ? { type: 'enabled', budget_tokens: 1024 } : undefined,
      
      tools: [{
        name: 'run_in_terminal',
        description: 'Execute a shell command',
        input_schema: {
          type: 'object',
          properties: {
            command: {
              type: 'string',
              description: 'Shell command to execute'
            },
            timeout: {
              type: 'number',
              description: 'Timeout in milliseconds (default: 30000)'
            }
          },
          required: ['command']
        }
      }],
      messages
    });
  }

  /**
   * 执行终端命令
   */
  private async runCommand(command: string, timeout: number): Promise<CommandResult> {
    const startTime = Date.now();

    try {
      const stdout = execSync(command, {
        encoding: 'utf-8',
        timeout,
        maxBuffer: this.maxOutputSize,
        stdio: ['pipe', 'pipe', 'pipe']
      });

      return {
        command,
        exitCode: 0,
        stdout,
        stderr: '',
        duration: Date.now() - startTime
      };
    } catch (error: any) {
      return {
        command,
        exitCode: error.status ?? 1,
        stdout: error.stdout ?? '',
        stderr: error.stderr ?? error.message,
        duration: Date.now() - startTime
      };
    }
  }

  /**
   * 截断输出以控制大小
   */
  private truncateOutput(result: CommandResult): string {
    const maxChars = this.maxOutputSize;
    
    if (result.stdout.length + result.stderr.length <= maxChars) {
      return result.stdout + result.stderr;
    }

    // 截断策略: 保留开头和结尾
    const headSize = Math.floor(maxChars * 0.4);
    const tailSize = Math.floor(maxChars * 0.4);
    
    const fullOutput = result.stdout + result.stderr;
    
    if (fullOutput.length <= maxChars) {
      return fullOutput;
    }

    return (
      fullOutput.substring(0, headSize) +
      '\n\n... [输出已截断] ...\n\n' +
      fullOutput.substring(fullOutput.length - tailSize)
    );
  }

  /**
   * 生成命令摘要
   */
  private generateSummary(result: CommandResult): string {
    if (result.exitCode === 0) {
      // 成功: 提取关键信息
      const lines = result.stdout.split('\n').filter(line => line.trim());
      
      // 查找测试统计
      const testMatch = result.stdout.match(/(\d+) passed.*?(\d+) failed.*?(\d+) skipped/);
      if (testMatch) {
        return `All tests passed: ${testMatch[1]} passed, ${testMatch[2]} failed, ${testMatch[3]} skipped`;
      }

      // 查找构建结果
      const buildMatch = result.stdout.match(/Build (succeeded|failed)/i);
      if (buildMatch) {
        return `Build ${buildMatch[1].toLowerCase()}`;
      }

      // 默认: 返回前几行
      return lines.slice(0, 3).join('\n') || 'Command executed successfully';
    }

    // 失败: 提取错误信息
    return `Command failed with exit code ${result.exitCode}`;
  }

  /**
   * 提取关键错误信息
   */
  private extractError(stderr: string): string | undefined {
    const lines = stderr.split('\n').filter(line => line.trim());
    
    // 查找错误行
    const errorLine = lines.find(line => 
      line.toLowerCase().includes('error') ||
      line.toLowerCase().includes('failed') ||
      line.includes('✗')
    );

    return errorLine || lines.slice(0, 2).join('\n');
  }

  /**
   * 从响应中提取最终答案
   */
  private extractFinalAnswer(response: Anthropic.Message): string {
    const textBlocks = response.content.filter(
      (block: Anthropic.ContentBlock): block is Anthropic.TextBlock => block.type === 'text'
    );

    const fullText = textBlocks.map((block: Anthropic.TextBlock) => block.text).join('\n');

    // 尝试提取 <final_answer> 标签
    const match = fullText.match(/<final_answer>([\s\S]*?)<\/final_answer>/);
    if (match) {
      return match[1].trim();
    }

    // 如果没有标签,返回所有文本
    return fullText.trim();
  }

  /**
   * 确定整体执行状态
   */
  private determineStatus(commands: CommandSummary[]): 'success' | 'failure' | 'partial' {
    if (commands.length === 0) {
      return 'failure';
    }

    const allSuccess = commands.every(c => c.exitCode === 0);
    const allFailure = commands.every(c => c.exitCode !== 0);

    if (allSuccess) return 'success';
    if (allFailure) return 'failure';
    return 'partial';
  }

  /**
   * 达到最大轮次时强制返回最终答案
   */
  private forceFinalAnswer(commands: CommandSummary[]): SubagentResponse {
    const finalAnswer = `<final_answer>
执行达到最大轮次 (${this.maxTurns}),以下是已执行的命令:

${commands.map(c => `Command: ${c.command}\nSummary: ${c.summary}\nExit Code: ${c.exitCode}`).join('\n\n')}
</final_answer>`;

    return {
      commands,
      status: this.determineStatus(commands),
      finalAnswer,
      tokensUsed: 0,
      fromCache: false,
      thinkingEnabled: false
    };
  }

  /**
   * 更新配置
   */
  updateOptions(options: Partial<ExecutionSubagentOptions>): void {
    if (options.model) this.model = options.model;
    if (options.thinkingMode) this.thinkingMode = options.thinkingMode;
    if (options.maxTurns) this.maxTurns = options.maxTurns;
    if (options.enabled !== undefined) this.enabled = options.enabled;
  }

  /**
   * 清除缓存
   */
  async clearCache(): Promise<number> {
    return this.cache.clear();
  }

  /**
   * 获取缓存统计
   */
  async getCacheStats() {
    return this.cache.getStats();
  }
}

/**
 * 从环境变量创建执行子代理实例
 */
export function createExecutionSubagentFromEnv(): ExecutionSubagent {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    throw new Error(
      'DEEPSEEK_API_KEY environment variable is required. ' +
      'Please set it in your .env file or terminal.'
    );
  }

  const model = process.env.OMX_SUBAGENT_MODEL || 'deepseek-v4-flash';
  
  const thinkingMode = (
    process.env.OMX_SUBAGENT_THINKING_MODE || 'smart'
  ) as ThinkingMode;

  const maxTurns = process.env.OMX_SUBAGENT_MAX_TURNS
    ? parseInt(process.env.OMX_SUBAGENT_MAX_TURNS, 10)
    : 10;

  const enabled = process.env.OMX_SUBAGENT_ENABLED
    ? process.env.OMX_SUBAGENT_ENABLED === 'true'
    : true;

  return new ExecutionSubagent({
    apiKey,
    model,
    thinkingMode,
    maxTurns,
    enabled
  });
}
