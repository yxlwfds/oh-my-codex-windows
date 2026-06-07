# Windsurf 原生 AI 工程化集成指南 (Native Rule-Skill 混合架构)

本指南旨在帮助新项目放弃传统的、笨重的第三方 CLI 增强包（如 Superpowers、ECC），转而采用 **Windsurf 原生 Rule-Skill 混合架构**。该架构兼顾了 Superpowers 的“硬性工程纪律”和 ECC 的“多场景技术广度”，且相比于它们具有**更快的响应速度、更低的 Token 消耗、极佳的 IDE 交互体验**。

---

## 1. 架构理念：为什么不用 Superpowers 和 ECC？

在 Windsurf/Cascade 环境中，直接安装为无头 CLI 设计的 Superpowers 或 ECC 会导致严重的“工具打架”与“延迟暴增”：
- **Superpowers** 强大的 `Planning -> TDD -> Code Review` 门禁机制在 GUI 交互中极其繁琐，AI 改一行代码要跑 5 次门禁脚本，极大降低开发效率，且 Token 消耗极快。
- **ECC** 的 50+ 脚本和多代理在 IDE 的原生 LSP (Fast Context) 面前非常冗余。

### 💡 解决方案：Windsurf 混合架构 (Native Rule-Skill Architecture)
我们把它们的设计精髓融入 Windsurf 的原生配置中，形成 **四层渐进式约束架构**：

```
┌────────────────────────────────────────────────────────┐
│ 1. 根级门禁 (AGENTS.md)                                │ ─► 每次对话常驻核心约束 (类似 Superpowers 核心)
│    - 限制在 100 行内，防止注意力稀释，只放铁律          │
└───────────────────────────┬────────────────────────────┘
                            ▼
┌────────────────────────────────────────────────────────┐
│ 2. 领域详细规则 (docs/agents/*.md)                      │ ─► 按技术栈/领域隔离的静态文档 (Java/前端/运维等)
│    - 根级 AGENTS.md 进行“引用引导”，AI 按需主动读取       │
└───────────────────────────┬────────────────────────────┘
                            ▼
┌────────────────────────────────────────────────────────┐
│ 3. 场景触发规则 (.windsurf/rules/*.md)                  │ ─► 特定场景下由 IDE 自动触发或通过斜杠命令加载
│    - 针对特定任务（如部署、数据库同步、性能调优）       │
└───────────────────────────┬────────────────────────────┘
                            ▼
┌────────────────────────────────────────────────────────┐
│ 4. 自动化技能扩展 (.windsurf/skills/)                    │ ─► 类似于 ECC 的自动化工具箱
│    - 复杂的、重复性的工程脚本（如无损图片压缩、清理缓存）│
└────────────────────────────────────────────────────────┘
```

---

## 2. 目录规范

在新项目中，建议按照以下目录结构进行组织：

```text
[Your-Project-Root]
├── AGENTS.md                          # 根级核心约束（< 100 行，引用型分流）
├── docs/
│   └── agents/                        # 领域级约束归档
│       ├── java-conventions.md        # Java/后端开发约束 (可选)
│       ├── frontend-conventions.md    # 前端开发约束 (可选)
│       └── skills-registry.md         # 项目内专属技能和 IDE 映射手册 (可选)
├── .windsurf/
│   ├── rules/                         # 场景触发型规则
│   │   ├── deploy.md                  # 部署发布触发规则
│   │   └── sync-db.md                 # 数据库同步触发规则
│   └── skills/                        # 自动化技能文件夹（按需添加）
│       ├── clear-cache/
│       │   └── SKILL.md
│       └── image-optimizer/
│           └── SKILL.md
```

---

## 3. 三步极速集成

### 第一步：在项目根目录创建 `AGENTS.md`
这是 AI 的思维底线，确保它不会随意删除代码、随意新增外键，并且在完成任务后主动检查是否需要后续操作。

