/**
 * 子代理 CLI 命令
 * 
 * 提供执行子代理的管理和执行功能
 * 
 * 用法:
 *   owx subagent status                  # 查看配置
 *   owx subagent execute --mode native -q "运行 ls"   # 原生模式执行
 *   owx subagent execute --mode subagent -q "运行 ls" # 子代理模式执行
 *   owx subagent clear-cache             # 清除缓存
 */

import {
  createExecutionSubagentFromEnv,
  createSubagentCacheFromEnv,
  isNativeMode,
  getModeDescription
} from '../subagents/index.js';
import chalk from 'chalk';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

/**
 * 从参数中解析 --mode 值
 */
function parseModeFromArgs(args: string[]): 'subagent' | 'native' | null {
  const modeIdx = args.indexOf('--mode');
  if (modeIdx !== -1 && args[modeIdx + 1]) {
    const mode = args[modeIdx + 1].toLowerCase();
    if (mode === 'subagent' || mode === 'native') {
      return mode;
    }
  }
  return null;
}

/**
 * 移除 --mode 参数,返回干净的参数列表
 */
function stripModeArgs(args: string[]): string[] {
  const result: string[] = [];
  let skipNext = false;
  for (let i = 0; i < args.length; i++) {
    if (skipNext) {
      skipNext = false;
      continue;
    }
    if (args[i] === '--mode') {
      skipNext = true;
      continue;
    }
    result.push(args[i]);
  }
  return result;
}

async function statusCommand(): Promise<void> {
  console.log(chalk.blue('🔧 Execution Subagent 配置'));
  console.log();

  // 运行模式
  const currentMode = process.env.OMX_SUBAGENT_MODE || 'native';
  console.log(chalk.cyan('运行模式:'));
  console.log(`   OMX_SUBAGENT_MODE: ${currentMode === 'subagent' ? '子代理模式 (DeepSeek) 🤖' : '原生模式 (本地执行) 🖥️'}`);
  console.log();

  // 环境变量
  console.log(chalk.cyan('环境变量:'));
  console.log(`   DEEPSEEK_API_KEY: ${process.env.DEEPSEEK_API_KEY ? '已设置 ✅' : '未设置 ❌'}`);
  console.log(`   OMX_SUBAGENT_MODEL: ${process.env.OMX_SUBAGENT_MODEL || 'deepseek-v4-flash (默认)'}`);
  console.log(`   OMX_SUBAGENT_THINKING_MODE: ${process.env.OMX_SUBAGENT_THINKING_MODE || 'smart (默认)'}`);
  console.log(`   OMX_SUBAGENT_MAX_TURNS: ${process.env.OMX_SUBAGENT_MAX_TURNS || '10 (默认)'}`);
  console.log(`   OMX_SUBAGENT_ENABLED: ${process.env.OMX_SUBAGENT_ENABLED || 'true (默认)'}`);
  console.log();

  // 速率限制
  console.log(chalk.cyan('速率限制:'));
  console.log(`   OMX_RATE_LIMIT_CONCURRENCY: ${process.env.OMX_RATE_LIMIT_CONCURRENCY || '3 (默认)'}`);
  console.log(`   OMX_RATE_LIMIT_DELAY_MS: ${process.env.OMX_RATE_LIMIT_DELAY_MS || '200 (默认)'}`);
  console.log(`   OMX_RATE_LIMIT_ENABLED: ${process.env.OMX_RATE_LIMIT_ENABLED || 'true (默认)'}`);
  console.log();

  // 缓存统计
  console.log(chalk.cyan('缓存统计:'));
  try {
    const cache = createSubagentCacheFromEnv();
    const stats = await cache.getStats();
    console.log(`   缓存条目: ${stats.totalEntries}`);
    console.log(`   缓存大小: ${(stats.totalSize / 1024).toFixed(2)} KB`);
    if (stats.oldestEntry) {
      console.log(`   最早缓存: ${stats.oldestEntry.toLocaleString()}`);
    }
    if (stats.newestEntry) {
      console.log(`   最新缓存: ${stats.newestEntry.toLocaleString()}`);
    }
  } catch {
    console.log('   缓存统计不可用');
  }
}

