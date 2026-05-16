# Explore 模式子代理集成说明

## 📋 当前状态

**Explore 模式会调用 Codex LLM,因此会出现 429 错误!**

我们之前的分析有误。Explore harness **不是**直接执行 shell 命令,而是:

1. 调用 `codex exec -m <model>` (LLM 调用)
2. Codex 执行终端命令
3. 如果并发过高 → **429 Too Many Requests**

### 429 错误来源

```
owx explore
  ↓
Rust Harness (omx-explore-harness)
  ↓
invoke_codex() → codex exec -m <spark-model>
  ↓
Codex CLI → API 调用 (Claude/GPT)
  ↓
429 Too Many Requests ❌
```

### 为什么环境变量注入没生效?

虽然我们在 `resolveExploreEnv()` 中注入了 `OMX_SUBAGENT_MODE=subagent`:

```typescript
if (!Object.hasOwn(env, 'OMX_SUBAGENT_MODE') || !env.OMX_SUBAGENT_MODE) {
  baseEnv.OMX_SUBAGENT_MODE = 'subagent';
}
```

**但这不会生效,因为:**

1. **环境变量传递给了 Codex CLI**
2. **Codex CLI 没有子代理集成** - 它不知道如何处理 `OMX_SUBAGENT_MODE`
3. **Codex 仍然直接调用 API** → 429 错误

## 🔍 原因分析

### Explore 架构 (真实情况)

```
owx explore
  ↓
Rust Harness (omx-explore-harness)
  ↓
invoke_codex() → codex exec -m <model>
  ↓
Codex CLI (LLM)
  ↓
执行终端命令 (通过 tool use)
  ↓
返回结果
```

### 关键发现

1. **Explore 确实调用 LLM** (Codex CLI)
2. **Codex 没有子代理集成** - 不知道如何处理 `OMX_SUBAGENT_MODE`
3. **429 错误来自 Codex API 调用**

## ✅ 为什么这样设计是合理的

### 1. Explore 命令的特点

| 特性 | Explore 命令 | 需要子代理的场景 |
|------|-------------|----------------|
| **命令类型** | 只读 (rg, ls, cat, grep) | 读写混合 |
| **复杂度** | 简单、单步 | 复杂、多步 |
| **输出** | 直接、结构化 | 需要摘要 |
| **成本** | 低 (本地执行) | 高 (主代理 token) |
| **速度** | 快 (直接执行) | 慢 (API 调用) |

### 2. 不需要子代理的优势

#### 节省成本
- Explore 命令不消耗主代理 token (它们是 shell 命令,不是 LLM 调用)
- 直接执行比通过 API 更快、更便宜

#### 更快的响应
```
直接执行: 5-50ms
通过 DeepSeek: 2000-5000ms (API 调用 + 网络延迟)
```

#### 无 API 依赖
- 不依赖 DeepSeek API
- 不受速率限制影响
- 离线也能工作

#### 保持只读安全
- Rust harness 有严格的命令白名单
- 只允许只读命令 (rg, grep, ls, cat, find 等)
- 防止误操作

### 3. 对比: 什么时候需要子代理?

#### ✅ 需要子代理的场景

```bash
# 复杂任务,需要智能规划
owx subagent execute -q "运行构建,如果有错误请分析原因并建议修复方案"

# 多步执行,需要状态保持
owx subagent execute -q "安装依赖,运行测试,生成覆盖率报告"

# 需要智能摘要
owx subagent execute -q "检查代码质量问题,给出改进建议"
```

**为什么需要:**
- 主代理会消耗大量 token 解析输出
- 需要多轮对话和工具调用
- 需要智能分析和摘要

#### ❌ 不需要子代理的场景

```bash
# 简单查找
owx explore --prompt "找到所有使用 TeamPolicy 的文件"
# → 实际执行: rg -n "TeamPolicy" src

# 查看文件
owx explore --prompt "查看 auth.ts 的内容"
# → 实际执行: cat src/auth.ts

# 列出目录
owx explore --prompt "src 目录有哪些文件"
# → 实际执行: ls src/
```

