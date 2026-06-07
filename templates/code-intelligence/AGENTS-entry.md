## code-intelligence toolchain

- `ast-grep`: use `sg` / `ast-grep` for syntax-aware search and rewrite.
- **Fast Context Router**:
  - **Fast Track (LSP/grep)**: **Default First Priority**. Always attempt to locate code symbols, exact file names, or short queries (< 30 chars) using the IDE's built-in LSP, grep, or fast context first.
  - When Fast Context is not enough, use `ast-grep` for syntax-aware structural search before考虑引入任何额外的代码智能工具。
- When editing `AGENTS.md` or any template that generates it, preserve meaningful existing content unless this entry is explicitly replacing that section.

Public docs:
- `D:\code\my\oh-my-codex\docs\ast-grep\README.md`
