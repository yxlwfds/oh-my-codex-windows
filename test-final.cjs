const { spawn } = require('child_process');
const { WriteAllText } = require('fs');

const testJson = JSON.stringify({
  hook_event_name: "UserPromptSubmit",
  prompt: "请帮我跑 npm install,然后告诉我安装了多少个包。",
  cwd: "d:\\code\\my\\oh-my-codex"
});

console.log("Input JSON:", testJson.substring(0, 80) + "...");
console.log("Input length:", testJson.length);

const ps = spawn('powershell.exe', [
  '-NoProfile', '-ExecutionPolicy', 'Bypass',
  '-File', 'C:\\Users\\yuhua\\.codex\\hooks\\omx-native-hook-windows-shim.ps1'
], {
  stdio: ['pipe', 'pipe', 'pipe'],
  env: { ...process.env, PATH: process.env.PATH }
});

// 传入原始 JSON（shim 读取后 Base64 编码传给 hook）
ps.stdin.write(testJson);
ps.stdin.end();

let out = '';
let err = '';
ps.stdout.on('data', d => { process.stdout.write('.'); out += d });
ps.stderr.on('data', d => err += d);
ps.on('close', code => {
  console.log('\nExit:', code);
  console.log('Output:', out.trim().substring(0, 300));
  if (err) console.log('Stderr:', err.trim().substring(0, 300));
});