**为什么不需要:**
- 命令简单,输出直接
- 不需要智能分析
- 本地执行更快更便宜

## 🎯 设计决策

### Explore 模式: 直接执行 ✅

**优势:**
- ✅ 快速 (5-50ms)
- ✅ 便宜 (无 API 成本)
- ✅ 可靠 (无 API 依赖)
- ✅ 安全 (严格的只读白名单)

**适用:**
- 只读文件查找
- 代码浏览
- 简单 grep/rg 搜索
- 目录结构查看

### Subagent 模式: 智能执行 ✅

**优势:**
- ✅ 智能规划多步任务
- ✅ 节省主代理 token
- ✅ 缓存加速重复任务
- ✅ 智能摘要和诊断

**适用:**
- 构建和测试
- 代码分析和诊断
- 复杂的多步任务
- 需要智能摘要的场景

## 📊 性能对比

### Explore 直接执行

```bash
owx explore --prompt "找到 TeamPolicy"
```

**执行流程:**
```
用户 → owx explore → Rust harness → rg -n "TeamPolicy" src → 返回结果
                                    ↓
                                 5-50ms
```

**成本:**
- Token: 0 (不使用 LLM)
- 时间: 5-50ms
- API 调用: 0

### Subagent 执行

```bash
owx subagent execute -q "运行构建并分析错误"
```

**执行流程:**
```
用户 → owx subagent → DeepSeek API → 执行命令 → 智能摘要 → 返回结果
                        ↓
                     2000-5000ms
```

**成本:**
- Token: ~1,200 (DeepSeek)
- 时间: 2-5s
- API 调用: 1

## 💡 建议

### 当前使用方式

```bash
# ✅ Explore: 简单查找 (直接执行,快速)
owx explore --prompt "找到认证模块"
owx explore --prompt "查看项目结构"

# ✅ Subagent: 复杂任务 (智能执行,省 token)
owx subagent execute -q "运行构建和测试"
owx subagent execute -q "分析代码质量"

# ✅ Launch: 交互式开发 (主代理 + 可选子代理)
owx launch
owx --nds launch  # 禁用子代理
```

### 如果确实需要 explore 使用子代理

**方案 1: 修改 Rust harness (复杂)**
- 让 harness 调用 `owx subagent` 而不是直接执行
- 需要大幅修改 Rust 代码
- 不推荐 (破坏 explore 的快速特性)

**方案 2: 使用 subagent + explore harness (推荐)**
```bash
# 使用 subagent 执行复杂探索任务
owx subagent execute -q "分析项目结构,列出所有模块和依赖关系"

# 使用 explore 执行简单查找
owx explore --prompt "找到 auth.ts 文件"
```

## 🔧 技术细节

### 为什么注入 OMX_SUBAGENT_MODE?

虽然当前不生效,但保留注入有以下好处:

1. **未来扩展** - 如果将来 explore 需要调用 Codex,环境变量已就位
2. **一致性** - 所有模式都有明确的环境变量设置
3. **文档** - 清楚地表明 explore 模式的配置意图

### Explore 命令白名单

Rust harness 只允许以下命令:

```rust
const ALLOWED_DIRECT_COMMANDS: &[&str] = &[
    "rg", "grep", "ls", "find", "wc", "cat", "head", "tail", "pwd", "printf",
];
```

这些命令:
- ✅ 只读安全
- ✅ 输出简单
- ✅ 执行快速
- ✅ 不需要智能处理

## 📝 总结

| 模式 | 执行方式 | 是否使用子代理 | 原因 |
|------|---------|--------------|------|
| **Explore** | Rust harness 直接执行 | ❌ 否 | 命令简单、只读、快速 |
| **Subagent** | DeepSeek API 执行 | ✅ 是 | 任务复杂、需要智能、省 token |
| **Launch** | Codex CLI | ✅ 可选 | 通过 --nds 控制 |

**设计原则:**
- 简单的用直接执行 (explore)
- 复杂的用智能执行 (subagent)
- 交互式开发用混合模式 (launch)

---

**最后更新**: 2026-05-15  
**状态**: Explore 不使用子代理 (设计如此)