async function executeCommand(args: string[]): Promise<void> {
  // 解析 --mode 参数 (优先级高于环境变量)
  const modeFromArgs = parseModeFromArgs(args);
  const cleanArgs = stripModeArgs(args);
  
  // 解析其他参数
  const queryIdx = cleanArgs.indexOf('-q');
  const queryIdxLong = cleanArgs.indexOf('--query');
  const descIdx = cleanArgs.indexOf('-d');
  const descIdxLong = cleanArgs.indexOf('--description');
  const outputIdx = cleanArgs.indexOf('-o');
  const outputIdxLong = cleanArgs.indexOf('--output');
  
  if (queryIdx === -1 && queryIdxLong === -1) {
    console.error(chalk.red('❌ 错误: 必须指定 -q 或 --query'));
    process.exit(1);
  }
  
  const qIdx = queryIdx !== -1 ? queryIdx : queryIdxLong;
  const query = cleanArgs[qIdx + 1];
  
  if (!query) {
    console.error(chalk.red('❌ 错误: -q 需要参数'));
    process.exit(1);
  }
  
  const dIdx = descIdx !== -1 ? descIdx : descIdxLong;
  const description = dIdx !== -1 ? cleanArgs[dIdx + 1] : undefined;
  
  const oIdx = outputIdx !== -1 ? outputIdx : outputIdxLong;
  const outputFile = oIdx !== -1 ? cleanArgs[oIdx + 1] : undefined;

  // 确定最终模式: --mode 参数 > 环境变量 > 默认值(native)
  const finalMode = modeFromArgs || (process.env.OMX_SUBAGENT_MODE?.trim().toLowerCase() === 'subagent' ? 'subagent' : 'native');

  try {
    // 检查当前模式
    if (finalMode === 'native') {
      // 原生模式: 直接执行命令
      await executeNativeCommand(query, description, outputFile);
    } else {
      // 子代理模式: 使用 DeepSeek 执行
      await executeSubagentCommand(query, description, outputFile);
    }
  } catch (error: any) {
    console.error(chalk.red(' 执行失败:'));
    console.error(error.message);
    process.exit(1);
  }
}

/**
 * 原生模式执行
 */
async function executeNativeCommand(query: string, description?: string, outputFile?: string): Promise<void> {
  console.log(chalk.blue('🖥️  原生模式执行'));
  
  // 尝试从 query 中提取实际命令 (去除 "运行"、"执行" 等前缀)
  const command = extractCommandFromQuery(query);
  console.log(chalk.gray(`   命令: ${command}`));
  if (description) {
    console.log(chalk.gray(`   描述: ${description}`));
  }
  console.log(chalk.gray(`   模式: ${getModeDescription()}`));
  console.log();

  const startTime = Date.now();
  
  try {
    const { stdout, stderr } = await execAsync(command, {
      cwd: process.cwd(),
      maxBuffer: 10 * 1024 * 1024 // 10MB
    });
    
    const duration = Date.now() - startTime;
    
    // 如果指定了输出文件,写入文件
    if (outputFile) {
      const fs = await import('fs');
      const output = stdout || '';
      await fs.promises.writeFile(outputFile, output, 'utf-8');
      console.log(chalk.green(`✅ 结果已写入: ${outputFile}`));
    } else {
      // 否则显示到控制台
      if (stdout) {
        console.log(stdout);
      }
      if (stderr) {
        console.error(chalk.yellow(stderr));
      }
    }
    
    console.log();
    console.log(chalk.cyan(' 资源消耗:'));
    console.log(`   执行时间: ${duration}ms`);
    console.log(`   模式: 原生模式 🖥️`);
    console.log(`   缓存命中: 不适用`);
    
    process.exit(0);
  } catch (error: any) {
    const duration = Date.now() - startTime;
    
    console.error(chalk.red('❌ 命令执行失败'));
    console.error(error.message);
    if (error.stderr) {
      console.error(chalk.yellow(error.stderr));
    }
    
    // 如果有输出文件,写入错误信息
    if (outputFile) {
      const fs = await import('fs');
      const errorMessage = error.message + (error.stderr ? '\n' + error.stderr : '');
      await fs.promises.writeFile(outputFile, errorMessage, 'utf-8');
    }
    
    console.log();
    console.log(chalk.cyan('💰 资源消耗:'));
    console.log(`   执行时间: ${duration}ms`);
    console.log(`   模式: 原生模式 🖥️`);
    
    process.exit(1);
  }
}

