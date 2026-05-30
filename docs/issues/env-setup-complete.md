# 环境变量设置指南

## ✅ 已完成设置

以下环境变量已永久写入 Windows 注册表(用户级别):

| 变量名 | 值 | 说明 |
|--------|-----|------|
| `DEEPSEEK_API_KEY` | `sk-xxxx...xxxx` | DeepSeek API 密钥 |
| `OMX_SUBAGENT_MODEL` | `deepseek-v4-flash` | 子代理模型 |
| `OMX_SUBAGENT_THINKING_MODE` | `smart` | 思考模式策略 |
| `OMX_RATE_LIMIT_CONCURRENCY` | `5` | 最大并发数 |
| `OMX_RATE_LIMIT_DELAY_MS` | `500` | 请求间隔 (毫秒) |

## ⚠️ 重要提示

### 1. 生效方式

这些环境变量已**永久保存**到 Windows 注册表,但需要:

- ✅ **重启 PowerShell 终端**后才能生效
- ❌ 当前打开的终端会话**不会立即生效**

### 2. 立即生效的方法

如果你想在当前终端立即使用,需要手动设置:

```powershell
$env:DEEPSEEK_API_KEY="sk-xxxx...xxxx"  # 替换为你的真实密钥
$env:OMX_SUBAGENT_MODEL="deepseek-v4-flash"
$env:OMX_SUBAGENT_THINKING_MODE="smart"
$env:OMX_RATE_LIMIT_CONCURRENCY="5"
$env:OMX_RATE_LIMIT_DELAY_MS="500"
```

### 3. 验证设置

重启终端后,运行以下命令验证:

```powershell
# 方法 1: 查看所有 OMX 相关变量
Get-ChildItem Env: | Where-Object { $_.Name -like '*OMX*' -or $_.Name -eq 'DEEPSEEK_API_KEY' }

# 方法 2: 使用项目脚本
.\scripts\check-env-variables.ps1
```

## 📝 管理脚本

项目提供了三个管理脚本:

### 查看变量
```powershell
.\scripts\check-env-variables.ps1
```
- 显示所有 OMX 相关环境变量
- 区分永久值和当前会话值
- 验证 API Key 格式

### 设置变量
```powershell
.\scripts\set-env-variables.ps1
```
- 安全地添加/更新环境变量
- 只修改指定的变量
- **不会删除其他变量**

### 清除变量
```powershell
.\scripts\clear-env-variables.ps1
```
- 删除 OMX 相关环境变量
- 需要确认操作
- **不会影响其他变量**

## 🔒 安全性

### API Key 保护

- ✅ 已永久存储到 Windows 注册表(用户级别)
- ✅ 只有当前用户可访问
- ✅ 不会被提交到 Git 仓库
- ⚠️ 不要将 API Key 分享给他人

### 环境变量作用域

```
系统级 (所有用户)
  ↑
用户级 (当前用户) ← 我们设置在这里
  ↑
进程级 (当前会话)
```

本次设置的是**用户级**环境变量:
- ✅ 对所有终端会话永久有效
- ✅ 不影响其他用户
- ✅ 系统重启后仍然有效

## 🚀 下一步

### 1. 重启终端

关闭并重新打开 PowerShell。

### 2. 验证设置

```powershell
.\scripts\check-env-variables.ps1
```

### 3. 安装依赖

```bash
npm install @anthropic-ai/sdk
```

### 4. 测试子代理

```bash
# 查看配置
owx subagent status

# 执行简单任务
owx subagent execute -q "运行 ls -la"
```

## 📚 相关文档

- [执行子代理使用指南](./execution-subagent-usage.md)
- [执行子代理方案设计](./execution-subagent-termin.md)
- [执行子代理实现总结](./execution-subagent-summary.md)

## ❓ 常见问题

### Q: 为什么当前终端看不到新变量?

A: 永久环境变量需要重启终端才能生效。当前会话需要使用 `$env:变量名` 手动设置。

### Q: 如何确认变量已永久保存?

A: 重启终端后运行 `Get-ChildItem Env: | Where-Object { $_.Name -like '*OMX*' }`,如果能看到变量说明已永久保存。

### Q: 这些变量会影响其他项目吗?

A: 不会。这些是 OMX 项目专用的环境变量,不会影响其他项目。

### Q: 如何临时禁用子代理?

A: 设置 `OMX_SUBAGENT_ENABLED=false`,但本次未设置此变量,默认启用。

---

**设置完成时间**: 2026-05-15  
**设置方式**: PowerShell [Environment]::SetEnvironmentVariable (User 级别)  
**影响范围**: 仅当前 Windows 用户
