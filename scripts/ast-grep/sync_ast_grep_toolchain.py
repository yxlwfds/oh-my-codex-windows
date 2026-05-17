#!/usr/bin/env python3
"""Sync ast-grep toolchain files from the oh-my-codex repo."""

from __future__ import annotations

import argparse
import os
import shutil
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parent.parent.parent
SKILL_NAME = "ast-grep"
DEFAULT_CODEX_HOME = Path.home() / ".codex" / "skills"
DEFAULT_DEEPSEEK_HOME = Path.home() / ".deepseek"
DEFAULT_OMX_ROOT = Path(r"D:\code\my\oh-my-codex")

DOCS_DIR = REPO_ROOT / "docs" / SKILL_NAME
TEMPLATES_DIR = REPO_ROOT / "templates" / SKILL_NAME

DOC_QUICK_COMMANDS = DOCS_DIR / "quick-commands.md"
DOC_README = DOCS_DIR / "README.md"
DOC_AGENTS_ENTRY = DOCS_DIR / "agents-entry.md"
DOC_NEW_PROJECT_TEMPLATE = DOCS_DIR / "new-project-template.md"
DOC_SYNC_ONE_COMMAND = DOCS_DIR / "sync-one-command.md"

TEMPLATE_README = TEMPLATES_DIR / "README.md"
TEMPLATE_AGENTS_ENTRY = TEMPLATES_DIR / "AGENTS-entry.md"
TEMPLATE_NEW_PROJECT_TEMPLATE = TEMPLATES_DIR / "ast-grep-new-project-template.md"

OHMX_SCRIPT = REPO_ROOT / "scripts" / SKILL_NAME / "sync_ast_grep_toolchain.ps1"
DEEPSEEK_INSTRUCTIONS_SOURCE = DOC_README


def ensure_dir(path: Path) -> None:
    path.mkdir(parents=True, exist_ok=True)


def copy_file(src: Path, dst: Path) -> Path:
    ensure_dir(dst.parent)
    shutil.copy2(src, dst)
    return dst


def resolve_codex_target(target: str | None) -> Path:
    if target:
        return Path(target).expanduser().resolve()
    codex_home = os.environ.get("CODEX_HOME")
    if codex_home:
        return (Path(codex_home).expanduser() / "skills").resolve()
    return DEFAULT_CODEX_HOME.resolve()


def resolve_deepseek_home(target: str | None) -> Path:
    if target:
        return Path(target).expanduser().resolve()
    return DEFAULT_DEEPSEEK_HOME.resolve()


def resolve_ohmx_root(target: str | None) -> Path:
    if target:
        return Path(target).expanduser().resolve()
    env_root = os.environ.get("OH_MY_CODEX_ROOT")
    if env_root:
        return Path(env_root).expanduser().resolve()
    return DEFAULT_OMX_ROOT.resolve()


def sync_codex(target_dir: Path) -> list[Path]:
    skill_dir = target_dir / SKILL_NAME
    ensure_dir(skill_dir)
    written = [copy_file(OHMX_SCRIPT, skill_dir / "sync_ast_grep_toolchain.ps1")]
    return written


def sync_deepseek(deepseek_home: Path) -> list[Path]:
    ensure_dir(deepseek_home)
    written = [copy_file(DEEPSEEK_INSTRUCTIONS_SOURCE, deepseek_home / "ast-grep-instructions.md")]
    config_path = deepseek_home / "config.toml"
    if config_path.is_file():
        text = config_path.read_text(encoding="utf-8")
    else:
        text = 'default_text_model = "deepseek-v4-pro"\nreasoning_effort = "auto"\n'
    desired = f'instructions = "{(deepseek_home / "ast-grep-instructions.md").as_posix()}"'
    lines = text.splitlines()
    replaced = False
    for idx, line in enumerate(lines):
        if line.strip().startswith("instructions = "):
            lines[idx] = desired
            replaced = True
            break
    if not replaced:
        lines.extend(["", desired])
    config_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    written.append(config_path)
    return written


def sync_ohmx(ohmx_root: Path) -> list[Path]:
    written: list[Path] = []
    written.append(copy_file(DOC_QUICK_COMMANDS, ohmx_root / "docs" / SKILL_NAME / "quick-commands.md"))
    written.append(copy_file(DOC_README, ohmx_root / "docs" / SKILL_NAME / "README.md"))
    written.append(copy_file(DOC_SYNC_ONE_COMMAND, ohmx_root / "docs" / "ast-grep-sync-one-command.md"))
    written.append(copy_file(TEMPLATE_README, ohmx_root / "templates" / SKILL_NAME / "README.md"))
    written.append(copy_file(TEMPLATE_AGENTS_ENTRY, ohmx_root / "templates" / SKILL_NAME / "AGENTS-entry.md"))
    written.append(copy_file(TEMPLATE_NEW_PROJECT_TEMPLATE, ohmx_root / "templates" / SKILL_NAME / "ast-grep-new-project-template.md"))
    return written


def sync_new_project_package(target_dir: Path) -> list[Path]:
    ensure_dir(target_dir)
    package_readme = target_dir / "README.md"
    package_readme.write_text(
        "# ast-grep package\n\n"
        "- Public quick commands: docs/ast-grep/quick-commands.md\n"
        "- Paste `AGENTS-entry.md` into the new repo root `AGENTS.md`.\n"
        "- Use `ast-grep-new-project-template.md` as the bootstrap note.\n",
        encoding="utf-8",
    )
    return [
        copy_file(TEMPLATE_AGENTS_ENTRY, target_dir / "AGENTS-entry.md"),
        copy_file(TEMPLATE_NEW_PROJECT_TEMPLATE, target_dir / "ast-grep-new-project-template.md"),
        package_readme,
    ]


def sync_all(codex_target: Path, deepseek_home: Path, ohmx_root: Path) -> list[Path]:
    written: list[Path] = []
    written.extend(sync_codex(codex_target))
    written.extend(sync_deepseek(deepseek_home))
    written.extend(sync_ohmx(ohmx_root))
    return written


def main() -> int:
    parser = argparse.ArgumentParser(description="Sync ast-grep toolchain files")
    parser.add_argument("--codex-target", help="Codex skills directory")
    parser.add_argument("--deepseek-home", help="DeepSeek TUI home directory")
    parser.add_argument("--ohmycodex-root", help="oh-my-codex repo root")
    parser.add_argument("--new-project-package", help="Write a new-project package directory")
    parser.add_argument("--all-defaults", action="store_true", help="Sync all default targets")
    args = parser.parse_args()

    codex_target = resolve_codex_target(args.codex_target)
    deepseek_home = resolve_deepseek_home(args.deepseek_home)
    ohmx_root = resolve_ohmx_root(args.ohmycodex_root)

    written: list[Path] = []
    if args.all_defaults:
        written.extend(sync_all(codex_target, deepseek_home, ohmx_root))
    else:
        written.extend(sync_codex(codex_target))
        written.extend(sync_deepseek(deepseek_home))
        written.extend(sync_ohmx(ohmx_root))

    if args.new_project_package:
        written.extend(sync_new_project_package(Path(args.new_project_package).expanduser().resolve()))

    for path in written:
        print(path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