/**
 * 从查询中提取实际命令
 * 去除 "运行"、"执行" 等中文前缀
 */
function extractCommandFromQuery(query: string): string {
  // 去除常见的中文前缀
  let command = query.trim();
  
  // 去除 "运行"、"执行"、"请运行"、"请执行" 等前缀
  command = command.replace(/^(?:请)?(?:运行|执行|帮我|帮我运行|帮我执行)\s*/i, '');
  
  // 如果还有 "命令" 字样,也去除
  command = command.replace(/\s*命令\s*$/i, '');
  
  return command.trim();
}

/**
 * 子代理模式执行 (带 deepseek: 前缀输出,失败时降级到原生模式)
 */
async function executeSubagentCommand(query: string, description?: string, outputFile?: string): Promise<void> {
  const subagent = createExecutionSubagentFromEnv();

  // 在控制台输出 deepseek: 标识
  console.log(chalk.cyan('deepseek:') + chalk.gray(' 执行子代理任务'));
  console.log(chalk.gray('deepseek:') + `   查询: ${query}`);
  if (description) {
    console.log(chalk.gray('deepseek:') + `   描述: ${description}`);
  }
  console.log(chalk.gray('deepseek:') + `   模式: ${getModeDescription()}`);
  console.log();

  try {
    const result = await subagent.execute({
      query,
      description
    });

    // 如果指定了输出文件,写入文件
    if (outputFile) {
      const fs = await import('fs');
      const output = result.finalAnswer || '';
      await fs.promises.writeFile(outputFile, output, 'utf-8');
      console.log(chalk.green(`deepseek:`) + chalk.green(` ✅ 结果已写入: ${outputFile}`));
    } else {
      // 否则显示到控制台 (不添加 deepseek: 前缀,保持干净的上下文)
      console.log(chalk.green('📊 执行结果:'));
      console.log(result.finalAnswer);
      console.log();

      // 显示统计
      console.log(chalk.cyan('💰 资源消耗:'));
      console.log(`   Token 消耗: ${result.tokensUsed.toLocaleString()}`);
      console.log(`   执行命令数: ${result.commands.length}`);
      console.log(`   缓存命中: ${result.fromCache ? '是 ✅' : '否 ❌'}`);
      console.log(`   思考模式: ${result.thinkingEnabled ? '启用 ✅' : '未启用 ❌'}`);
      console.log();

      // 显示命令详情
      if (result.commands.length > 0) {
        console.log(chalk.cyan('📝 命令执行详情:'));
        result.commands.forEach((cmd, index) => {
          const status = cmd.exitCode === 0 ? chalk.green('✓') : chalk.red('');
          console.log(`   ${index + 1}. ${status} ${cmd.command}`);
          console.log(`      退出码: ${cmd.exitCode}`);
          console.log(`      摘要: ${cmd.summary}`);
          if (cmd.error) {
            console.log(`      错误: ${cmd.error}`);
          }
        });
      }
    }

    // 退出码
    process.exit(result.status === 'success' ? 0 : 1);
  } catch (error: any) {
    // DeepSeek 执行失败,降级到原生模式
    console.log(chalk.red('deepseek:') + chalk.red(' ❌ DeepSeek 执行失败'));
    console.log(chalk.red('deepseek:') + chalk.red(`   错误: ${error.message}`));
    console.log();
    console.log(chalk.yellow('⚠️  降级到原生模式执行...'));
    console.log();
    
    // 调用原生模式执行 (传递 outputFile)
    await executeNativeCommand(query, description, outputFile);
  }
}

