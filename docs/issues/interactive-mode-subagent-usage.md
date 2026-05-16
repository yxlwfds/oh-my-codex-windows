# `owx` 交互模式使用子代理指南

## 🔍 问题说明

你在 `owx` 交互模式(launch)中执行命令时,**没有看到 `deepseek:` 前缀日志**。

**原因**:
- `owx` (launch) 是交互式 Codex 会话
- Codex 内部直接执行 Bash 命令 (通过 tool use)
- **不会**自动经过我们的子代理系统

## ✅ 当前子代理覆盖范围

| 命令 | 是否使用子代理 | 说明 |
|------|--------------|------|
| `owx subagent execute -q "..."` | ✅ 是 | 直接使用子代理 |
| `owx explore --prompt "..."` | ✅ 是 | 通过 Rust harness 调用子代理 |
| `owx` (交互模式) |  否 | Codex 直接执行命令 |
| `owx launch` | ❌ 否 | 同 `owx` 交互模式 |

##  解决方案

### 方案 1: 在 `owx` 中手动调用子代理 (推荐)

在 `owx` 交互会话中,明确使用子代理命令:

```
$ owx

> 请帮我运行构建并分析错误

[Codex 执行...]

> 请使用子代理执行: owx subagent execute -q "运行构建,如果有错误请分析原因"

[子代理执行...]
deepseek: 执行子代理任务
   查询: 运行构建,如果有错误请分析原因
   模式: 子代理模式 (DeepSeek V4 Flash)

📊 执行结果:
构建失败: TypeScript 类型错误...

💰 资源消耗:
   Token 消耗: 1,200
   执行命令数: 3
   缓存命中: 否 ❌
```

**优势**:
- ✅ 可以看到 `deepseek:` 日志
- ✅ 使用 DeepSeek,节省主代理 token
- ✅ 支持缓存和自动降级

### 方案 2: 创建 alias 简化使用

在你的 shell 配置中 (~/.bashrc 或 ~/.zshrc):

```bash
# 简化子代理命令
alias sd='owx subagent execute -q'

# 使用示例
sd "运行构建并分析错误"
sd "检查代码质量问题"
sd "运行测试并生成报告"
```

### 方案 3: 使用 prompt 让 Codex 自动调用子代理

在 `owx` 交互中,可以这样提示 Codex:

```
> 请使用子代理运行构建,这样可以节省 token 并查看详细日志

[Codex 会执行: owx subagent execute -q "运行构建"]
```

或者在 AGENTS.md 中添加指令:

```markdown
## 终端命令执行规则

对于复杂的终端命令任务,请使用子代理:
- 构建和测试: `owx subagent execute -q "运行构建/测试"`
- 代码分析: `owx subagent execute -q "分析代码质量"`
- 多步操作: `owx subagent execute -q "安装依赖,运行测试,生成报告"`

对于简单只读命令,可以直接执行:
- 查找文件: `rg -n "pattern" src`
- 查看内容: `cat file.txt`
- 列出目录: `ls -la`
```

## 📊 对比: 何时使用子代理?

### ✅ 应该使用子代理的场景

```bash
# 1. 构建和测试 (多步操作)
owx subagent execute -q "运行构建,如果有错误请分析原因并建议修复方案"

# 2. 代码分析 (需要智能摘要)
owx subagent execute -q "检查代码质量问题,给出改进建议"

# 3. 复杂诊断 (需要多步执行)
owx subagent execute -q "分析日志文件,找出错误原因"

# 4. 重复性任务 (受益于缓存)
owx subagent execute -q "运行测试套件"  # 第一次: 2s
owx subagent execute -q "运行测试套件"  # 第二次: 0.1s (缓存)
```

**为什么需要子代理:**
- 消耗主代理大量 token
- 需要多步执行和状态保持
- 需要智能分析和摘要
- 任务重复性高,可缓存

### ❌ 不需要子代理的场景

```bash
# 1. 简单查找 (在 owx 中直接执行)
rg -n "TeamPolicy" src

# 2. 查看文件 (在 owx 中直接执行)
cat src/auth.ts

# 3. 列出目录 (在 owx 中直接执行)
ls -la src/

# 4. Git 操作 (在 owx 中直接执行)
git status
git log --oneline -10
```

**为什么不需要:**
- 命令简单,输出直接
- 主代理 token 消耗少
- 本地执行更快 (5-50ms)
- 不需要智能分析

##  技术限制

### 为什么不在 PreToolUse hook 中自动拦截?

**理论上可以**,但有以下问题:

1. **PreToolUse 是阻塞式的**
   - 在命令执行**之前**调用
   - 无法在这里执行子代理
   - 只能返回 "block" 或 "allow"

2. **需要修改 Codex 执行流程**
   - Codex 的 tool use 执行是内部逻辑
   - 无法通过 hook 完全拦截
   - 需要修改 Codex CLI 源码

3. **会破坏交互体验**
   - 每次执行命令都调用子代理 → 慢 (2-5s)
   - 简单命令也会变慢
   - 失去直接执行的灵活性

### 可能的未来改进

如果确实需要自动拦截,可以考虑:

**方案 A: 修改 Codex CLI** (复杂)
- 在 Codex 源码中添加子代理集成
- 拦截 Bash tool use
- 自动委托给子代理
- 缺点: 需要维护 Codex fork

**方案 B: Shell wrapper** (中等)
- 创建 shell wrapper 脚本
- 替换系统 Bash
- 拦截特定命令模式
- 缺点: 影响全局,可能破坏其他工具

**方案 C: 用户培训** (推荐)
- 文档说明何时使用子代理
- 提供 alias 简化命令
- 在 AGENTS.md 中添加指令
- 优点: 简单,灵活,可控

## 📝 最佳实践

### 在 `owx` 交互中的工作流程

```
1. 简单查询 → 直接执行命令
   > rg -n "auth" src
   [Codex 执行,快速返回]

2. 复杂任务 → 使用子代理
   > 请使用子代理执行构建
   > 或使用: owx subagent execute -q "运行构建"
   [子代理执行,显示 deepseek: 日志]

3. 重复任务 → 受益于缓存
   > 再次运行测试
   > owx subagent execute -q "运行测试"
   [缓存命中,0.1s 返回]
```

### 推荐的命令模板

```bash
# 构建 + 分析
owx subagent execute -q "运行构建,如果有错误请分析原因并建议修复方案"

# 测试 + 覆盖率
owx subagent execute -q "运行测试,生成覆盖率报告"

# 代码质量检查
owx subagent execute -q "运行 lint 和类型检查,列出所有问题"

# 性能分析
owx subagent execute -q "分析应用性能,找出瓶颈"

# 安全扫描
owx subagent execute -q "运行安全扫描,检查依赖漏洞"
```

## 🎯 总结

### 当前状态

| 场景 | 使用方式 | 是否显示 deepseek: |
|------|---------|-------------------|
| `owx subagent execute` | 直接调用 | ✅ 是 |
| `owx explore` | 自动使用 | ✅ 是 |
| `owx` 交互模式 | 手动调用子代理 | ✅ 是 (如果手动调用) |
| `owx` 交互模式 | 直接执行命令 | ❌ 否 |

### 建议

1. **简单命令** → 在 `owx` 中直接执行
2. **复杂任务** → 使用 `owx subagent execute`
3. **团队规范** → 在 AGENTS.md 中说明何时使用子代理
4. **个人习惯** → 创建 alias 简化命令

---

**最后更新**: 2026-05-15  
**状态**: 文档说明 (无代码改动)  
**原因**: 技术限制 (无法在 PreToolUse 中自动拦截)
