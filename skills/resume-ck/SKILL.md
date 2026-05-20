---
name: resume-ck
description: Resume from the latest checkpoint using the global resume PowerShell command
---

# resume-ck

Use this in a fresh thread after `ck`.

## Canonical command

```powershell
cont
```

For the combined save+resume flow, use `cont`.

This reads the current repo's `.omx/state/context-checkpoint.json` and `.omx/notepad.md`.
