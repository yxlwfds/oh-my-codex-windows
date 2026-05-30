# 这是基于oh-my-codex (OMX)的windows版本

<p align="center">
  <img src="https://yeachan-heo.github.io/oh-my-codex-website/omx-character-nobg.png" alt="oh-my-codex character" width="280">
  <br>
  <em>你的 codex 并不孤单。</em>
</p>

[![npm version](https://img.shields.io/npm/v/oh-my-codex)](https://www.npmjs.com/package/oh-my-codex)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/node-%3E%3D20-brightgreen)](https://nodejs.org)
[![Discord](https://img.shields.io/discord/1452487457085063218?color=5865F2&logo=discord&logoColor=white&label=Discord)](https://discord.gg/PUwSMR9XNk)

> **[Website](https://yeachan-heo.github.io/oh-my-codex-website/)** | **[Documentation](https://yeachan-heo.github.io/oh-my-codex-website/docs.html)** | **[CLI Reference](https://yeachan-heo.github.io/oh-my-codex-website/docs.html#cli-reference)** | **[Workflows](https://yeachan-heo.github.io/oh-my-codex-website/docs.html#workflows)** | **[OpenClaw 集成指南](../openclaw-integration.zh.md)** | **[GitHub](https://github.com/Yeachan-Heo/oh-my-codex)** | **[npm](https://www.npmjs.com/package/oh-my-codex)**

[OpenAI Codex CLI](https://github.com/openai/codex) 的多智能体编排层。

## v0.17.0 新特性 — 协调与工作流演进

v0.17.0 是一个专注于全新协调与工作流界面的次要版本：

- **Hermes MCP 桥接器 (Bridge)** —— 增加了一个受限、需主动启用的 MCP 协调桥接器，用于会话列表/状态、经审计的后续分发、安全工件读取、会话启动、日志尾部查看和最终协调报告，而无需公开 tmux 回滚或原始私有状态。
- **规范设计工作流 (Canonical Design Workflow)** —— 确立了 `DESIGN.md` 以及镜像的 `$design` 技能引导作为首要设计工作流，同时弃用了旧的 `frontend-ui-ux` 快捷方式。
- **更完整的插件模式技能发现 (Plugin-Mode Discovery)** —— 本地 Codex 插件市场设置现已通过插件发现公开 OMX 技能，具体化并验证插件缓存，并添加插件作用域下的 MCP 元数据（包括 Hermes）。
- **UltraQA 契约化对抗测试 (Adversarial UltraQA Contracts)** —— `$ultraqa` 引导现已强制要求进行恶意场景建模、提示词注入尝试、中断/取消/恢复测试用例、过期状态检查、必要时使用临时测试台，以及显式清理证据。

详情请参阅 [v0.17.0 发布说明](../release-notes-0.17.0.md) 和 [发布正文](../release-body-0.17.0.md)。

## 首次会话

在 Codex 内部：

```text
$deep-interview "clarify the auth change"
$ralplan "approve the auth plan and review tradeoffs"
$ralph "carry the approved plan to completion"
$team 3:executor "execute the approved plan in parallel"
```

使用 `$design` 在 `DESIGN.md` 中确立设计上下文，或当计划需要协调并行执行时选择 `$team`，以及在需要单一负责人持续推进到完成时选择 `$ralph`。

从终端：

```bash
owx team 4:executor "parallelize a multi-module refactor"
owx team status <team-name>
owx team shutdown <team-name>
```

## 推荐工作流

1. `$deep-interview` — 当范围或边界还不清楚时，先用它澄清需求。
2. `$ralplan` — 把澄清后的范围整理成可批准的架构与实施计划。
3. `$team`、`$ralph` 或 `$design` — 需要管理 `DESIGN.md` 设计上下文时用 `$design`，需要协调并行执行时用 `$team`，需要单一负责人持续推进到完成并验证时用 `$ralph`。

## 核心模型

OMX 安装并连接以下层：

```text
User
  -> Codex CLI
    -> AGENTS.md (编排大脑)
    -> ~/.codex/prompts/*.md (代理 prompt 目录)
    -> ~/.codex/skills/*/SKILL.md (skill 目录)
    -> ~/.codex/config.toml (功能、通知、MCP)
    -> .omx/ (运行时状态、记忆、计划、日志)
```

## 主要命令

```bash
owx                # 启动 Codex（在 tmux 中附带 HUD）
owx setup          # 按作用域安装 prompt/skill/config + 项目 .omx + 作用域专属 AGENTS.md
owx doctor         # 安装/运行时诊断
owx doctor --team  # Team/swarm 诊断
owx team ...       # 启动/状态/恢复/关闭 tmux 团队 worker
owx status         # 显示活动模式
owx cancel         # 取消活动执行模式
owx reasoning <mode> # low|medium|high|xhigh
owx tmux-hook ...  # init|status|validate|test
owx hooks ...      # init|status|validate|test（插件扩展工作流）
owx hud ...        # --watch|--json|--preset
owx help
```

## Hooks 扩展（附加表面）

OMX 现在包含用于插件脚手架和验证的 `owx hooks`。

- `owx tmux-hook` 继续支持且未更改。
- `owx hooks` 是附加的，不会替代 tmux-hook 工作流。
- 插件文件位于 `.omx/hooks/*.mjs`。
- 插件默认关闭；使用 `OMX_HOOK_PLUGINS=1` 启用。

完整的扩展工作流和事件模型请参阅 `docs/hooks-extension.md`。

## Hermes MCP 桥接器

- `owx mcp-serve hermes` 启动受限且需主动启用的 MCP 协调桥接器。
- 该桥接器允许外部协调器安全地列出会话、读取会话状态、查看日志尾部、检查/读取工件以及分发后续/修改操作，而无需进行原始终端抓取。
- 详情请参阅 [Hermes MCP 桥接指南](../hermes-mcp-bridge.md) 以获取工具参考和工作目录限制策略。

## 启动标志

```bash
--yolo
--high
--xhigh
--madmax
--force
--dry-run
--verbose
--scope <user|project>  # 仅用于 setup
```

`--madmax` 映射到 Codex `--dangerously-bypass-approvals-and-sandbox`。
仅在可信/外部沙箱环境中使用。

### MCP workingDirectory 策略（可选加固）

默认情况下，MCP state/memory/trace 工具接受调用方提供的 `workingDirectory`。
要限制此行为，请设置允许的根目录列表：

```bash
export OMX_MCP_WORKDIR_ROOTS="/path/to/project:/path/to/another-root"
```

设置后，超出这些根目录的 `workingDirectory` 值将被拒绝。

## Codex-First Prompt 控制

默认情况下，OMX 注入：

```text
-c model_instructions_file="<cwd>/AGENTS.md"
```

这会将 `CODEX_HOME` 中的 `AGENTS.md` 与项目 `AGENTS.md`（如果存在）合并，然后再附加运行时 overlay。
扩展 Codex 行为，但不会替换/绕过 Codex 核心系统策略。

控制：

```bash
OMX_BYPASS_DEFAULT_SYSTEM_PROMPT=0 owx     # 禁用 AGENTS.md 注入
OMX_MODEL_INSTRUCTIONS_FILE=/path/to/instructions.md owx
```

## 团队模式

对于受益于并行 worker 的大规模工作，使用团队模式。

生命周期：

```text
start -> assign scoped lanes -> monitor -> verify terminal tasks -> shutdown
```

操作命令：

```bash
owx team <args>
owx team status <team-name>
owx team resume <team-name>
owx team shutdown <team-name>
```

重要规则：除非中止，否则不要在任务仍处于 `in_progress` 状态时关闭。

### Team shutdown policy

Use `owx team shutdown <team-name>` after the team reaches a terminal state.
Team cleanup now follows one standalone path; legacy linked-Ralph shutdown handling is no longer a separate public workflow.

团队 worker 的 Worker CLI 选择：

```bash
OMX_TEAM_WORKER_CLI=auto    # 默认；当 worker --model 包含 "claude" 时使用 claude
OMX_TEAM_WORKER_CLI=codex   # 强制 Codex CLI worker
OMX_TEAM_WORKER_CLI=claude  # 强制 Claude CLI worker
OMX_TEAM_WORKER_CLI_MAP=codex,codex,claude,claude  # 每个 worker 的 CLI 混合（长度=1 或 worker 数量）
OMX_TEAM_AUTO_INTERRUPT_RETRY=0  # 可选：禁用自适应 queue->resend 回退
```

注意：
- Worker 启动参数仍通过 `OMX_TEAM_WORKER_LAUNCH_ARGS` 共享。
- `OMX_TEAM_WORKER_CLI_MAP` 覆盖 `OMX_TEAM_WORKER_CLI` 以实现每个 worker 的选择。
- 触发器提交默认使用自适应重试（queue/submit，需要时使用安全的 clear-line+resend 回退）。
- 在 Claude worker 模式下，OMX 以普通 `claude` 启动 worker（无额外启动参数），并忽略显式的 `--model` / `--config` / `--effort` 覆盖，使 Claude 使用默认 `settings.json`。

## `owx setup` 写入的内容

- `.omx/setup-scope.json`（持久化的设置作用域）
- 依赖作用域的安装：
  - `user`：`~/.codex/prompts/`、`~/.codex/skills/`、`~/.codex/config.toml`、`~/.omx/agents/`、`~/.codex/AGENTS.md`
  - `project`：`./.codex/prompts/`、`./.codex/skills/`、`./.codex/config.toml`、`./.omx/agents/`、`./AGENTS.md`
- 启动行为：如果持久化的作用域是 `project`，`omx` 启动时自动使用 `CODEX_HOME=./.codex`（除非 `CODEX_HOME` 已设置）。
- 启动指令会合并 `~/.codex/AGENTS.md`（或被覆盖的 `CODEX_HOME/AGENTS.md`）与项目 `./AGENTS.md`，然后附加运行时 overlay。
- 现有 `AGENTS.md` 文件绝不会被静默覆盖：交互式 TTY 下 setup 会先询问是否替换；非交互模式下除非传入 `--force`，否则会跳过替换（活动会话安全检查仍然适用）。
- `config.toml` 更新（两种作用域均适用）：
  - `notify = ["node", "..."]`
  - `model_reasoning_effort = "medium"`
  - `developer_instructions = "..."`
  - `[features] multi_agent = true, child_agents_md = true`
  - MCP 服务器条目（`omx_state`、`omx_memory`、`omx_code_intel`、`omx_trace`）
  - `[tui] status_line`
- 作用域专属 `AGENTS.md`
- `.omx/` 运行时目录和 HUD 配置

## 代理和技能

- Prompt：`prompts/*.md`（`user` 安装到 `~/.codex/prompts/`，`project` 安装到 `./.codex/prompts/`）
- Skill：`skills/*/SKILL.md`（`user` 安装到 `~/.codex/skills/`，`project` 安装到 `./.codex/skills/`）

示例：
- 代理：`architect`、`planner`、`executor`、`debugger`、`verifier`、`security-reviewer`
- 技能：`deep-interview`、`ralplan`、`team`、`ralph`、`plan`、`cancel`

## 项目结构

```text
oh-my-codex/
  bin/omx.js
  src/
    cli/
    team/
    mcp/
    hooks/
    hud/
    config/
    modes/
    notifications/
    verification/
  prompts/
  skills/
  templates/
  scripts/
```

## 开发

```bash
git clone https://github.com/Yeachan-Heo/oh-my-codex.git
cd oh-my-codex
npm install
npm run build
npm test
```

## 文档

- **[完整文档](https://yeachan-heo.github.io/oh-my-codex-website/docs.html)** — 完整指南
- **[CLI 参考](https://yeachan-heo.github.io/oh-my-codex-website/docs.html#cli-reference)** — 所有 `omx` 命令、标志和工具
- **[通知指南](https://yeachan-heo.github.io/oh-my-codex-website/docs.html#notifications)** — Discord、Telegram、Slack 和 webhook 设置
- **[推荐工作流](https://yeachan-heo.github.io/oh-my-codex-website/docs.html#workflows)** — 用于常见任务的经过实战检验的 skill 链
- **[发行说明](https://yeachan-heo.github.io/oh-my-codex-website/docs.html#release-notes)** — 每个版本的新功能

## 备注

- 完整变更日志：`CHANGELOG.md`
- 迁移指南（v0.4.4 后的 mainline）：`docs/migration-mainline-post-v0.4.4.md`
- 覆盖率和对等说明：`COVERAGE.md`
- Hook 扩展工作流：`docs/hooks-extension.md`
- 设置和贡献详情：`CONTRIBUTING.md`

## 致谢

受 [oh-my-claudecode](https://github.com/Yeachan-Heo/oh-my-claudecode) 启发，为 Codex CLI 适配。

## 许可证

MIT
