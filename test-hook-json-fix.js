#!/usr/bin/env node

/**
 * 测试 Hook JSON 输出修复
 * 模拟 SessionStart 和 UserPromptSubmit 事件
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import { join } from 'path';
import { writeFileSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';

const execAsync = promisify(exec);

async function testHookOutput(eventName, payload) {
  const testDir = join(tmpdir(), `omx-hook-test-${Date.now()}`);
  mkdirSync(join(testDir, '.omx', 'state'), { recursive: true });
  
  // 创建基本的 session.json
  writeFileSync(
    join(testDir, '.omx', 'state', 'session.json'),
    JSON.stringify({
      session_id: `test-session-${Date.now()}`,
      started_at: new Date().toISOString()
    })
  );

  const hookScript = join(process.cwd(), 'dist', 'scripts', 'codex-native-hook.js');
  const testPayload = {
    hook_event_name: eventName,
    cwd: testDir,
    session_id: `test-session-${Date.now()}`,
    thread_id: 'test-thread',
    turn_id: 'test-turn',
    ...payload
  };

  console.log(`\n=== Testing ${eventName} ===`);
  console.log('Payload:', JSON.stringify(testPayload, null, 2));

  try {
    // 直接使用 Node.js 运行 hook 脚本
    const { stdout, stderr } = await execAsync(`node "${hookScript}"`, {
      input: JSON.stringify(testPayload),
      cwd: process.cwd()
    });

    console.log('STDOUT:', stdout.trim());
    console.log('STDERR:', stderr.trim());
    
    // 验证 JSON 有效性
    try {
      const parsed = JSON.parse(stdout.trim());
      console.log('✅ Valid JSON output');
      return true;
    } catch (e) {
      console.log('❌ Invalid JSON output:', e.message);
      return false;
    }
  } catch (error) {
    console.log('❌ Hook execution failed:', error.message);
    return false;
  }
}

async function main() {
  console.log('Testing OMX Hook JSON Output Fix');
  console.log('================================');

  // 测试 SessionStart
  const sessionStartResult = await testHookOutput('SessionStart', {
    source: 'startup',
    transcript_path: ''
  });

  // 测试 UserPromptSubmit
  const userPromptSubmitResult = await testHookOutput('UserPromptSubmit', {
    prompt: 'test prompt with special characters: <>&"\'',
    user_prompt: 'test user prompt'
  });

  // 测试带有复杂内容的 UserPromptSubmit
  const complexPromptResult = await testHookOutput('UserPromptSubmit', {
    prompt: '请帮我实现一个功能，包含以下要求：\n1. 支持中文\n2. 处理特殊字符 <>&"\'\n3. 返回 JSON 格式',
    user_prompt: 'complex test prompt'
  });

  console.log('\n=== Summary ===');
  console.log(`SessionStart: ${sessionStartResult ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`UserPromptSubmit: ${userPromptSubmitResult ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`Complex Prompt: ${complexPromptResult ? '✅ PASS' : '❌ FAIL'}`);

  const allPassed = sessionStartResult && userPromptSubmitResult && complexPromptResult;
  console.log(`\nOverall: ${allPassed ? '✅ ALL TESTS PASSED' : '❌ SOME TESTS FAILED'}`);
  
  process.exit(allPassed ? 0 : 1);
}

main().catch(console.error);
