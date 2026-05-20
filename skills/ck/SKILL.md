---
name: ck
description: Quick checkpoint handoff from the current repo using the global ck PowerShell command
---

# ck

Use this when you want to checkpoint the current repo quickly.

## Canonical command

```powershell
cont
```

If you need the explicit script path:

```powershell
D:\code\my\oh-my-codex\script\ck.ps1
```

For a one-shot save+resume flow, use `cont` or `D:\code\my\oh-my-codex\script\continue.ps1`.

Use `-Local` only when you need a same-thread summary.

## Workflow

1. Capture goal, done, open, risks, next, files, and commands.
2. Persist to `.omx/state/context-checkpoint.json` and `.omx/notepad.md`.
3. Return a tiny handoff summary.
4. In the next thread, use `resume-ck`.