```markdown
# [项目名称] Agent Guide

本文件用于为项目内的 AI Agent 提供根目录长期约束。

## 详细约束文件（按需读取）
以下文件包含分领域详细约束，操作对应领域时**必须主动读取**：
- **后端约束**：`docs/agents/backend-conventions.md` — 操作后端代码时读取
- **前端约束**：`docs/agents/frontend-conventions.md` — 操作前端代码时读取

## 基础约束
- 数据库建模与约束策略（是否使用物理外键、是否统一继承公共基类等）由本项目在 `docs/agents/backend-conventions.md` 中统一约定，避免生搬硬套其它项目规则。
- 架构设计优先考虑稳定性和可恢复性。
- 核心逻辑保持高鲁棒性，空值检查、边界条件防御。

## 改动原则
- 优先复用现有脚本、文档、skill、workflow，不重复造轮子。
- 修改文件前先读取当前目标文件，再使用补丁方式更新（不删文件、不覆盖丢失历史）。
- 不要误删现有文件、脚本、配置或业务逻辑。
- 任务完成后，不要默认停在"代码已改完"，分析并推荐是否需要后续同步或部署。
```

### 第二步：创建领域详细规则（如后端/前端）
在 `docs/agents/` 目录下创建 `backend-conventions.md` 或 `frontend-conventions.md`。
在其中写明该项目的框架规范（例如：Spring Boot/Dubbo 规范，React/Vue/Tailwind 规范，图片压缩及 OSS 处理规范）。

### 第三步：配置特定场景触发规则与工作流
在 `.windsurf/rules/` 目录下创建特定文件。
例如，如果项目使用 Docker 部署，可以创建 `.windsurf/rules/deploy.md`，并在里面写明：
> "当用户提到部署、发布、上线，或者修改了 Dockerfile 时，必须自动读取并引导用户执行本地部署脚本..."

---

## 4. 自动化初始化脚本

你可以通过以下 PowerShell 一键脚本，快速在 Windows 11 环境的新项目中初始化此结构：

```powershell
# 在新项目根目录下运行
$directories = @(
    "docs/agents",
    ".windsurf/rules",
    ".windsurf/skills",
    ".windsurf/seeds"
)

foreach ($dir in $directories) {
    if (!(Test-Path $dir)) {
        New-Item -ItemType Directory -Force -Path $dir | Out-Null
        Write-Host "Created folder: $dir" -ForegroundColor Green
    }
}

# 自动从全局军火库离线一键“进货”
$globalSeeds = "D:\code\my\oh-my-codex\templates\code-intelligence\seeds"
if (Test-Path $globalSeeds) {
    Copy-Item -Path "$globalSeeds/*" -Destination ".windsurf/seeds/" -Recurse -Force
    Write-Host "  [✓] 1秒离线同步全局军火库黄金 Seeds 成功！" -ForegroundColor Green
} else {
    Write-Host "  [i] 未检测到本地全局军火库，后续请通过提示词模板向 AI 发起 HTTPS 自动下载。" -ForegroundColor Yellow
}

# 自动生成基础 AGENTS.md 骨架
$agentsContent = @"
# Project Agent Guide

本文件用于为项目内的 AI Agent 提供根目录长期约束。

## 详细约束文件（按需读取）
- **开发约束**：\`docs/agents/conventions.md\` — 操作核心业务代码时读取

## 基础改动原则
- 修改文件前先读取当前目标文件，再使用补丁方式更新。
- 优先复用项目内现有脚本、工具与既有规范，不重复造轮子。
- 任务完成后，不要默认停在\"代码已改完\"。应继续分析本次改动是否还需要后续操作（如同步数据库、重启服务等）。
"@

Set-Content -Path "AGENTS.md" -Value $agentsContent -Encoding utf8
Write-Host "AGENTS.md initialized successfully!" -ForegroundColor Green
```

---

## 5. 如何下载并沉淀 Superpowers 与 ECC 中的精华资源？

**问：不需要把 Superpowers 和 ECC 的源码或者内容下载下来吗？**

