#!/usr/bin/env node
// verify-hook-integrity.js
// 快速检查 shim 和 dist 是否包含关键修补代码
// 用法: node scripts/verify-hook-integrity.js

const fs = require("fs");
const path = require("path");
const os = require("os");

const SHIM_PATH = path.join(os.homedir(), ".codex", "hooks", "omx-native-hook-windows-shim.ps1");
const DIST_PATH = path.join(__dirname, "..", "dist", "scripts", "codex-native-hook.js");

const checks = [
  {
    label: "Shim — OpenStandardInput 原始字节读取",
    path: SHIM_PATH,
    grep: "OpenStandardInput",
  },
  {
    label: "Shim — ToBase64String 编码",
    path: SHIM_PATH,
    grep: "ToBase64String",
  },
  {
    label: "Dist — Base64 → ASCII 解码",
    path: DIST_PATH,
    grep: 'toString("ascii")',
  },
  {
    label: "Dist — Buffer.from(base64) 解码",
    path: DIST_PATH,
    grep: 'Buffer.from(base64Data, "base64")',
  },
];

let allOk = true;
for (const { label, path: filePath, grep } of checks) {
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    if (content.includes(grep)) {
      console.log(`  ✅ ${label}`);
    } else {
      console.log(`  ❌ ${label} — 缺少: ${grep}`);
      allOk = false;
    }
  } catch (e) {
    console.log(`  ❌ ${label} — 文件不存在: ${filePath}`);
    allOk = false;
  }
}

if (allOk) {
  console.log("\n🎉 所有关键修补代码已到位！");
  process.exit(0);
} else {
  console.log("\n⚠️  缺少必要修补代码，请运行: npm run build:deploy");
  process.exit(1);
}
