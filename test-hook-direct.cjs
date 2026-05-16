const { spawn } = require('child_process');
const testJson = JSON.stringify({
  hook_event_name: "UserPromptSubmit",
  prompt: "请帮我跑 npm install,然后告诉我安装了多少个包。",
  cwd: "d:\\code\\my\\oh-my-codex"
});
const utf8Bytes = Buffer.from(testJson, 'utf-8');
const base64 = utf8Bytes.toString('base64');

// 直接调用 Node.js hook，传入 Base64
const ps = spawn(process.execPath, ['d:\\code\\my\\oh-my-codex\\dist\\scripts\\codex-native-hook.js'], {
  stdio: ['pipe', 'pipe', 'pipe']
});
ps.stdin.write(base64 + '\n');
ps.stdin.end();

let out = '';
ps.stdout.on('data', d => out += d);
ps.on('close', code => {
  console.log('Exit:', code);
  if (out) {
    const parsed = JSON.parse(out.trim());
    console.log('Decision:', parsed.decision);
    console.log('HookEventName:', parsed.hookSpecificOutput?.hookEventName);
  } else {
    console.log('(no output - success)');
  }
});
