#!/usr/bin/env node
/**
 * OMX 速率限制配置命令
 * 
 * 用法:
 *   owx rate-limit status                  # 查看当前配置
 *   owx rate-limit set --concurrency 2     # 设置最大并发数
 *   owx rate-limit set --delay 500         # 设置请求间隔（毫秒）
 *   owx rate-limit enable                  # 启用速率限制
 *   owx rate-limit disable                 # 禁用速率限制
 *   owx rate-limit reset                   # 重置为默认值
 */

import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

interface RateLimitConfig {
  concurrency: number;
  delayMs: number;
  enabled: boolean;
}

const DEFAULT_CONFIG: RateLimitConfig = {
  concurrency: 3,
  delayMs: 200,
  enabled: true,
};

function getConfigPath(): string {
  return join(homedir(), '.omx', 'config', 'rate-limit.json');
}

async function loadConfig(): Promise<RateLimitConfig> {
  const configPath = getConfigPath();
  if (!existsSync(configPath)) {
    return DEFAULT_CONFIG;
  }
  
  try {
    const content = await readFile(configPath, 'utf-8');
    return JSON.parse(content);
  } catch {
    return DEFAULT_CONFIG;
  }
}

async function saveConfig(config: RateLimitConfig): Promise<void> {
  const configPath = getConfigPath();
  const configDir = join(homedir(), '.omx', 'config');
  
  if (!existsSync(configDir)) {
    await mkdir(configDir, { recursive: true });
  }
  
  await writeFile(configPath, JSON.stringify(config, null, 2), 'utf-8');
}

function printConfig(config: RateLimitConfig): void {
  console.log('\n📊 OMX 速率限制配置\n');
  console.log(`  状态: ${config.enabled ? '✅ 已启用' : '❌ 已禁用'}`);
  console.log(`  最大并发数: ${config.concurrency}`);
  console.log(`  请求间隔: ${config.delayMs}ms`);
  console.log(`\n  配置文件: ${getConfigPath()}`);
  console.log('\n💡提示: 使用 "owx rate-limit set" 修改配置\n');
}

function printEnvVars(config: RateLimitConfig): void {
  console.log('\n🔧 环境变量配置方式\n');
  console.log('在终端中设置以下环境变量:');
  console.log(`  export OMX_RATE_LIMIT_CONCURRENCY=${config.concurrency}`);
  console.log(`  export OMX_RATE_LIMIT_DELAY_MS=${config.delayMs}`);
  console.log(`  export OMX_RATE_LIMIT_ENABLED=${config.enabled}`);
  console.log('\nWindows PowerShell:');
  console.log(`  $env:OMX_RATE_LIMIT_CONCURRENCY="${config.concurrency}"`);
  console.log(`  $env:OMX_RATE_LIMIT_DELAY_MS="${config.delayMs}"`);
  console.log(`  $env:OMX_RATE_LIMIT_ENABLED="${config.enabled}"`);
  console.log('\n');
}

async function statusCommand(options: { env?: boolean }): Promise<void> {
  const config = await loadConfig();
  printConfig(config);
  if (options.env) {
    printEnvVars(config);
  }
}

async function setCommand(options: {
  concurrency?: number;
  delay?: number;
}): Promise<void> {
  const config = await loadConfig();
  
  if (options.concurrency !== undefined) {
    config.concurrency = options.concurrency;
    console.log(`✅ 最大并发数已设置为: ${config.concurrency}`);
  }
  
  if (options.delay !== undefined) {
    config.delayMs = options.delay;
    console.log(`✅ 请求间隔已设置为: ${config.delayMs}ms`);
  }
  
  await saveConfig(config);
  console.log('\n📝 配置已保存\n');
  printEnvVars(config);
}

async function enableCommand(): Promise<void> {
  const config = await loadConfig();
  config.enabled = true;
  await saveConfig(config);
  console.log('✅ 速率限制已启用\n');
  printConfig(config);
}

async function disableCommand(): Promise<void> {
  const config = await loadConfig();
  config.enabled = false;
  await saveConfig(config);
  console.log('❌ 速率限制已禁用\n');
  console.log('⚠️  警告: 禁用后可能遇到 429 Too Many Requests 错误\n');
}

async function resetCommand(): Promise<void> {
  await saveConfig(DEFAULT_CONFIG);
  console.log('✅ 已重置为默认配置\n');
  printConfig(DEFAULT_CONFIG);
}

