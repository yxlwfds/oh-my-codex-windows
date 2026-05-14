const fs = require('fs');

function fixStorage() {
  let content = fs.readFileSync('src/wiki/storage.ts', 'utf8');
  content = content.replace(/return existsSync\(indexPath\) \? readFileSync\(indexPath, 'utf8'\) : null;/g,
    "try { return readFileSync(indexPath, 'utf8'); } catch (e: any) { if (e.code === 'ENOENT') return null; throw e; }");
  
  content = content.replace(/return existsSync\(logPath\) \? readFileSync\(logPath, 'utf8'\) : null;/g,
    "try { return readFileSync(logPath, 'utf8'); } catch (e: any) { if (e.code === 'ENOENT') return null; throw e; }");
  
  content = content.replace(/const existing = existsSync\(logPath\) \? readFileSync\(logPath, 'utf8'\) : '# Wiki Log\\n\\n';/g,
    "let existing = '# Wiki Log\\n\\n';\n  try { existing = readFileSync(logPath, 'utf8'); } catch (e: any) { if (e.code !== 'ENOENT') throw e; }");
  
  fs.writeFileSync('src/wiki/storage.ts', content);
}

function fixLifecycle() {
  let content = fs.readFileSync('src/wiki/lifecycle.ts', 'utf8');
  content = content.replace(/if \(!existsSync\(path\)\) continue;\n\s*const parsed = JSON.parse\(readFileSync\(path, 'utf8'\)\)/g,
    "let raw = ''; try { raw = readFileSync(path, 'utf8'); } catch (e: any) { if (e.code === 'ENOENT') continue; throw e; }\n      const parsed = JSON.parse(raw)");
    
  content = content.replace(/if \(!projectMemoryPath \|\| !existsSync\(projectMemoryPath\)\) return;\n\n\s*const parsed = JSON.parse\(readFileSync\(projectMemoryPath, 'utf8'\)\) as Record<string, unknown>;/g,
    "if (!projectMemoryPath) return;\n    let parsed: Record<string, unknown>;\n    try {\n      parsed = JSON.parse(readFileSync(projectMemoryPath, 'utf8')) as Record<string, unknown>;\n    } catch (e: any) {\n      if (e.code === 'ENOENT') return;\n      throw e;\n    }");
    
  fs.writeFileSync('src/wiki/lifecycle.ts', content);
}

function fixBootstrap() {
  let content = fs.readFileSync('src/team/worker-bootstrap.ts', 'utf8');
  content = content.replace(/const existing = existsSync\(excludePath\)\n\s*\? await readFile\(excludePath, "utf-8"\)\n\s*: "";/g,
    "let existing = \"\";\n  try { existing = await readFile(excludePath, \"utf-8\"); } catch (e: any) { if (e.code !== 'ENOENT') throw e; }");
    
  content = content.replace(/const existed = existsSync\(agentsPath\);\n\s*const previousContent = existed\n\s*\? await readFile\(agentsPath, "utf-8"\)\n\s*: undefined;/g,
    "let existed = false;\n  let previousContent;\n  try { previousContent = await readFile(agentsPath, \"utf-8\"); existed = true; } catch (e: any) { if (e.code !== 'ENOENT') throw e; }");
  fs.writeFileSync('src/team/worker-bootstrap.ts', content);
}

fixStorage();
fixLifecycle();
fixBootstrap();
console.log('Fixed some files');
