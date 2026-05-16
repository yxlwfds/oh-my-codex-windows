const testJson = JSON.stringify({
  hook_event_name: "UserPromptSubmit",
  prompt: "请帮我跑 npm install,然后告诉我安装了多少个包。",
  cwd: "d:\\code\\my\\oh-my-codex"
});
const utf8Bytes = Buffer.from(testJson, 'utf-8');
const base64 = utf8Bytes.toString('base64');
console.log('Base64 length:', base64.length);
console.log('Base64:', base64.substring(0, 50) + '...');
const decoded = Buffer.from(base64, 'base64').toString('utf-8');
console.log('Decoded matches:', decoded === testJson);
JSON.parse(decoded);
console.log('JSON.parse: OK');