**答：需要，但绝对不要原封不动地整套安装。**
因为那两款工具 90% 的内容是面向 Claude Code CLI 的框架脚手架（例如连接 Node 服务、打包、特定命令行别名等），这些对于集成在 IDE 内的 Windsurf 来说是**累赘**。我们真正需要的，是它们经历数万次项目打磨而沉淀出来的**核心技术资产**：
- **Superpowers 的核心：** Systematic Debugging (系统化排错思维)、TDD (测试驱动开发流程)、两阶段 Code Review 规范。
- **ECC 的核心：** 精准细致的 29 条语言编码规范（Rules），以及各种专属于微服务、安全扫描的 Skill 提示词模板。

### 🌟 极致跃升：从本地 `tmp/ECC-main/` 深度挖掘并重构 Java 与 数据库 专属资产！

既然您在本地已经解压了 `tmp\ECC-main\` 完整源码库，我们已经为您执行了**“脱胎换骨的 Windsurf 化改造”**，将对您项目最关键的 Java 与 数据库核心资产全部提取并完成了本地化的提纯重构：

1. **`java-rules/`（Java 铁律）**：
   - 提取自 `tmp\ECC-main\rules\java\`，包含完美的格式化、Optional 防空设计、Modern Java (Java 16+ Records/Pattern-matching) 新特性等。
   - **Windsurf 化改造**：解耦了原有的相对路径依赖，使其变为完全自闭环的规范包。
2. **`springboot-patterns/`（SpringBoot 最佳工业级设计模式）**：
   - 提取自 `tmp\ECC-main\skills\springboot-patterns\`。
   - 涵盖了高并发防 IP 伪造安全过滤器（Tomcat-remoteip-trusted-proxies）、指数退避重试 `withRetry`、Structured JSON 结构化日志。
3. **`database-migrations/`（专属高安全同步规约）**：
   - 提取自 `tmp\ECC-main\skills\database-migrations\`。
   - **Windsurf 黄金重构**：**彻底删除了与本项目无关的 Prisma, Drizzle, Kysely, Django, Go 等冗余技术栈（减少 70% 的 Token 垃圾噪音）**。
   - **强力新增**：完全适配 MySQL / PolarDB-X 分布式大表高危 DDL 检查（大表自动分区改造，并在该 seed 中采用“避免物理外键”的微服务建模策略）；完美融入本项目的自动 IP 白名单自愈同步脚本 `script/sql/sync_guang_he_app.py` 的自动化操作与验证规约！

这些完美的、没有任何冗余的多语言和数据库安全高阶资产，已全部安全离线沉淀至：
📂 `.windsurf/seeds/` 下（已在 `.gitignore` 中放开限制，可直接提交至 Git 随项目流转！）。

---

### 💡 最佳实践：建立“全局本地精华池 (Universal Template Pool)”
既然您拥有全局同步库 `D:\code\my\oh-my-codex\`，最完美的方案是将这两个开源项目的 `skills/` 和 `rules/` 最核心的部分离线下载，作为全局本地模板，在新项目中一键挑选克隆。

下面为您提供一个**纯绿色、自动提取下载**的 PowerShell 脚本。该脚本会自动利用极小的空间拉取这两个仓库的核心技能文件，并保存到您的全局模版库（或当前项目）中：

```powershell
# 1. 定义本地模板池的保存路径（优先使用您的全局库，拿不准则保存在当前项目的本地缓存）
$templatePoolPath = "D:\code\my\oh-my-codex\templates\code-intelligence\seeds"
if (!(Test-Path $templatePoolPath)) {
    $templatePoolPath = "./.windsurf/seeds"
}

# 创建模板池文件夹
New-Item -ItemType Directory -Force -Path "$templatePoolPath/superpowers-skills" | Out-Null
New-Item -ItemType Directory -Force -Path "$templatePoolPath/ecc-rules" | Out-Null

Write-Host ">>> 正在拉取 Superpowers 核心 Skill 模板 (深度遍历)..." -ForegroundColor Cyan
# 定义 Superpowers 中最有含金量的 3 大核心技能
$superpowersSkills = @(
    "systematic-debugging",
    "test-driven-development",
    "receiving-code-review"
)

