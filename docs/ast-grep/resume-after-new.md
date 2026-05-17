# ast-grep 续接说明

## 当前最终结构

### 公共资源（单一来源）
- 速查表：`D:\code\my\oh-my-codex\docs\ast-grep\quick-commands.md`
- 公共索引：`D:\code\my\oh-my-codex\docs\ast-grep\README.md`
- Windsurf 入口：`D:\code\my\oh-my-codex\docs\ast-grep\windsurf-entry.md`
- Qoder 入口：`D:\code\my\oh-my-codex\docs\ast-grep\qoder-entry.md`
- 模板：`D:\code\my\oh-my-codex\templates\ast-grep\`
- 同步脚本：`D:\code\my\oh-my-codex\scripts\ast-grep\sync_ast_grep_toolchain.ps1`

### 当前项目薄入口
- `D:\code\zq\guanghe-cloud\AGENTS.md`
- `D:\code\zq\guanghe-cloud\.windsurf\skills\ast-grep\SKILL.md`
- `D:\code\zq\guanghe-cloud\.windsurf\rules\ast-grep.md`
- `D:\code\zq\guanghe-cloud\.qoder\skills\ast-grep\SKILL.md`

## 续接规则

1. 新会话从这份文档开始，不要再复制正文到项目里。
2. 任何新项目优先只引用公共速查表和公共模板。
3. Windsurf / Qoder / 项目 AGENTS 都只做薄壳入口。
4. 如果要继续优化，优先改 `D:\code\my\oh-my-codex` 的公共入口，而不是项目侧重复文件。

## 可直接继续的下一步
- 若要新增其他工具链，复制同样的“公共单一来源 + 薄入口”模式。
- 若要整理成新项目接入包，优先改 `D:\code\my\oh-my-codex\scripts\ast-grep\sync_ast_grep_toolchain.py`。
