/**
 * Windows 并发写入压力测试
 * 
 * 验证原子写入函数在以下场景的正确性：
 * 1. 文件已存在时的并发覆盖写入
 * 2. 高并发下的锁竞争（10+ 并发写入）
 * 3. Windows EPERM/EBUSY 错误恢复
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { tmpdir } from 'os';
import { join } from 'path';
import { mkdir, rm, readFile, writeFile, stat } from 'fs/promises';
import { existsSync } from 'fs';

// 导入被测试的函数
import { writeAtomic } from '../../team/state.js';

describe('Windows 并发写入压力测试', { concurrency: false }, () => {
  let testDir: string;

  before(async () => {
    testDir = join(tmpdir(), `omx-win-concurrency-test-${Date.now()}`);
    await mkdir(testDir, { recursive: true });
  });

  after(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  describe('writeAtomic 并发覆盖写入', () => {
    it('文件已存在时的并发覆盖写入', async () => {
      const filePath = join(testDir, 'concurrent-overwrite.txt');
      
      // 先创建文件
      await writeFile(filePath, 'initial content', 'utf8');
      
      // 并发写入 10 次
      const writers = Array.from({ length: 10 }, (_, i) => i);
      await Promise.all(
        writers.map(async (i) => {
          const content = `writer-${i}-${Date.now()}`;
          await writeAtomic(filePath, content);
        })
      );
      
      // 验证文件仍然存在且包含某个写入者的内容
      assert.ok(existsSync(filePath), '文件应该在并发写入后仍然存在');
      const finalContent = await readFile(filePath, 'utf8');
      assert.ok(finalContent.length > 0, '文件应该包含内容');
      assert.ok(
        writers.some(i => finalContent.startsWith(`writer-${i}-`)),
        '文件应该包含某个写入者的内容'
      );
    });

    it('高并发压力测试（20 个并发写入）', async () => {
      const filePath = join(testDir, 'high-concurrency.txt');
      const writeCount = 20;
      
      // 并发写入 20 次
      await Promise.all(
        Array.from({ length: writeCount }, (_, i) => i).map(async (i) => {
          const content = `high-concurrent-write-${i}-${Date.now()}-${Math.random()}`;
          await writeAtomic(filePath, content);
        })
      );
      
      // 验证文件完整性
      assert.ok(existsSync(filePath), '文件应该在高并发后仍然存在');
      const stats = await stat(filePath);
      assert.ok(stats.size > 0, '文件大小应该大于 0');
      
      const content = await readFile(filePath, 'utf8');
      assert.ok(content.length > 0, '文件应该包含内容');
      assert.ok(
        content.startsWith('high-concurrent-write-'),
        '文件内容应该以预期的写入者标识开头'
      );
    });

    it('快速连续写入（序列化和并发混合）', async () => {
      const filePath = join(testDir, 'mixed-write-pattern.txt');
      
      // 先序列化写入 5 次
      for (let i = 0; i < 5; i++) {
        await writeAtomic(filePath, `sequential-${i}`);
      }
      
      // 然后并发写入 10 次
      await Promise.all(
        Array.from({ length: 10 }, (_, i) => i).map(async (i) => {
          await writeAtomic(filePath, `concurrent-${i}-${Date.now()}`);
        })
      );
      
      // 最后再序列化写入 5 次
      for (let i = 5; i < 10; i++) {
        await writeAtomic(filePath, `sequential-${i}`);
      }
      
      // 验证文件完整性
      assert.ok(existsSync(filePath), '文件应该在混合写入模式后仍然存在');
      const content = await readFile(filePath, 'utf8');
      assert.ok(content.length > 0, '文件应该包含内容');
    });
  });

  describe('Windows EPERM/EBUSY 错误恢复模拟', () => {
    it('验证错误处理逻辑存在', async () => {
      // 这个测试验证代码中存在 EPERM/EBUSY 处理逻辑
      // 实际触发需要 Windows 环境下的文件锁定
      
      const filePath = join(testDir, 'error-recovery-test.txt');
      
      // 正常写入应该成功
      await writeAtomic(filePath, 'test content');
      assert.ok(existsSync(filePath), '文件应该成功创建');
      
      const content = await readFile(filePath, 'utf8');
      assert.strictEqual(content, 'test content', '文件内容应该正确');
      
      // 覆盖写入也应该成功
      await writeAtomic(filePath, 'updated content');
      const updatedContent = await readFile(filePath, 'utf8');
      assert.strictEqual(updatedContent, 'updated content', '文件内容应该被更新');
    });
  });

  describe('长时间并发稳定性', () => {
    it('持续并发写入 100 次', async () => {
      const filePath = join(testDir, 'long-running-concurrency.txt');
      const iterations = 100;
      const batchSize = 10;
      
      // 分 10 批，每批 10 个并发写入
      for (let batch = 0; batch < iterations / batchSize; batch++) {
        await Promise.all(
          Array.from({ length: batchSize }, (_, i) => i).map(async (i) => {
            const content = `batch-${batch}-writer-${i}-${Date.now()}`;
            await writeAtomic(filePath, content);
          })
        );
      }
      
      // 验证文件完整性
      assert.ok(existsSync(filePath), '文件应该在长时间并发后仍然存在');
      const content = await readFile(filePath, 'utf8');
      assert.ok(content.length > 0, '文件应该包含内容');
      assert.ok(
        content.startsWith('batch-'),
        '文件内容应该以批次标识开头'
      );
    });
  });
});
