# Hook 路径解析重构记录

## 变更摘要

**提交类型**: `refactor` - 架构级代码重构  
**影响范围**: `src/config/codex-hooks.ts`  
**向后兼容**: ✅ 完全兼容（生成的 `hooks.json` 格式变更，自动重新部署）

---

## 删除的代码

### 函数移除

| 函数 | 行数 | 功能 | 移除原因 |
|------|------|------|----------|
| `resolvePwshPath()` | ~60 | 多层级 pwsh 路径探测 | 过度工程化 |
| `resolveWindows83ShortPath()` | ~15 | 8.3 短路径转换 | 不再需要 |

### 逻辑简化

```diff
- const pwshPath = resolvePwshPath();
- return `${pwshPath} -NoProfile ...`;
+ return `pwsh -NoProfile ...`;
```

---

## 技术债务清理

### 已解决问题

1. **代码复杂度**: 从 3 层嵌套回退逻辑简化到直接返回
2. **运行时开销**: 消除 `where.exe` 和 `cmd.exe` 子进程调用
3. **测试脆弱性**: 不再依赖系统具体安装路径，测试更稳定

### 架构收益

- **单一职责**: 路径解析责任移交操作系统 PATH 机制
- **可预测性**: Hook 命令在所有环境中完全一致
- **可维护性**: 新开发者无需理解 Windows 8.3 短路径知识

---

## 验证清单

- [x] 25 项单元测试全部通过
- [x] `build:deploy` 完整链路验证
- [x] 实际 `hooks.json` 生成格式检查
- [x] 端到端 Hook 执行测试

---

## 迁移说明

**用户操作**: 无

系统自动处理：
1. `npm run build:deploy` 重新生成 `hooks.json`
2. 新配置自动使用裸 `pwsh` 命令
3. 重启 Codex 后生效

**前提检查**（如遇到问题）:
```powershell
# 确保 pwsh 在 PATH 中
Get-Command pwsh
```
