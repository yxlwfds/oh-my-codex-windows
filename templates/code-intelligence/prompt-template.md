# Windsurf Native 架构一键集成提示词 (Prompt Template)

在新项目根目录首次启动 Windsurf Cascade 时，**直接将下面的灰色框内全部内容复制并发送给 Cascade**。

Cascade 会自动识别项目技术栈，并完美生成符合 **Native Rule-Skill 混合架构** 的全套提效配置文件（包括 `AGENTS.md` 骨架、分流文档和场景触发规则）。

---

## 📋 复制以下提示词发送给 Cascade

```text
你是一个精通 AI 工程化和高阶提效的架构专家。现在我们将为当前新项目初始化 **Windsurf Native Rule-Skill 混合架构**（类似于结合了 Superpowers 的严格工程纪律与 Everything Claude Code 的场景工具箱，但采用 Windsurf 原生方式实现）。

请你一步一步执行以下任务，不要省略步骤：

1. **探测项目技术栈**：
   - 扫描当前项目的文件和目录（检查 package.json、pom.xml、requirements.txt、go.mod 或 Dockerfile 等）。
   - 确定主要的开发语言、前端框架、后端框架、数据库类型、打包构建方式以及部署方式。

2. **一键从本地军火库“进货” Seeds**：
   - 新项目需要高阶种子赋能。请你检查本地全局军火库 `D:\code\my\oh-my-codex\templates\code-intelligence\seeds\`（如果不存在则检查母项目 `d:\code\zq\guanghe-cloud\.windsurf\seeds\`）。
   - 使用 PowerShell 自动将该目录下的所有提纯 Seeds 目录（包括 `java-rules/`, `springboot-patterns/`, `database-migrations/`, `superpowers-skills/`, `ecc-rules/` 等）**完整拷贝同步**到当前新项目的 `.windsurf/seeds/` 下，实现 1 秒完全离线“进货”。
   - 如果以上本地路径均不可达（如在纯净新机器上），则跳过并提醒我后续通过网络脚本拉取。

3. **设计并自动创建根级 `AGENTS.md`**：
   - 控制在 100 行内，防止 AI 注意力稀释。
   - 包含【详细约束文件（按需读取）】引用引导。
   - 包含【基础约束】：基于第 1 步分析出来的项目架构默契（例如：观察已有代码里的公共继承父类、通用响应体结构、或是既有的数据库关联习惯），提炼出 3-5 条最贴合该项目本身的原生核心约束，**绝对不要无脑硬套其它项目不通用的教条**（如禁用物理外键或特定 Java 基类等）。
   - 包含【改动原则】（补丁式更新、任务完成后不默认停在代码改完、不误删、对 Windows PowerShell 带点参数自动加双引号等）。

4. **设计并自动创建 `docs/agents/` 分流约束文档**：
   - 从刚刚“进货”的 `.windsurf/seeds/` 中，将最切合的技术栈规范（例如 Java 项目就提取 `java-rules/coding-style.md` 等，或根据 Seeds 里的 springboot-patterns 自主定制）提取并写入 `docs/agents/backend-conventions.md` 等领域规范文件中。
   - 确保这些文件写出适配当前技术栈的高鲁棒性编码规范、异常处理规范和架构设计原则。

5. **设计并自动创建场景触发规则**：
   - 根据探测出的部署或数据库类型，在 `.windsurf/rules/` 目录下创建至少一个特定场景触发文件（例如：针对 Docker/K8s 创建 `deploy.md`；针对 MySQL/PostgreSQL 提取 seeds 里的 `database-migrations` 指南并创建 `sync-db.md`）。
   - 规定当用户触发“部署”、“发布”、“SQL同步”等关键词时，AI Agent 必须主动加载的排查与执行流程。

6. **自动激活并注册高阶 Skills (自动进货物理组装)**：
   - 从刚才“进货”的 `.windsurf/seeds/` 中，将 100% 语言无关的通用高阶核心技能 `superpowers-skills/systematic-debugging`（系统化调试）和 `superpowers-skills/test-driven-development`（TDD）**直接整体复制**到当前新项目的 `.windsurf/skills/` 目录下，实现开箱即用。
   - 如果当前项目是 Java/MySQL (或 PolarDB-X)，则将 seeds 下的 `springboot-patterns` 和重构提纯后的 `database-migrations`（专属数据库同步演进）技能也复制拷贝到 `.windsurf/skills/` 下；如果是其它技术栈，则向我提出适合当前项目的自动化技能建设建议。
   - 自动在 `docs/agents/` 下创建或生成一个 `skills-registry.md`（项目技能注册表），将当前项目已物理激活的所有高阶 Skills 进行汇总索引。

请开始执行。直接开始创建并写入文件，完成之后，向我详细汇报已创建的文件路径和内容摘要！
```

---

## 🎯 集成后的预期效果

当你在新项目中发送此提示词后，Cascade 会自动在本地执行：
1. 自动读取并判断技术栈（如：React + Go 或 Spring Boot + Vue 3）。
2. 在项目根目录创建 `AGENTS.md`。
3. 创建 `docs/agents/frontend-conventions.md` 与 `docs/agents/backend-conventions.md`。
4. 创建 `.windsurf/rules/` 触发规则。
5. 向你输出一个清晰的项目级 AI 约束看板和后续提效建议。

新项目将立即拥有高度规范、不易犯错、随时可进行场景自动化执行的超级 AI 助手，且全程在本地 IDE 极速响应！
