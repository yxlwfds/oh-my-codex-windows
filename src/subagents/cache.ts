/**
 * 执行子代理应用层缓存
 * 
 * 由于 DeepSeek Anthropic 兼容模式不支持 cache_control,
 * 我们实现应用层缓存来优化性能和降低成本。
 */

import { createHash } from 'crypto';
import { readFile, writeFile, mkdir, readdir, unlink } from 'fs/promises';
import { join } from 'path';
import type { CacheEntry, CacheOptions, SubagentResponse } from './types.js';

export class SubagentCache {
  private cacheDir: string;
  private ttlMs: number;
  private enabled: boolean;

  constructor(options: CacheOptions = {}) {
    this.enabled = options.enabled ?? true;
    this.cacheDir = options.cacheDir ?? this.getDefaultCacheDir();
    this.ttlMs = options.ttlMs ?? 3600_000; // 默认 1 小时
  }

  /**
   * 获取默认缓存目录
   */
  private getDefaultCacheDir(): string {
    const home = process.env.HOME || process.env.USERPROFILE || '.';
    return join(home, '.omx', 'cache', 'subagent');
  }

  /**
   * 生成缓存键
   * 
   * 缓存键基于:
   * - 查询内容
   * - 仓库路径
   * - 当前提交哈希
   * - 依赖锁定文件哈希
   */
  async generateKey(query: string): Promise<string> {
    const components = [
      query,
      process.cwd(),
      await this.getGitCommitHash(),
      await this.getDependencyHash()
    ];

    const content = components.join('|');
    return createHash('sha256').update(content).digest('hex');
  }

  /**
   * 获取 Git 提交哈希
   */
  private async getGitCommitHash(): Promise<string> {
    try {
      const { execSync } = await import('child_process');
      return execSync('git rev-parse HEAD', { encoding: 'utf-8' }).trim();
    } catch {
      return 'no-git';
    }
  }

  /**
   * 获取依赖锁定文件哈希
   */
  private async getDependencyHash(): Promise<string> {
    const lockFiles = [
      'package-lock.json',
      'yarn.lock',
      'pnpm-lock.yaml',
      'Cargo.lock',
      'Gemfile.lock',
      'requirements.txt'
    ];

    const hashes: string[] = [];

    for (const file of lockFiles) {
      try {
        const content = await readFile(join(process.cwd(), file), 'utf-8');
        hashes.push(createHash('md5').update(content).digest('hex'));
      } catch {
        // 文件不存在,忽略
      }
    }

    return hashes.length > 0 ? hashes.join('-') : 'no-deps';
  }

  /**
   * 获取缓存
   */
  async get(query: string): Promise<SubagentResponse | null> {
    if (!this.enabled) {
      return null;
    }

    try {
      const key = await this.generateKey(query);
      const cacheFile = join(this.cacheDir, `${key}.json`);
      const content = await readFile(cacheFile, 'utf-8');
      const entry: CacheEntry = JSON.parse(content);

      // 检查是否过期
      if (Date.now() - entry.timestamp > this.ttlMs) {
        // 过期了,删除缓存
        await unlink(cacheFile).catch(() => {});
        return null;
      }

      // 验证仓库状态是否匹配
      const currentRepoState = await this.getRepoStateHash();
      if (entry.repoStateHash !== currentRepoState) {
        return null;
      }

      return entry.data;
    } catch {
      // 缓存不存在或读取失败
      return null;
    }
  }

  /**
   * 设置缓存
   */
  async set(query: string, data: SubagentResponse): Promise<void> {
    if (!this.enabled) {
      return;
    }

    try {
      await mkdir(this.cacheDir, { recursive: true });

      const key = await this.generateKey(query);
      const cacheFile = join(this.cacheDir, `${key}.json`);

      const entry: CacheEntry = {
        timestamp: Date.now(),
        data,
        repoStateHash: await this.getRepoStateHash()
      };

      await writeFile(cacheFile, JSON.stringify(entry, null, 2), 'utf-8');
    } catch (error) {
      // 缓存写入失败,不影响主流程
      console.error('[SubagentCache] Failed to save cache:', error);
    }
  }

