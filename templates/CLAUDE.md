# User-level Claude Guide

This is the machine-wide fallback for Claude Code. Repo-local `CLAUDE.md` / `AGENTS.md` files still win.

## Global defaults

- Prefer `ast-grep` for syntax-aware search and structural rewrites when available.
- Prefer `semble` for semantic search and indexing when available.
- When editing `CLAUDE.md` or any template that generates it, preserve meaningful existing content unless the new text is an explicit replacement; prefer additive refinement over deletion.
- Keep global guidance short; let repo-local instructions carry project-specific detail.
- Canonical source for this rule set: `D:\code\my\oh-my-codex\templates\CLAUDE.md`.
