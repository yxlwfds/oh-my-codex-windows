## code-intelligence toolchain

- `ast-grep`: use `sg` / `ast-grep` for syntax-aware search and rewrite.
- `semble_rs`: use `semble_rs search` and `semble_rs find-related` for semantic code search. Command is `semble_rs` or absolute path `D:\code\my\semble_rs\target\release\semble_rs.exe`.
  - **Fast Context Dual-Track Router**:
    - **Fast Track (LSP/grep)**: **Default First Priority**. Always attempt to locate code symbols, exact file names, or short queries (< 30 chars) using the IDE's built-in LSP, grep, or fast context first.
    - **Semantic Track (semble_rs)**: For abstract natural language, fuzzy intent, or complex logical queries where Fast Track fails or is insufficient, upgrade to the `semble_rs` command with `--use-sketches` (e.g., `semble_rs search "YOUR_QUERY" . --use-sketches`). It utilizes LLM signature translation and RRF multi-way fusion, automatically ignoring noise via the similarity cutoff (`MIN_SEMANTIC_SIMILARITY: 0.25`).
- When editing `AGENTS.md` or any template that generates it, preserve meaningful existing content unless this entry is explicitly replacing that section.

Public docs:
- `D:\code\my\oh-my-codex\docs\ast-grep\README.md`
- `D:\code\my\oh-my-codex\docs\semble\README.md`