  /**
   * 获取仓库状态哈希
   */
  private async getRepoStateHash(): Promise<string> {
    const components = [
      process.cwd(),
      await this.getGitCommitHash(),
      await this.getDependencyHash()
    ];

    return createHash('md5').update(components.join('|')).digest('hex');
  }

  /**
   * 清除所有缓存
   */
  async clear(): Promise<number> {
    if (!this.enabled) {
      return 0;
    }

    try {
      const files = await readdir(this.cacheDir);
      let count = 0;

      for (const file of files) {
        if (file.endsWith('.json')) {
          await unlink(join(this.cacheDir, file)).catch(() => {});
          count++;
        }
      }

      return count;
    } catch {
      return 0;
    }
  }

  /**
   * 清除过期缓存
   */
  async prune(): Promise<number> {
    if (!this.enabled) {
      return 0;
    }

    try {
      const files = await readdir(this.cacheDir);
      let pruned = 0;
      const now = Date.now();

      for (const file of files) {
        if (!file.endsWith('.json')) continue;

        const filePath = join(this.cacheDir, file);
        try {
          const content = await readFile(filePath, 'utf-8');
          const entry: CacheEntry = JSON.parse(content);

          if (now - entry.timestamp > this.ttlMs) {
            await unlink(filePath).catch(() => {});
            pruned++;
          }
        } catch {
          // 文件损坏,删除
          await unlink(filePath).catch(() => {});
          pruned++;
        }
      }

      return pruned;
    } catch {
      return 0;
    }
  }

  /**
   * 获取缓存统计信息
   */
  async getStats(): Promise<{
    totalEntries: number;
    totalSize: number;
    oldestEntry: Date | null;
    newestEntry: Date | null;
  }> {
    try {
      const files = await readdir(this.cacheDir);
      const jsonFiles = files.filter(f => f.endsWith('.json'));

      if (jsonFiles.length === 0) {
        return {
          totalEntries: 0,
          totalSize: 0,
          oldestEntry: null,
          newestEntry: null
        };
      }

      let totalSize = 0;
      let oldest: Date | null = null;
      let newest: Date | null = null;

      for (const file of jsonFiles) {
        const filePath = join(this.cacheDir, file);
        const stat = await import('fs/promises').then(fs => fs.stat(filePath));
        totalSize += stat.size;

        try {
          const content = await readFile(filePath, 'utf-8');
          const entry: CacheEntry = JSON.parse(content);
          const date = new Date(entry.timestamp);

          if (!oldest || date < oldest) oldest = date;
          if (!newest || date > newest) newest = date;
        } catch {
          // 忽略损坏的文件
        }
      }

      return {
        totalEntries: jsonFiles.length,
        totalSize,
        oldestEntry: oldest,
        newestEntry: newest
      };
    } catch {
      return {
        totalEntries: 0,
        totalSize: 0,
        oldestEntry: null,
        newestEntry: null
      };
    }
  }
}

/**
 * 从环境变量创建缓存实例
 */
export function createSubagentCacheFromEnv(): SubagentCache {
  const enabled = process.env.OMX_SUBAGENT_CACHE_ENABLED
    ? process.env.OMX_SUBAGENT_CACHE_ENABLED === 'true'
    : true;

  const ttlMs = process.env.OMX_SUBAGENT_CACHE_TTL
    ? parseInt(process.env.OMX_SUBAGENT_CACHE_TTL, 10) * 1000
    : 3600_000;

  const cacheDir = process.env.OMX_SUBAGENT_CACHE_DIR || undefined;

  return new SubagentCache({
    enabled,
    ttlMs,
    cacheDir
  });
}
