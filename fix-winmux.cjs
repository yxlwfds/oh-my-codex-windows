const fs = require('fs');

function fixWinmuxCli() {
  let content = fs.readFileSync('src/winmux/client/cli.ts', 'utf8');
  content = content.replace(/if \(existsSync\(lock\)\) \{\n\s*try \{\n\s*lockInfo = JSON\.parse\(readFileSync\(lock, "utf-8"\)\);\n\s*\} catch \{\n\s*lockInfo = null;\n\s*\}\n\s*\} else \{/g,
    `try { lockInfo = JSON.parse(readFileSync(lock, "utf-8")); } catch { lockInfo = null; }\n      if (!lockInfo) {`);
  fs.writeFileSync('src/winmux/client/cli.ts', content);
}

function fixWinmuxDaemon() {
  let content = fs.readFileSync('src/winmux/daemon/index.ts', 'utf8');
  content = content.replace(/if \(existsSync\(lockfile\)\) \{\n\s*let owner: \{ pid\?: number \} = \{\};\n\s*try \{\n\s*owner = JSON\.parse\(readFileSync\(lockfile, "utf-8"\)\) as \{ pid\?: number \};/g,
    `let owner: { pid?: number } = {};\n  try {\n    owner = JSON.parse(readFileSync(lockfile, "utf-8")) as { pid?: number };`);
  // also need to remove the closing bracket of `if (existsSync)`
  // Wait, replacing `if (existsSync) { ...` means we remove the condition, but we leave the closing brace.
  // Actually, I can just replace the whole thing.
  let target = `  if (existsSync(lockfile)) {
    let owner: { pid?: number } = {};
    try {
      owner = JSON.parse(readFileSync(lockfile, "utf-8")) as { pid?: number };
    } catch {
      // malformed lockfile
    }
    if (owner.pid) {
      const running = await isProcessRunning(owner.pid);
      if (running) {
        throw new Error(\`Winmux daemon already running (pid \${owner.pid})\`);
      }
    }
  }`;
  let replacement = `  let owner: { pid?: number } = {};
  try {
    owner = JSON.parse(readFileSync(lockfile, "utf-8")) as { pid?: number };
  } catch {
    // malformed lockfile or ENOENT
  }
  if (owner.pid) {
    const running = await isProcessRunning(owner.pid);
    if (running) {
      throw new Error(\`Winmux daemon already running (pid \${owner.pid})\`);
    }
  }`;
  content = content.replace(target, replacement);
  fs.writeFileSync('src/winmux/daemon/index.ts', content);
}

function fixWinmuxEnsure() {
  let content = fs.readFileSync('src/winmux/client/ensure-daemon.ts', 'utf8');
  let target = `  if (!existsSync(path)) return null;
  try {
    const raw = readFileSync(path, "utf-8").trim();`;
  let replacement = `  try {
    const raw = readFileSync(path, "utf-8").trim();`;
  content = content.replace(target, replacement);
  fs.writeFileSync('src/winmux/client/ensure-daemon.ts', content);
}

fixWinmuxCli();
fixWinmuxDaemon();
fixWinmuxEnsure();
console.log('Fixed winmux files');