async function presetCommand(name: string): Promise<void> {
  const presets: Record<string, RateLimitConfig> = {
    conservative: {
      concurrency: 1,
      delayMs: 1000,
      enabled: true,
    },
    moderate: {
      concurrency: 2,
      delayMs: 500,
      enabled: true,
    },
    aggressive: {
      concurrency: 5,
      delayMs: 100,
      enabled: true,
    },
  };

  const preset = presets[name];
  if (!preset) {
    console.error(`❌ 未知的预设: ${name}`);
    console.log('\n可用预设:');
    console.log('  conservative - 保守模式 (1 并发, 1000ms 间隔)');
    console.log('  moderate     - 适中模式 (2 并发, 500ms 间隔)');
    console.log('  aggressive   - 激进模式 (5 并发, 100ms 间隔)');
    process.exit(1);
  }

  await saveConfig(preset);
  console.log(`✅ 已应用预设: ${name}\n`);
  printConfig(preset);
  printEnvVars(preset);
}

function printHelp(): void {
  console.log(`
OMX API 速率限制配置工具

用法:
  owx rate-limit status                  查看当前配置
  owx rate-limit status --env            查看配置及环境变量示例
  owx rate-limit set [options]           设置速率限制参数
  owx rate-limit enable                  启用速率限制
  owx rate-limit disable                 禁用速率限制
  owx rate-limit reset                   重置为默认值
  owx rate-limit preset <name>           使用预设配置

选项:
  set 命令选项:
    -c, --concurrency <1-10>    最大并发请求数
    -d, --delay <milliseconds>  请求间隔时间（毫秒）
  
  preset 预设名称:
    conservative    保守模式 (1 并发, 1000ms 间隔)
    moderate        适中模式 (2 并发, 500ms 间隔)
    aggressive      激进模式 (5 并发, 100ms 间隔)

示例:
  owx rate-limit set --concurrency 2 --delay 500
  owx rate-limit preset moderate
  export OMX_RATE_LIMIT_CONCURRENCY=2
`);
}

async function rateLimitCommand(args: string[]): Promise<void> {
  if (args.length === 0 || args[0] === 'help' || args[0] === '--help' || args[0] === '-h') {
    printHelp();
    return;
  }
  
  const subCommand = args[0];
  
  switch (subCommand) {
    case 'status': {
      const options = {
        env: args.includes('--env'),
      };
      await statusCommand(options);
      break;
    }
    
    case 'set': {
      const concurrencyIdx = args.indexOf('--concurrency');
      const shortCIdx = args.indexOf('-c');
      const delayIdx = args.indexOf('--delay');
      const shortDIdx = args.indexOf('-d');
      
      const options: { concurrency?: number; delay?: number } = {};
      
      if (concurrencyIdx !== -1 && args[concurrencyIdx + 1]) {
        options.concurrency = parseInt(args[concurrencyIdx + 1], 10);
      } else if (shortCIdx !== -1 && args[shortCIdx + 1]) {
        options.concurrency = parseInt(args[shortCIdx + 1], 10);
      }
      
      if (delayIdx !== -1 && args[delayIdx + 1]) {
        options.delay = parseInt(args[delayIdx + 1], 10);
      } else if (shortDIdx !== -1 && args[shortDIdx + 1]) {
        options.delay = parseInt(args[shortDIdx + 1], 10);
      }
      
      if (options.concurrency !== undefined && (options.concurrency < 1 || options.concurrency > 10)) {
        console.error('❌ 错误: 并发数必须在 1-10 之间');
        process.exit(1);
      }
      
      if (options.delay !== undefined && options.delay < 0) {
        console.error('❌ 错误: 延迟时间不能为负数');
        process.exit(1);
      }
      
      await setCommand(options);
      break;
    }
    
    case 'enable':
      await enableCommand();
      break;
    
    case 'disable':
      await disableCommand();
      break;
    
    case 'reset':
      await resetCommand();
      break;
    
    case 'preset': {
      const presetName = args[1];
      if (!presetName) {
        console.error('❌ 错误: 请指定预设名称');
        console.log('可用预设: conservative, moderate, aggressive');
        process.exit(1);
      }
      await presetCommand(presetName);
      break;
    }
    
    default:
      console.error(`❌ 未知命令: ${subCommand}`);
      printHelp();
      process.exit(1);
  }
}

export { rateLimitCommand };

// 如果直接运行此文件（而非通过 index.ts 导入）
const main = async () => {
  const { fileURLToPath } = await import('url');
  const { dirname } = await import('path');
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  
  // 检查是否直接运行
  const isMainModule = process.argv[1] === __filename;
  
  if (isMainModule) {
    rateLimitCommand(process.argv.slice(2)).catch((error) => {
      console.error('❌ 错误:', error.message);
      process.exit(1);
    });
  }
};

main();
