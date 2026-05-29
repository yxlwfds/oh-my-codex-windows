# agents-md-optimize

通用 AGENTS.md 管理与优化 skill。适用于任何项目、任何 AI IDE（Windsurf、Codex、Claude Code、Cursor、Roo 等）。

## 触发条件

- 用户提到"优化 AGENTS.md"、"整理 AGENTS.md"、"AGENTS.md 太长了"
- 用户要求创建新项目的 AGENTS.md
- 检测到根 AGENTS.md 超过 120 行
- 项目无 AGENTS.md 且用户要求初始化

## 核心原则

### 注意力经济

根 AGENTS.md 会被所有 AI IDE **每次对话全量加载**到上下文窗口。内容越多：
- 核心约束权重越低（注意力稀释）
- token 成本越高
- 与具体任务无关的信息越多

**黄金法则：根文件 ≤ 100 行，只放"始终需要"的约束。**

### 跨 IDE 兼容分流

| 机制 | 加载方式 | 适合放什么 |
|------|----------|-----------|
| 根 `AGENTS.md` | 始终全量加载（所有 IDE） | 最高频核心约束 |
| 子目录 `AGENTS.md` | 操作该目录时加载（Windsurf/Codex） | 目录级约束 |
| `docs/agents/*.md` | 按引用指令读取（所有 IDE） | 详细领域约束 |
| `.windsurf/rules/*.md` | Windsurf 条件触发 | Windsurf 专属场景规则 |
| `.cursor/rules/*.md` | Cursor 条件触发 | Cursor 专属场景规则 |
| `CLAUDE.md` | Claude Code 全量加载 | Claude Code 约束 |

## 执行流程

### 场景 A：项目无 AGENTS.md — 初始化

1. 确认项目技术栈、主要语言、部署方式
2. 根据模板创建根 `AGENTS.md`（≤ 80 行）
3. 如有明确子领域（前端、后端、脚本等），创建对应子目录 `AGENTS.md`
4. 如有详细约束需求，创建 `docs/agents/` 引用文件

**根文件模板结构：**

```markdown
# {项目名} Agent Guide

本文件用于为项目内的 AI Agent 提供根目录长期约束。

## 详细约束文件（按需读取）

以下文件包含分领域详细约束，操作对应领域时**必须主动读取**：

- **{领域A}**：`docs/agents/{file-a}.md` — {触发条件}
- **{领域B}**：`docs/agents/{file-b}.md` — {触发条件}

## 基础约束

- {5~10 条最核心、最高频的项目级约束}

## 改动原则

- {5~10 条通用改动行为规范}

## 代码评审

- {精简的评审关注点}
```

### 场景 B：AGENTS.md 过长 — 瘦身优化

1. **审计** — 读取当前 AGENTS.md，按类别标记每一条：
   - `[CORE]` 始终需要，每次对话都相关
   - `[DOMAIN]` 特定领域才需要（如 Java、前端、云基础设施）
   - `[REF]` 纯参考/索引信息（如 skill 列表、文件位置列表）
   - `[DIR]` 特定目录才需要（如 frontend/*、script/*）

2. **分流** — 按标记决定去向：
   - `[CORE]` → 保留在根文件
   - `[DOMAIN]` → 移到 `docs/agents/{domain}.md`，根文件加一行引用指令
   - `[REF]` → 移到 `docs/agents/` 或直接删除（如已有其他机制覆盖）
   - `[DIR]` → 移到对应子目录 `AGENTS.md`

3. **引用指令格式**（跨 IDE 通用）：
   ```markdown
   ## 详细约束文件（按需读取）

   以下文件包含分领域详细约束，操作对应领域时**必须主动读取**：

   - **{领域名}**：`{文件路径}` — {何时读取的简述}
   ```

4. **验证** — 精简后确认：
   - 根文件 ≤ 100 行
   - 每条引用指令有明确触发条件
   - 子文件内容完整无遗漏
   - 无重复（同一规则不在多处出现）

### 场景 C：新增约束 — 判断归属

新增约束时，按以下决策树判断放置位置：

```
该约束是否每次对话都需要？
├── 是 → 根 AGENTS.md
└── 否 → 是否属于特定目录？
    ├── 是 → 该目录的 AGENTS.md
    └── 否 → 是否属于特定领域/技术栈？
        ├── 是 → docs/agents/{domain}.md
        └── 否 → 是否仅在特定场景触发？
            ├── 是 → .windsurf/rules/ 或 .cursor/rules/
            └── 否 → 根 AGENTS.md（但要评估是否真的高频）
```

## 子目录 AGENTS.md 编写规范

子目录 `AGENTS.md` 由 Windsurf 和 Codex 在操作该目录文件时自动加载。适合放：

- 该目录的技术栈约束（如前端框架规范、构建方式）
- 该目录的代码风格要求
- 该目录的特殊部署/构建规则

**不要放**：
- 对根约束的重复
- 其他目录的规则
- 全局通用信息

## docs/agents/ 命名规范

| 文件名 | 内容 |
|--------|------|
| `java-conventions.md` | Java/后端代码约束 |
| `cloud-infra.md` | 云基础设施/部署约束 |
| `skills-registry.md` | Skills 注册 + IDE 映射 |
| `frontend-conventions.md` | 前端通用约束 |
| `database-conventions.md` | 数据库/SQL 约束 |
| `api-conventions.md` | API 设计约束 |
| `security.md` | 安全约束 |

按项目实际需要选用，不必全部创建。

## 跨 IDE 同步策略

如果项目同时使用多个 AI IDE，推荐：

1. **根 `AGENTS.md`** 作为唯一源头（所有 IDE 都读）
2. **`docs/agents/`** 作为详细约束仓库（通过引用指令，任何 IDE 都可读取）
3. **IDE 专属配置** 仅放触发机制差异：
   - Windsurf: `.windsurf/rules/*.md` 的 `description` 字段做条件触发
   - Cursor: `.cursor/rules/*.md` 做条件触发
   - Claude Code: `CLAUDE.md` 可 `import` 或指向 `docs/agents/`
   - Codex: 子目录 `AGENTS.md` + 根文件引用指令

## 注意事项

- 修改 AGENTS.md 时，不删除已有的有意义内容，优先补充细化
- 精简≠删除，是把内容移到更合适的位置
- 引用指令中的触发条件要足够明确，让 AI 能判断何时读取
- 子文件路径使用相对路径，保持仓库可移植性
