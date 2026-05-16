/**
 * 速率限制器 - 控制并发请求数量和请求间隔
 * 
 * 用于避免 API 429 Too Many Requests 错误
 */

export interface RateLimiterOptions {
  /** 最大并发数，默认 3 */
  maxConcurrency?: number;
  /** 请求之间的最小间隔（毫秒），默认 200ms */
  minDelayMs?: number;
  /** 是否启用，默认 true */
  enabled?: boolean;
}

export class RateLimiter {
  private maxConcurrency: number;
  private minDelayMs: number;
  private enabled: boolean;
  private activeCount = 0;
  private lastRequestTime = 0;
  private queue: Array<() => void> = [];

  constructor(options: RateLimiterOptions = {}) {
    this.maxConcurrency = options.maxConcurrency ?? 3;
    this.minDelayMs = options.minDelayMs ?? 200;
    this.enabled = options.enabled ?? true;
  }

  /**
   * 执行一个受速率限制的操作
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (!this.enabled) {
      return fn();
    }

    // 等待并发槽位
    if (this.activeCount >= this.maxConcurrency) {
      await new Promise<void>((resolve) => {
        this.queue.push(resolve);
      });
    }

    // 等待最小间隔
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequestTime;
    if (timeSinceLastRequest < this.minDelayMs && this.lastRequestTime > 0) {
      await new Promise((resolve) => 
        setTimeout(resolve, this.minDelayMs - timeSinceLastRequest)
      );
    }

    this.activeCount++;
    this.lastRequestTime = Date.now();

    try {
      return await fn();
    } finally {
      this.activeCount--;
      // 处理队列中的下一个请求
      const next = this.queue.shift();
      if (next) {
        next();
      }
    }
  }

  /**
   * 批量执行操作（带速率限制）
   */
  async executeBatch<T>(items: T[], fn: (item: T) => Promise<void>): Promise<void> {
    const promises = items.map((item) => this.execute(() => fn(item)));
    await Promise.all(promises);
  }

  /**
   * 更新配置
   */
  updateOptions(options: Partial<RateLimiterOptions>): void {
    if (options.maxConcurrency !== undefined) {
      this.maxConcurrency = options.maxConcurrency;
    }
    if (options.minDelayMs !== undefined) {
      this.minDelayMs = options.minDelayMs;
    }
    if (options.enabled !== undefined) {
      this.enabled = options.enabled;
    }
  }

  /**
   * 获取当前状态
   */
  getStatus(): { activeCount: number; queueLength: number } {
    return {
      activeCount: this.activeCount,
      queueLength: this.queue.length,
    };
  }
}

/**
 * 创建默认的速率限制器实例
 */
export function createRateLimiter(options?: RateLimiterOptions): RateLimiter {
  return new RateLimiter(options);
}

/**
 * 从环境变量创建速率限制器
 * 
 * 环境变量：
 * - OMX_RATE_LIMIT_CONCURRENCY: 最大并发数
 * - OMX_RATE_LIMIT_DELAY_MS: 最小延迟（毫秒）
 * - OMX_RATE_LIMIT_ENABLED: 是否启用 (true/false)
 */
export function createRateLimiterFromEnv(): RateLimiter {
  const concurrency = process.env.OMX_RATE_LIMIT_CONCURRENCY
    ? parseInt(process.env.OMX_RATE_LIMIT_CONCURRENCY, 10)
    : undefined;
  
  const delayMs = process.env.OMX_RATE_LIMIT_DELAY_MS
    ? parseInt(process.env.OMX_RATE_LIMIT_DELAY_MS, 10)
    : undefined;
  
  const enabled = process.env.OMX_RATE_LIMIT_ENABLED
    ? process.env.OMX_RATE_LIMIT_ENABLED === 'true'
    : undefined;

  return new RateLimiter({
    maxConcurrency: concurrency,
    minDelayMs: delayMs,
    enabled,
  });
}