async function setModeCommand(mode: string): Promise<void> {
  if (mode !== 'subagent' && mode !== 'native') {
    console.error(chalk.red('❌ 错误: 模式必须是 "subagent" 或 "native"'));
    console.log(chalk.gray('   用法: owx subagent mode <subagent|native>'));
    process.exit(1);
  }

  console.log(chalk.blue('🔄 切换子代理模式'));
  console.log();
  
  if (mode === 'subagent') {
    console.log(chalk.green('✅ 已切换到: 子代理模式 (DeepSeek)'));
    console.log(chalk.gray('   - 使用 DeepSeek V4 Flash 执行终端任务'));
    console.log(chalk.gray('   - 节省主代理 token 消耗'));
    console.log(chalk.gray('   - 支持智能思考和缓存'));
  } else {
    console.log(chalk.yellow('⚠️  已切换到: 原生模式 (本地执行)'));
    console.log(chalk.gray('   - 使用本地 shell 直接执行命令'));
    console.log(chalk.gray('   - 不经过 DeepSeek 子代理'));
    console.log(chalk.gray('   - 主代理 token 消耗较高'));
  }
  console.log();
  console.log(chalk.cyan('💡 提示:'));
  console.log(chalk.gray('   设置环境变量: export OMX_SUBAGENT_MODE=' + mode));
  console.log(chalk.gray('   或在 Windows PowerShell: $env:OMX_SUBAGENT_MODE="' + mode + '"'));
}

async function clearCacheCommand(): Promise<void> {
  try {
    const cache = createSubagentCacheFromEnv();
    const count = await cache.clear();
    console.log(chalk.green(`✅ 已清除 ${count} 个缓存条目`));
  } catch (error: any) {
    console.error(chalk.red('❌ 清除缓存失败:'), error.message);
    process.exit(1);
  }
}

async function pruneCacheCommand(): Promise<void> {
  try {
    const cache = createSubagentCacheFromEnv();
    const count = await cache.prune();
    console.log(chalk.green(`✅ 已清除 ${count} 个过期缓存条目`));
  } catch (error: any) {
    console.error(chalk.red('❌ 清除过期缓存失败:'), error.message);
    process.exit(1);
  }
}

function printHelp(): void {
  console.log(`
用法: owx subagent <command>

命令:
  status              查看子代理配置和缓存统计
  mode <mode>         切换运行模式 (subagent|native)
  execute [options]   执行终端任务
  clear-cache         清除所有缓存
  prune-cache         清除过期缓存
  help                显示此帮助信息

execute 选项:
  -q, --query <text>       执行查询 (必填)
  -d, --description <text> 任务描述 (可选)
  --mode <mode>            运行模式: subagent|native (覆盖环境变量)

示例:
  owx subagent status
  owx subagent mode subagent     # 切换到子代理模式 (DeepSeek)
  owx subagent mode native       # 切换到原生模式 (本地执行)
  owx subagent execute -q "运行构建和测试"
  owx subagent execute --mode native -q "运行 ls -la"    # 临时使用原生模式
  owx subagent execute --mode subagent -q "运行 npm test" # 临时使用子代理模式
  owx subagent execute -q "运行 npm test" -d "运行测试"
  owx subagent clear-cache
`);
}

export async function subagentCommand(args: string[]): Promise<void> {
  const subCommand = args[0] || 'help';
  
  switch (subCommand) {
    case 'status':
      await statusCommand();
      break;
    case 'mode':
      await setModeCommand(args[1] || '');
      break;
    case 'execute':
      await executeCommand(args.slice(1));
      break;
    case 'clear-cache':
      await clearCacheCommand();
      break;
    case 'prune-cache':
      await pruneCacheCommand();
      break;
    case 'help':
    case '--help':
    case '-h':
      printHelp();
      break;
    default:
      console.error(`❌ 未知命令: ${subCommand}`);
      printHelp();
      process.exit(1);
  }
}
