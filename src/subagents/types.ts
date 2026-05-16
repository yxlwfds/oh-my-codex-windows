/**
 * 执行子代理类型定义
 */

/** 思考模式策略 */
export type ThinkingMode = 'always' | 'smart' | 'never';

/** 子代理查询参数 */
export interface SubagentQuery {
  /** 自然语言描述的执行任务 */
  query: string;
  /** 用户界面显示的简短描述 */
  description?: string;
}

/** 命令执行结果 */
export interface CommandResult {
  /** 执行的命令 */
  command: string;
  /** 退出码 */
  exitCode: number;
  /** 标准输出 */
  stdout: string;
  /** 标准错误 */
  stderr: string;
  /** 执行耗时 (毫秒) */
  duration: number;
}

/** 命令摘要 (返回给主代理) */
export interface CommandSummary {
  /** 执行的命令 */
  command: string;
  /** 退出码 */
  exitCode: number;
  /** 执行结果摘要 */
  summary: string;
  /** 关键错误信息 (如有) */
  error?: string;
}

/** 子代理响应 */
export interface SubagentResponse {
  /** 所有执行的命令摘要 */
  commands: CommandSummary[];
  /** 整体执行状态 */
  status: 'success' | 'failure' | 'partial';
  /** 给主代理的最终答案 */
  finalAnswer: string;
  /** 消耗的子代理 token */
  tokensUsed: number;
  /** 是否来自缓存 */
  fromCache: boolean;
  /** 思考模式是否启用 */
  thinkingEnabled: boolean;
}

/** 子代理配置选项 */
export interface ExecutionSubagentOptions {
  /** DeepSeek API Key */
  apiKey: string;
  /** 子代理模型,默认 deepseek-v4-flash */
  model?: string;
  /** 思考模式策略,默认 'smart' */
  thinkingMode?: ThinkingMode;
  /** 最大执行轮次,默认 10 */
  maxTurns?: number;
  /** 命令输出截断大小 (字节),默认 60KB */
  maxOutputSize?: number;
  /** 是否启用,默认 true */
  enabled?: boolean;
  /** 速率限制器实例 */
  rateLimiter?: import('../utils/rate-limiter.js').RateLimiter;
  /** 缓存配置 */
  cache?: CacheOptions;
}

/** 缓存配置 */
export interface CacheOptions {
  /** 是否启用缓存,默认 true */
  enabled?: boolean;
  /** 缓存目录 */
  cacheDir?: string;
  /** 缓存有效期 (毫秒),默认 1 小时 */
  ttlMs?: number;
}

/** 缓存条目 */
export interface CacheEntry {
  /** 时间戳 */
  timestamp: number;
  /** 缓存的数据 */
  data: SubagentResponse;
  /** 仓库状态哈希 */
  repoStateHash: string;
}
