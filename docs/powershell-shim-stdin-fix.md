# PowerShell Shim stdin 编码问题修复记录

## 目录

1. [根因分析](#1-根因分析)
2. [修复方案：Base64 封装 + OpenStandardInput](#2-修复方案base64-封装--openstandardinput)
3. [一键重编译与部署](#3-一键重编译与部署)
4. [验证方法](#4-验证方法)
5. [技术细节与备选方案对比](#5-技术细节与备选方案对比)
6. [相关文件与日志](#6-相关文件与日志)

---

## 1. 根因分析

### 1.1 问题现象

每次对话出现多个 hook 错误（SessionStart、UserPromptSubmit、PreToolUse、PostToolUse 等）：

```
hook returned invalid ... JSON output
hook exited with code 1
```

错误 JSON 内容为乱码 `?` 字符，表现为 `"Unexpected token '?'"`，原因是 Windows Console 编码被其他进程（如 Semble MCP）全局切换为 GBK (936)，导致 UTF-8 数据损坏。

### 1.2 调用链路

```
Codex CLI → [stdin] → PowerShell shim → [stdin] → Node.js hook → [stdout] → PowerSHell → [stdout] → Codex CLI
```

### 1.3 根因一：`[Console]::In.ReadToEnd()` 损坏 UTF-8

PowerShell 的 `[Console]::In` 读取的是 **Console 输入缓冲区**，而非真正的 **stdin 文件描述符**。当 PowerShell 作为子进程通过管道接收数据时，`Console.In` 内部的编码层会重新解释多字节 UTF-8 字符，导致中文字符损坏。

**数据对比：**

| 阶段 | 字节数 | 状态 |
|------|--------|------|
| 原始输入 | 114 | ✅ |
| `Console.In.ReadToEnd()` 读取后 | 122 | ❌ 多出 8 字节（中文损坏） |
| 结束引号 `"` 被吃掉 | — | ❌ JSON 格式损坏 |

**修复：** 改用 `[Console]::OpenStandardInput()` 直接从底层文件描述符读取原始字节流，然后手动以 UTF-8 解码。

```powershell
# ❌ 坏的（Console 输入缓冲区，管道下编码损坏）
$stdinPayload = [Console]::In.ReadToEnd()

# ✅ 好的（原始字节流，手动 UTF-8 解码）
$stdinStream = [Console]::OpenStandardInput()
$memStream = New-Object System.IO.MemoryStream
$buffer = New-Object byte[] 65536
while (($read = $stdinStream.Read($buffer, 0, $buffer.Length)) -gt 0) {
  $memStream.Write($buffer, 0, $read)
}
$stdinPayload = [System.Text.Encoding]::UTF8.GetString($memStream.ToArray())
```

### 1.4 根因二：`StandardInput.Write(string)` 多字节截断

即使 PowerSHell shim 正确读取了 JSON，在将其传递给 Node.js 子进程时，`$process.StandardInput.Write($stdinPayload)` 方法在遇到多字节 UTF-8 字符时可能截断数据。

**修复：** 先转换为 Base64（纯 ASCII），再通过 `WriteLine()` 传递。

```powershell
$utf8Bytes = [System.Text.Encoding]::UTF8.GetBytes($stdinPayload)
$base64Payload = [Convert]::ToBase64String($utf8Bytes)
$process.StandardInput.WriteLine($base64Payload)  # 纯 ASCII，零风险
```

### 1.5 根因三：增量编译跳过独立文件

TypeScript 的 `tsc`（无 `--watch` 模式）在某些场景下会跳过未被间接依赖引用的独立文件（如 `codex-native-hook.ts`）。此前虽然源码包含 Base64 解码代码，但 `dist/scripts/codex-native-hook.js` 缺少相应代码。

**修复：** 删除 `dist` 目录后全量编译（`rm -rf dist && tsc`）。

### 1.6 根因四：Windows Console 编码全局共享

Windows 的 `Console.OutputEncoding` 和 `Console.InputEncoding` 是**全局进程共享**的。当 Semble MCP 等工具启动时，会将 Console 编码从 UTF-8 (65001) 切换为系统默认 GBK (936)，导致：
- PowerShell shim 通过 `[Console]::Out.Write()` 输出的 UTF-8 JSON 被重新编码为 GBK，中文和特殊字符变成 `?`
- 即使正确接收了 stdin，输出阶段仍然会损坏

**修复：** 使用 `[Console]::OpenStandardOutput().Write()` 直接写原始 UTF-8 字节，完全绕过 `Console.OutputEncoding`。同时设置 `ProcessStartInfo.Standard*Encoding` 确保子进程的管道编码不受 Console 影响。

### 1.7 根因五：PowerShell 5.1 vs 7.x 双路径复杂度

最初为了兼容 `powershell.exe` (5.1) 和 `pwsh.exe` (7.x)，shim 包含条件判断（`$siHasEncoding`）和 BaseStream 回退路径。这导致：
- shim 文件写入时换行符丢失，所有代码挤在一行
- `#` 注释吃掉后续所有代码
- 维护两套代码路径容易出错

**决策：** 仅支持 pwsh 7.x（命令已使用 `pwsh`），移除所有 5.1 兼容代码。pwsh 7 基于 .NET Core，`StandardInputEncoding` 等属性始终可用。

---

## 2. 修复方案：Base64 封装 + OpenStandardInput

### 2.1 架构总览

```
                            Base64 编码                          Base64 解码
  JSON ──→ OpenStandardInput ──→ UTF-8 bytes ──→ ToBase64String ──→ WriteLine ──→ Read stdin ──→ Buffer.from(ascii, "base64") ──→ JSON.parse
  (stdin)     (原始字节流)          (bytes)          (ASCII string)     (pipe)      (stream)      (UTF-8 string)                (object)
```

### 2.2 PowerShell Shim 端

位于 `C:\Users\<user>\.codex\hooks\omx-native-hook-windows-shim.ps1`

**核心策略：pwsh 7.x only，全程原始字节流，不依赖 Console 编码。**

```powershell
$ErrorActionPreference = 'Stop'

# 0. 定义原始字节输出函数（绕过 Console.OutputEncoding）
function WriteStdoutRaw { param([string]$s)
  $b=[System.Text.Encoding]::UTF8.GetBytes($s)
  [Console]::OpenStandardOutput().Write($b,0,$b.Length)
}
function WriteStderrRaw { param([string]$s)
  $b=[System.Text.Encoding]::UTF8.GetBytes($s)
  [Console]::OpenStandardError().Write($b,0,$b.Length)
}

# 1. 从 StandardInput 读取原始字节（绕过 Console.InputEncoding）
$stdinStream = [Console]::OpenStandardInput()
$memStream = New-Object System.IO.MemoryStream
$buffer = New-Object byte[] 65536
while (($read = $stdinStream.Read($buffer, 0, $buffer.Length)) -gt 0) {
  $memStream.Write($buffer, 0, $read)
}
$stdinPayload = [System.Text.Encoding]::UTF8.GetString($memStream.ToArray())

# 2. 配置 ProcessStartInfo 编码（pwsh 7.x 始终支持）
$utf8NoBom = New-Object System.Text.UTF8Encoding $false
$startInfo.StandardInputEncoding = $utf8NoBom
$startInfo.StandardOutputEncoding = $utf8NoBom
$startInfo.StandardErrorEncoding = $utf8NoBom

# 3. Base64 编码后传给子进程（纯 ASCII，零风险）
$utf8Bytes = [System.Text.Encoding]::UTF8.GetBytes($stdinPayload)
$base64Payload = [Convert]::ToBase64String($utf8Bytes)
$stdoutTask = $process.StandardOutput.ReadToEndAsync()
$stderrTask = $process.StandardError.ReadToEndAsync()
$process.StandardInput.WriteLine($base64Payload)
$process.StandardInput.Close()
$process.WaitForExit()

# 4. 用原始字节输出（不受 Console.OutputEncoding 影响）
WriteStdoutRaw $stdoutTask.Result
if ($stderrTask.Result) { WriteStderrRaw $stderrTask.Result }
exit $process.ExitCode
```

### 2.3 Node.js Hook 端

位于 `dist/scripts/codex-native-hook.js`（源文件：`src/scripts/codex-native-hook.ts`）

```javascript
// 读取 stdin 中的 Base64 数据
const chunks = [];
for await (const chunk of process.stdin) {
  chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
}
if (chunks.length > 0) {
  const base64Data = Buffer.concat(chunks).toString("ascii").trim();
  if (base64Data) {
    try {
      // Base64 → UTF-8 → JSON
      raw = Buffer.from(base64Data, "base64").toString("utf-8").trim();
    } catch {
      // 解码失败时回退到原始数据
      raw = base64Data;
    }
  }
}
```

---

## 3. 一键重编译与部署

### 3.1 前置条件

- Node.js ≥ 20
- 项目已安装依赖（`npm install`）
- PowerShell 7+

### 3.2 使用 `build:deploy`

```bash
npm run build:deploy
```

自动执行：

| 步骤 | 命令 | 说明 |
|------|------|------|
| 1 | `rm -rf dist && tsc` | 全量清理 + TypeScript 强制重新编译 |
| 2 | `owx setup --force` | 部署最新 shim 到 `~/.codex/hooks/` |
| 3 | `verify-hook-integrity.cjs` | 自动验证 shim + dist 关键代码 |

### 3.3 手动步骤（备用）

如果 `build:deploy` 失败，可逐步执行：

```bash
# 1. 全量重新编译
npm run build

# 2. 部署 hook
npx owx setup --force

# 3. 验证完整性
node scripts/verify-hook-integrity.cjs

# 4. 完全退出并重启 Codex
```

### 3.4 注意事项

- **必须完全退出 Codex / owx**（关闭所有窗口/进程），然后重新启动
- owx sandbox 环境会自动从项目 `.codex/hooks/` 同步 shim，重启即可生效
- 如果 `tsc` 仍有增量编译缓存，可手动删除 `dist` 目录：`rm -rf dist`
- 验证脚本通过后，shim 文件应包含 `OpenStandardInput`、`ToBase64String`、`WriteStdoutRaw`、`StandardInputEncoding = $utf8NoBom`，且不应包含 `$siHasEncoding`；dist 应包含 `Buffer.from(base64Data, "base64")`

---

## 4. 验证方法

### 4.1 自动验证

```bash
node scripts/verify-hook-integrity.cjs
```

输出示例（8 项检查）：

```
  ✅ Shim — OpenStandardInput 原始字节读取
  ✅ Shim — ToBase64String 编码
  ✅ Shim — pwsh 7.x 直接设置 Standard*Encoding (无条件)
  ✅ Shim — WriteStdoutRaw 原始字节输出 (绕过Console编码)
  ✅ Shim — 无 $siHasEncoding 旧版兼容 (pwsh 7.x only)
  ✅ Shim — OpenStandardOutput 绕过编码写stdout
  ✅ Dist — Base64 → ASCII 解码
  ✅ Dist — Buffer.from(base64) 解码

🎉 所有关键修补代码已到位！
```

### 4.2 手动验证

```powershell
# 检查 shim 文件
Get-Content $env:USERPROFILE\.codex\hooks\omx-native-hook-windows-shim.ps1 | Select-String "OpenStandardInput|ToBase64String"

# 检查 dist
Select-String -Path "dist\scripts\codex-native-hook.js" -Pattern "Buffer.from.*base64|toString.*ascii"
```

### 4.3 日志验证

hook 调试日志位于项目的 `.omx/logs/` 目录：

| 日志文件 | 说明 |
|----------|------|
| `native-hook-shim-debug-*.jsonl` | PowerShell shim 接收到的 stdin 数据 |
| `native-hook-stdin-*.jsonl` | Node.js hook 解码后的数据 |
| `native-hook-parse-error-*.jsonl` | JSON 解析错误的完整原始内容 |

验证要点：
- shim debug 日志的长度 (`length`) 应等于输入的 JSON 长度（中文不会膨胀）
- stdin 日志的 `length` 应与 shim 一致
- 不应出现 `native-hook-parse-error-*.jsonl` 文件

---

## 5. 技术细节与备选方案对比

### 5.1 四种方案对比

| 方案 | 复杂度 | 可靠性 | 性能 | 清理 | 大小限制 |
|------|--------|--------|------|------|----------|
| **Base64 + OpenStandardInput + OpenStandardOutput** ⭐ | 低 | 最高 | 好 | 无 | 无 |
| 临时文件 + 环境变量 | 中 | 高 | 一般 | 需要 | 无 |
| `BaseStream.Write` 原始字节 | 低 | 中 | 最好 | 无 | 无 |
| Console.Out + OutputEncoding 设置 | 低 | 低 | 最好 | 无 | 无 |

### 5.2 当前方案的 Why

1. **Base64 只包含安全 ASCII 字符**（`A-Za-z0-9+/=`），完全免疫所有管道编码、多字节截断和不可见字符问题
2. **`OpenStandardInput()` 直接从文件描述符读取原始字节**，绕过 `Console.In` 的文本编码层
3. **`OpenStandardOutput().Write()` 直接写原始字节**，绕过 `Console.OutputEncoding`（会被 Semble MCP 等工具全局切换为 GBK）
4. **`ProcessStartInfo.Standard*Encoding` 设置为 UTF-8 no-BOM**，确保子进程管道不受系统编码影响
5. **仅支持 pwsh 7.x**（命令已使用 `pwsh`），无需兼容 `powershell.exe` (5.1) 的缺失属性
6. 这是跨语言、跨平台 CLI 开发中的**标准做法**（如 SSH 密钥交换、Docker 镜像层传输等）

### 5.3 备选方案说明

**临时文件方案**（上一版修复）：
```powershell
$tempInputFile = [System.IO.Path]::GetTempFileName()
[System.IO.File]::WriteAllText($tempInputFile, $stdinPayload, [System.Text.Encoding]::UTF8)
$env:OMX_NATIVE_HOOK_INPUT_FILE = $tempInputFile
```
- 优点：没有管道编码问题
- 缺点：磁盘 I/O 开销、需要 finally 清理临时文件、环境变量有大小限制（32KB）

**BaseStream 方案**（已弃用）：
```powershell
$utf8Bytes = [System.Text.Encoding]::UTF8.GetBytes($stdinPayload)
$process.StandardInput.BaseStream.Write($utf8Bytes, 0, $utf8Bytes.Length)
```
- 优点：无额外开销
- 缺点：仅在 `powershell.exe` 5.1 中作为 `StandardInputEncoding` 不可用时的回退方案；pwsh 7.x 不需要

**Console.Out + OutputEncoding 方案**（已弃用）：
```powershell
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::Out.Write($result)
```
- 优点：代码简单
- 缺点：`Console.OutputEncoding` 是全局共享的，会被其他进程（如 Semble MCP）随时覆盖为 GBK

---

## 6. 相关文件与日志

### 6.1 源代码

| 文件 | 说明 |
|------|------|
| `src/config/codex-hooks.ts` | PowerShell shim 生成代码（核心修复位置） |
| `src/scripts/codex-native-hook.ts` | Node.js hook 源代码（Base64 解码逻辑） |
| `package.json` | `build:deploy` npm 脚本入口 |
| `scripts/verify-hook-integrity.cjs` | 完整性验证脚本 |

### 6.2 运行时文件

| 文件 | 说明 |
|------|------|
| `C:\Users\<user>\.codex\hooks\omx-native-hook-windows-shim.ps1` | 部署后的 PowerShell shim |
| `dist/scripts/codex-native-hook.js` | 编译后的 Node.js hook |
| `.omx/logs/native-hook-*.jsonl` | 调试日志 |

### 6.3 排查流程

当再次遇到 hook 错误时：

```bash
# 1. 检查完整性
node scripts/verify-hook-integrity.cjs

# 2. 如果缺失，一键修复
npm run build:deploy

# 3. 查看最新日志
Get-Content ".omx/logs/native-hook-shim-debug-$(Get-Date -Format 'yyyy-MM-dd').jsonl" -Tail 1

# 4. 重启 Codex
```
