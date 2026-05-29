# Windsurf Native Rule-Skill 混合架构集成中心 (Universal Integration Center)

本集成中心为项目开发提供了 **Windsurf Native Rule-Skill 混合架构** 的一键冷启动能力。它完美地将 **Superpowers（系统排错/测试驱动开发的高自律工程纪律）** 与 **Everything Claude Code (ECC, 29+多语言规范/50+场景提效工具箱)** 进行了深度提纯与融合。

通过该架构，新项目冷启动可以实现 **1秒内完全离线进货全套黄金种子（Seeds）**，并由 AI 自动根据当前技术栈进行自适应解包、规则配置和核心技能物理激活注册，彻底告别 HTTPS 网络拉取延迟与教条主义！

---

## 📂 架构目录树规范

在全局同步库或您的新项目中，该架构的标准化文件分发如下：

```text
D:\code\my\oh-my-codex\templates\code-intelligence\ (全局军火库)
├── README.md                          # 本说明指南
├── install.md                         # 自动化初始化与1秒 Seeds 离线提取脚本
├── prompt-template.md                 # 一键丢给新项目 Cascade 的装配大提示词
└── seeds/                             # 🔮 全栈全场景 180+ 提纯离线黄金 Seeds
    ├── ecc-rules/                     # 全语言（Go, Python, Java, Rust, TS等）审查铁律风格池
    ├── ecc-skills/                    # 50+ 场景（大厂微服务, 数据库同步, 安全审计）核心技能
    ├── ecc-agents/                    # 60+ 领域级专门 Subagents 核心提示词库
    └── superpowers-skills/            # Systematic-debugging (排错) / TDD 等方法论核心
```

---

## 🚀 新项目一键冷启动“一条龙”集成指南

无论新建何种编程语言、何种框架的项目，只需跟随以下两步即可瞬间让 AI Agent 爆仓：

### 🧱 第一步：运行本地一键“进货”脚本 (PowerShell)
在新项目的根目录下打开 PowerShell，复制并运行 `install.md` 里的 **自动化初始化脚本**。这个脚本会：
1. **0.1 秒内** 自动在当前新项目中建好 `docs/agents/`、`.windsurf/rules/`、`.windsurf/skills/` 目录。
2. **物理同步**：自动检测您本机的全局军火库（`D:\code\my\oh-my-codex\`），将里面的 **180+ 个高含金量黄金 seeds 100% 离线拷贝至新项目 `.windsurf/seeds/` 目录中**！
3. **初始化骨架**：在项目根目录自动创建普适通用的 `AGENTS.md` 核心导航骨架。

---

### 🧪 第二步：将提示词丢给新项目的 Cascade (1秒自动解包激活)
打开新项目的 Windsurf 软件，新建一个 Cascade 会话，直接复制 `prompt-template.md` 中的灰色框大提示词丢给它：
* 🕵️‍♂️ **自动技术栈探测**：AI 会自动扫描新项目的文件特征（例如：判断是 Go 还是 Spring Boot，是 PostgreSQL 还是 MySQL）。
* 🔒 **反教条约束自适应**：AI 绝对不会乱塞其他项目不通用的特定教条约束。它会深入观察已有代码里的公共父类、Response 结构、或者是既有的数据库习惯，从而自主提炼出 **3-5 条最合适该项目本身的原生核心约束** 写入 `AGENTS.md`。
* ⚙️ **Rules 自动解包写入**：AI 会将 seeds 中最对应的语言规范（例如 Go 语言即提取 `ecc-rules/golang/coding-style.md` 等）智能解包合并入 `docs/agents/backend-conventions.md` 等分流约束中。
* ⚡ **高阶 Skills 物理激活与登记**：
  - AI 会将 100% 通用的 `superpowers-skills/systematic-debugging`（系统化排错）和 `test-driven-development`（TDD）**直接物理拷贝到新项目 `.windsurf/skills/` 下**，实现立刻离线可用！
  - 如果是 Java 项目，则额外物理拷贝并激活 `springboot-patterns` 和我们重塑定制的 `database-migrations`。
  - **自动技能索引**：自动生成 `docs/agents/skills-registry.md`（项目技能注册表），将所有当前已物理激活的高阶 Skills 进行注册汇总。

---

## 💎 混合架构的核心优势

1. **零延迟，100% 离线可用**：
   剔除了 Claude Code 庞杂的 CLI 命令行运行依赖和 GitHub API 访问，全部通过本地高阶种子物理复制同步，0% 网络超时失败风险。
2. **杜绝硬编码教条主义**：
   由 AI 在现场通过 Few-Shot 模仿已有代码默契，定制最具有原生适应性的项目约束。
3. **随 Git 全队流转**：
   Seeds、Rules 和 Skills 目录已放开 `.gitignore` 阻拦限制，一次一键集成，全队、任何开发人员 clone 下来均能直接获得极致顺滑的 AI Native 智能研发加持！