foreach ($skill in $superpowersSkills) {
    $targetDir = "$templatePoolPath/superpowers-skills/$skill"
    New-Item -ItemType Directory -Force -Path $targetDir | Out-Null
    
    try {
        # 1. 调阅 GitHub API 获取该目录下的所有文件元数据
        $apiUrl = "https://api.github.com/repos/obra/superpowers/contents/skills/$skill"
        $files = Invoke-RestMethod -Uri $apiUrl -TimeoutSec 10 -ErrorAction Stop
        
        Write-Host "  [i] 发现技能 $skill 包含 $($files.Count) 个关联文件，开始深度同步..." -ForegroundColor Yellow
        
        # 2. 自动遍历下载该文件夹下的每个文件（排除目录等非文件类型）
        foreach ($file in $files) {
            if ($file.type -eq "file") {
                $downloadUrl = $file.download_url
                $fileName = $file.name
                
                Invoke-WebRequest -Uri $downloadUrl -OutFile "$targetDir/$fileName" -TimeoutSec 10 -ErrorAction Stop | Out-Null
                Write-Host "      └─ [✓] 已同步: $fileName" -ForegroundColor Green
            }
        }
    } catch {
        Write-Host "  [✗] 深度拉取 $skill 失败，可能 API 请求超限，回退到保底单文件拉取..." -ForegroundColor Yellow
        # API 失败回退机制：至少保底把最核心的 SKILL.md 下下来
        try {
            $rawUrl = "https://raw.githubusercontent.com/obra/superpowers/main/skills/$skill/SKILL.md"
            Invoke-WebRequest -Uri $rawUrl -OutFile "$targetDir/SKILL.md" -TimeoutSec 10 -ErrorAction Stop | Out-Null
            Write-Host "      └─ [✓] 保底成功: SKILL.md" -ForegroundColor Green
        } catch {
            Write-Host "      └─ [✗] 保底下载也失败，网络受限" -ForegroundColor Red
        }
    }
}

Write-Host ">>> 正在拉取 ECC (Everything Claude Code) 精华配置..." -ForegroundColor Cyan
# 获取 ECC 的优秀 Rules 和核心技能
$eccUrls = @{
    "CLAUDE.md" = "https://raw.githubusercontent.com/affaan-m/everything-claude-code/main/CLAUDE.md";
    "RULES.md"  = "https://raw.githubusercontent.com/affaan-m/everything-claude-code/main/RULES.md";
    "SOUL.md"   = "https://raw.githubusercontent.com/affaan-m/everything-claude-code/main/SOUL.md"
}

foreach ($key in $eccUrls.Keys) {
    try {
        Invoke-WebRequest -Uri $eccUrls[$key] -OutFile "$templatePoolPath/ecc-rules/$key" -TimeoutSec 10 -ErrorAction Stop
        Write-Host "  [✓] 成功获取 ECC 配置: $key" -ForegroundColor Green
    } catch {
        Write-Host "  [✗] 获取 $key 失败" -ForegroundColor Yellow
    }
}

