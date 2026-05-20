# Code Intelligence Toolchain

Source of truth for the `ast-grep` + `semble` toolchain.

```powershell
.\scripts\code-intelligence\install_code_intelligence_toolchain.ps1
.\scripts\code-intelligence\install_code_intelligence_toolchain.ps1 -ProjectRoot D:\path\to\repo
```

Installs:

- `.codex/skills`
- `.windsurf/skills`
- `.qoder/skills`
- project-local agent bridge entries when supported

Global roots: Codex `$CODEX_HOME\skills`, Windsurf `$CODEIUM_HOME\windsurf\skills`, Qoder `$QODER_HOME\skills`.
