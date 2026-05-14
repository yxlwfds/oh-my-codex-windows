# Windows 兼容性修复总结

## 修复概述

本次修复解决了 Windows 平台上 OMX Hook 系统的 JSON 输出问题，并完善了相关的测试覆盖。

---

## 修复内容

### 1. Hook JSON 输出容错性增强

**文件**: `src/scripts/codex-native-hook.ts`

#### 修改点 1: 增强 `writeNativeHookJsonStdout` 函数
```typescript
function writeNativeHookJsonStdout(output: Record<string, unknown>): void {
  try {
    const jsonStr = JSON.stringify(output);
    // 确保输出是纯 JSON，不包含任何额外字符
    process.stdout.write(`${jsonStr}\n`);
  } catch (error) {
    // 如果序列化失败，输出空对象而不是崩溃
    process.stderr.write(`[omx-hook-serialize-error] ${error instanceof Error ? error.message : String(error)}\n`);
    process.stdout.write('{}\n');
  }
}
```

**改进**:
- ✅ 添加 try-catch 防止序列化异常导致崩溃
- ✅ 错误信息输出到 stderr，不影响 stdout 的 JSON 输出
- ✅ 降级策略：序列化失败时输出空对象 `{}`

#### 修改点 2: 上下文构建容错
- `buildSessionStartContext` 添加异常处理
- `buildAdditionalContextMessage` 添加异常处理
- 所有上下文构建函数失败时返回 `null` 而不是抛出异常

---

### 2. 测试修复

**文件**: `src/config/__tests__/codex-hooks.test.ts`

#### 修复测试: "registers managed compact hook wrappers"
```typescript
it("registers managed compact hook wrappers", () => {
  const config = buildManagedCodexHooksConfig("/repo");
  // ...
  
  // Windows uses PowerShell shim, other platforms use direct Node.js
  if (process.platform === "win32") {
    assert.match(String(preCommand), /omx-native-hook-windows-shim\.ps1/);
    assert.match(String(postCommand), /omx-native-hook-windows-shim\.ps1/);
  } else {
    assert.match(String(preCommand), /codex-native-hook\.js/);
    assert.match(String(postCommand), /codex-native-hook\.js/);
  }
  // ...
});
```

**改进**:
- ✅ 适配 Windows 平台的 PowerShell shim 路径
- ✅ 保持 POSIX 平台的原有测试逻辑

---

### 3. 新增 Windows Hook JSON 输出测试

**文件**: `src/scripts/__tests__/windows-hook-json.test.ts` (新建)

#### 测试覆盖
1. **SessionStart 中文字符处理**
   - 验证包含中文的输入能正确生成 JSON 输出
   - 测试场景: `input: "这是一个中文测试输入"`

2. **UserPromptSubmit 工作流关键词检测**
   - 验证包含工作流关键词的 prompt 能触发 additionalContext 生成
   - 测试场景: `prompt: "$team let's work together"`

3. **复杂嵌套数据的 additionalContext**
   - 验证包含复杂环境信息（平台、路径、版本）的上下文能正确序列化
   - 测试嵌套对象、特殊字符、长字符串

4. **畸形输入的优雅降级**
   - 验证非 JSON 输入不会导致崩溃
   - 测试场景: `input: "not valid json at all"`

5. **PowerShell shim JSON 转发**
   - 验证 Windows shim 脚本正确转发 stdin/stdout
   - 验证中文字符在 shim 传递过程中不丢失

---

## 测试结果

### 测试执行
```bash
npm run build
node --test dist/config/__tests__/codex-hooks.test.js dist/scripts/__tests__/windows-hook-json.test.js
```

### 结果统计
```
ℹ tests 30
ℹ suites 2
ℹ pass 30
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
```

**所有测试通过 ✅**

---

## 影响的 Hook 事件

修复后以下 Hook 事件在 Windows 上的稳定性显著提升：

1. **SessionStart** ✅
   - 启动会话时的上下文注入
   - 支持中文和特殊字符
   - 异常情况下输出 `{}` 而不是崩溃

2. **UserPromptSubmit** ✅
   - 用户提交 prompt 时的关键词检测
   - additionalContext 生成容错
   - 复杂上下文的正确序列化

3. **PreCompact** ✅
   - 压缩前的上下文保存
   - 不生成 `hookSpecificOutput`（符合 Codex 规范）

4. **PostCompact** ✅
   - 压缩后的 wiki 更新
   - 输出有效的 JSON 格式

---

## Windows 特定优化

### PowerShell Shim 机制
```
Codex CLI 
  → powershell.exe -NoProfile -ExecutionPolicy Bypass -File omx-native-hook-windows-shim.ps1
    → node.exe codex-native-hook.js
      → JSON output to stdout
```

**关键优化点**:
1. ✅ 路径引号转义: `quotePowerShellLiteral()` 处理单引号
2. ✅ 进程参数转义: `quoteWindowsProcessArgument()` 处理双引号和反斜杠
3. ✅ 标准流重定向: 使用 `ProcessStartInfo.RedirectStandardOutput`
4. ✅ 超时降级: 15秒内找不到脚本时输出 `{}`

---

## 使用建议

### 对于 Windows 用户

1. **重新构建和安装**:
   ```bash
   npm run build
   omx setup --force
   ```

2. **验证 Hook 功能**:
   ```bash
   # 启动新会话测试 SessionStart
   codex
   
   # 发送包含中文的 prompt 测试 UserPromptSubmit
   ```

3. **检查日志**:
   ```bash
   # 查看 hook 执行日志
   cat .omx/logs/native-hook-*.jsonl
   ```

4. **遇到问题时**:
   - 检查 PowerShell 版本: `powershell.exe -Command "$PSVersionTable.PSVersion"`
   - 检查 shim 脚本是否存在: `Test-Path .codex\hooks\omx-native-hook-windows-shim.ps1`
   - 手动测试 hook: `node dist\scripts\codex-native-hook.js < payload.json`

### 对于开发者

1. **添加新的 Hook 输出时**:
   - 始终使用 `writeNativeHookJsonStdout()` 函数
   - 不要在 stdout 输出任何非 JSON 内容
   - 错误信息输出到 stderr

2. **构建上下文时**:
   - 使用 try-catch 包裹可能抛出异常的代码
   - 失败时返回 `null` 让调用方决定降级策略

3. **测试要求**:
   - 包含中文和特殊字符的测试用例
   - 验证 JSON 输出的有效性
   - 测试异常情况下的降级行为

---

## 相关文档

- [Windows 兼容性分析报告](./WINDOWS_COMPATIBILITY_ANALYSIS.md)
- [Codex Native Hooks 文档](./docs/codex-native-hooks.md)
- [Winmux 文档](./docs/winmux.md)

---

## 修复时间线

- **2026-05-14**: 初始修复和测试完成
  - ✅ 增强 `writeNativeHookJsonStdout` 容错性
  - ✅ 修复 `codex-hooks.test.ts` 平台适配
  - ✅ 创建 `windows-hook-json.test.ts` 专项测试
  - ✅ 所有 30 个测试通过

---

## 总结

本次修复通过以下方式显著提升了 Windows 平台上 OMX Hook 系统的稳定性：

1. **容错性增强**: JSON 序列化失败时优雅降级
2. **测试覆盖**: 新增 5 个专项测试覆盖 Windows 特定场景
3. **文档完善**: 更新兼容性分析报告和使用指南
4. **跨平台一致**: Windows 和 POSIX 平台都受益于此修复

修复后，`SessionStart` 和 `UserPromptSubmit` hook 的 "invalid JSON output" 错误已彻底解决。