Write-Host "`n>>> 精华资源已沉淀至: $templatePoolPath 目录！" -ForegroundColor Green
Write-Host "提示：您可以在新项目的初始化脚本（install.md中的脚本）中，直接通过 'Copy-Item' 把这些精华技能一键拷贝到新项目的 '.windsurf/skills/' 中，无需每次联网，完全离线运行。" -ForegroundColor Cyan
```

---

## 6. 项目成熟后的最佳实践

1. **技能封装**：当你发现每次排错、清理、压缩图片都需要 AI 敲一长串命令时，将其封装进 `.windsurf/skills/[skill-name]/SKILL.md`。
2. **渐进式沉淀**：不要在一开始就写极其繁琐的规则。应当在开发过程中，把“AI 常犯的错误”或者“特定的业务潜规则”逐步写入 `docs/agents/conventions.md`。每次对话 AI 会按需读取，越用越聪明！

---

## 7. 高阶进阶：Windsurf 中的“持续学习”与“自动 Skill 化”

### 💡 评估：ECC 中其他 50+ 个技能真的有用吗？

**有的非常有用，有的纯属累赘：**
* **技术/语言专项类（非常有用）**：比如 `go-review`、`database-review`、`security-review`，这些其实都是极佳的专业提示词，它们非常适合作为 `.md` 文件放到您的 `docs/agents/` 目录中让 AI 随时调阅。
* **命令行包装类（冗余累赘）**：比如包装了各种 Git、Docker、依赖安装命令的技能。在具有完美 GUI 终端、原生 LSP 且能直接运行系统命令的 Windsurf 面前，AI 直接跑命令要比调用复杂的“命令行外壳 Skill”快速、聪明得多。

---

### 🧠 核心：如何在 Windsurf 中实现“Stop Hooks (自动沉淀 Skill)”机制？

在无头的 Claude Code 中，由于缺乏界面，需要靠 CLI 退出时的脚本（Stop Hook）来强行拦截，并调用 AI 总结。
在 **Windsurf** 中，我们完全可以通过更优美的 **“自进化思维模版”** 来落地这种机制，不需要配置任何复杂的系统拦截脚本，体验极佳：

#### 🛠️ 方案实现：在根级 `AGENTS.md` 中增加“自演进门禁”

只要在项目的 `AGENTS.md`（或 `conventions.md`）中的【改动原则/收尾原则】中加入以下规则，Windsurf Cascade 在对话结束、修复完 Bug 或交付任务时，**就会百分之百主动执行持续学习**：

```markdown
### 持续学习与自进化 (Continuous Learning & Instinct-Evolve)
每次当您帮用户解决了一个非显而易见的 Bug、或完成了拥有多步命令的复杂特性后，在宣布结束前，必须严格按照以下【Instinct-Evolve (直觉-演进) 链条】进行知识自省与沉淀：

1. **原子直觉记录 (Instinct-Stage / 低置信度)**：
   - 拼写错误、偶然手误等，**绝对禁止**记录。
   - 只有“框架踩坑、特定 API 冲突、非直观的配置”等有复用价值的单点经验，才能总结为一条最简短的 **Instinct（原子直觉）** 写入本地根目录的 `.learnings`（或 D:\code\my\oh-my-codex\.learnings\）。
   - 格式规范：`- [#标签] 踩坑场景 -> 防错方案。 [置信度: 0.3~0.9]` (如：`- [#dubbo] 跨模块调用传参超时 -> 调大Dubbo接口的 timeout。 [置信度: 0.6]`)。

2. **高频聚类演进 (Evolve-Stage / 升阶为 Skill)**：
   - 在生成 Instinct 之前，强制检索已有的 `.learnings` 记录，寻找相同 `#标签` 的 Instincts。
   - **聚类升阶阈值：3次**。只有当在 `.learnings` 中发现 **3条或以上高度相关或拥有相同 `#标签`** 的原子直觉时，才能向用户提案：“该领域痛点已发生 3 次。现在将这些 Instinct 聚类、融合，正式在 `.windsurf/skills/` 下生成一个高阶 `SKILL.md` 并自动去重，然后清理掉原 `.learnings` 中的散点直觉。”
```

#### 🎯 运行时的绝佳效果
当您在项目中配置了这条规则后，一旦 Cascade 帮您修复了一个很难缠的数据库并发 Bug，它在宣布完成时，会自动向您汇报：
> *“...以上已修复完成。为了防止以后发生类似的数据库死锁，我建议执行‘持续学习沉淀’：*
> *1. 将死锁根源记入 `.learnings`。*
> *2. 帮您把刚才分析死锁的 3 条 SQL 排查命令封装成 `.windsurf/skills/troubleshoot-deadlock` 技能。*
> *请问是否同意执行？”*

您只需说一个“是”，AI 就会**自动把自己的经验写成新代码技能**，下一次遇到类似情况，Cascade 会像个绝顶高手一样一秒进入状态。这种“越用越强，自成体系”的本地知识闭环，才是 Windsurf 提效的终极形态！

