const { spawn } = require('child_process');

const testJson = JSON.stringify({
  hook_event_name: "UserPromptSubmit",
  prompt: "请帮我跑 npm install,然后告诉我安装了多少个包。",
  cwd: "d:\\code\\my\\oh-my-codex"
});

// Base64 编码后写入 stdin（模拟 PowerShell shim 的行为）
const utf8Bytes = Buffer.from(testJson, 'utf-8');
const base64 = utf8Bytes.toString('base64');

const ps = spawn('powershell.exe', [
  '-NoProfile', '-ExecutionPolicy', 'Bypass',
  '-File', 'C:\\Users\\yuhua\\.codex\\hooks\\omx-native-hook-windows-shim.ps1'
], { stdio: ['pipe', 'pipe', 'pipe'] });

ps.stdin.write(testJson); // 传入原始 JSON（shim 会将其 Base64 编码）
ps.stdin.end();

let out = '';
ps.stdout.on('data', d => out += d);
ps.on('close', code => {
  console.log('Exit:', code);
  console.log('Output preview:', out.trim().substring(0, 200));
});
