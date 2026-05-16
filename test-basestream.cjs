const { spawn } = require('child_process');

const json = JSON.stringify({
  hook_event_name: "UserPromptSubmit",
  prompt: "请帮我跑 npm install,然后告诉我安装了多少个包。",
  cwd: "d:\\code\\my\\oh-my-codex"
});

const ps = spawn('powershell.exe', [
  '-NoProfile', '-ExecutionPolicy', 'Bypass',
  '-File', 'C:\\Users\\yuhua\\.codex\\hooks\\omx-native-hook-windows-shim.ps1'
], { stdio: ['pipe', 'pipe', 'pipe'] });

ps.stdin.write(json);
ps.stdin.end();

let out = '';
let err = '';
ps.stdout.on('data', d => out += d);
ps.stderr.on('data', d => err += d);
ps.on('close', code => {
  console.log('Exit:', code);
  console.log('Stdout:', out.trim().substring(0, 300));
  if (err) console.log('Stderr:', err.trim().substring(0, 300));
});
