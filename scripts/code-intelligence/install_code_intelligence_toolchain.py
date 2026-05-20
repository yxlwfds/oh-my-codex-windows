#!/usr/bin/env python3
"""One-click installer for ast-grep + semble across Codex/Windsurf/Qoder."""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parent.parent.parent
TEMPLATES_DIR = REPO_ROOT / "templates" / "code-intelligence"

AST_GREP_SKILL_TEMPLATE = TEMPLATES_DIR / "ast-grep" / "SKILL.md"
SEMBLE_SKILL_TEMPLATE = TEMPLATES_DIR / "semble" / "SKILL.md"
AGENTS_ENTRY_TEMPLATE = TEMPLATES_DIR / "AGENTS-entry.md"
WINDSURF_GLOBAL_RULES_TEMPLATE = TEMPLATES_DIR / "windsurf-global-rules.md"
CODEX_GLOBAL_AGENTS_TEMPLATE = REPO_ROOT / "templates" / "AGENTS.md"
CLAUDE_GLOBAL_TEMPLATE = REPO_ROOT / "templates" / "CLAUDE.md"

AST_GREP_SKILL_NAME = "ast-grep"
SEMBLE_SKILL_NAME = "semble"
SEMBLE_MCP_NAME = "semble"
SEMBLE_MCP_COMMAND = ["uvx", "--from", "semble[mcp]", "semble"]

DEFAULT_CODEX_HOME = Path.home() / ".codex"
DEFAULT_CODEIUM_HOME = Path.home() / ".codeium"
DEFAULT_QODER_HOME = Path.home() / ".qoder"


def ensure_dir(path: Path) -> None:
    path.mkdir(parents=True, exist_ok=True)


def read_text(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def write_text(path: Path, content: str) -> None:
    ensure_dir(path.parent)
    path.write_text(content, encoding="utf-8")


def write_json(path: Path, payload: object) -> None:
    ensure_dir(path.parent)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def copy_file(src: Path, dst: Path, *, dry_run: bool) -> None:
    ensure_dir(dst.parent)
    if dry_run:
        print(f"[dry-run] copy {src} -> {dst}")
        return
    shutil.copy2(src, dst)


def command_exists(command: str) -> bool:
    return shutil.which(command) is not None


def run_windows_command(command: str, *, cwd: Path | None = None, dry_run: bool) -> subprocess.CompletedProcess[str]:
    full_cmd = ["cmd", "/c", command]
    if dry_run:
        display = " ".join(full_cmd)
        prefix = f" (cwd={cwd})" if cwd is not None else ""
        print(f"[dry-run] run {display}{prefix}")
        return subprocess.CompletedProcess(full_cmd, 0)
    return subprocess.run(
        full_cmd,
        cwd=str(cwd) if cwd is not None else None,
        text=True,
        capture_output=True,
    )


def codex_home() -> Path:
    return Path(os.environ.get("CODEX_HOME", str(DEFAULT_CODEX_HOME))).expanduser()


def codeium_home() -> Path:
    return Path(os.environ.get("CODEIUM_HOME", str(DEFAULT_CODEIUM_HOME))).expanduser()


def qoder_home() -> Path:
    return Path(os.environ.get("QODER_HOME", str(DEFAULT_QODER_HOME))).expanduser()


def project_skill_roots(project_root: Path) -> list[Path]:
    return [
        project_root / ".codex" / "skills",
        project_root / ".windsurf" / "skills",
        project_root / ".qoder" / "skills",
    ]


def global_skill_roots() -> list[Path]:
    return [
        codex_home() / "skills",
        codeium_home() / "windsurf" / "skills",
        codeium_home() / "windsurf-next" / "skills",
        qoder_home() / "skills",
    ]


def install_skill(skill_name: str, template: Path, roots: list[Path], *, dry_run: bool) -> None:
    for root in roots:
        copy_file(template, root / skill_name / "SKILL.md", dry_run=dry_run)


def ensure_project_agents_entry(project_root: Path, *, dry_run: bool) -> Path:
    agents_path = project_root / "AGENTS.md"
    snippet = read_text(AGENTS_ENTRY_TEMPLATE)

    if not agents_path.exists():
        if dry_run:
            print(f"[dry-run] create {agents_path}")
        else:
            write_text(agents_path, snippet)
        return agents_path

    current = read_text(agents_path)
    if "## code-intelligence toolchain" in current:
        return agents_path

    merged = current.rstrip() + "\n\n" + snippet
    if dry_run:
        print(f"[dry-run] append code-intelligence entry to {agents_path}")
    else:
        write_text(agents_path, merged)
    return agents_path


def ensure_codex_global_agents(*, dry_run: bool) -> Path:
    agents_path = codex_home() / "AGENTS.md"
    template = read_text(CODEX_GLOBAL_AGENTS_TEMPLATE)
    if agents_path.exists() and read_text(agents_path) == template:
        return agents_path

    if dry_run:
        print(f"[dry-run] sync {agents_path} from {CODEX_GLOBAL_AGENTS_TEMPLATE}")
    else:
        write_text(agents_path, template)
    return agents_path


def ensure_claude_global_guide(*, dry_run: bool) -> Path:
    claude_path = Path.home() / ".claude" / "CLAUDE.md"
    template = read_text(CLAUDE_GLOBAL_TEMPLATE)
    if claude_path.exists() and read_text(claude_path) == template:
        return claude_path

    if dry_run:
        print(f"[dry-run] sync {claude_path} from {CLAUDE_GLOBAL_TEMPLATE}")
    else:
        write_text(claude_path, template)
    return claude_path


def ensure_windsurf_global_rules(*, dry_run: bool) -> list[Path]:
    template = read_text(WINDSURF_GLOBAL_RULES_TEMPLATE)
    written: list[Path] = []
    for root in [codeium_home() / "windsurf", codeium_home() / "windsurf-next"]:
        rules_path = root / "memories" / "global_rules.md"
        if rules_path.exists() and read_text(rules_path) == template:
            written.append(rules_path)
            continue
        if dry_run:
            print(f"[dry-run] sync {rules_path} from {WINDSURF_GLOBAL_RULES_TEMPLATE}")
        else:
            write_text(rules_path, template)
        written.append(rules_path)
    return written


def update_toml_mcp_server(config_path: Path, server_name: str, *, dry_run: bool) -> Path:
    desired_block = [
        f"[mcp_servers.{server_name}]",
        f'command = "{SEMBLE_MCP_COMMAND[0]}"',
        f'args = {json.dumps(SEMBLE_MCP_COMMAND[1:])}',
        "",
    ]

    lines = read_text(config_path).splitlines() if config_path.exists() else []
    header = f"[mcp_servers.{server_name}]"
    start = next((idx for idx, line in enumerate(lines) if line.strip() == header), None)

    if start is None:
        if lines and lines[-1].strip():
            lines.append("")
        new_lines = lines + desired_block
    else:
        end = start + 1
        while end < len(lines) and not lines[end].startswith("["):
            end += 1
        new_lines = lines[:start] + desired_block[:-1] + lines[end:]

    new_text = "\n".join(new_lines).rstrip() + "\n"
    if dry_run:
        print(f"[dry-run] update {config_path} with TOML MCP server {server_name}")
    else:
        write_text(config_path, new_text)
    return config_path


def update_json_mcp_server(config_path: Path, server_name: str, payload: dict[str, object], *, dry_run: bool) -> Path:
    if config_path.exists():
        try:
            data = json.loads(read_text(config_path))
        except json.JSONDecodeError:
            data = {}
    else:
        data = {}

    if not isinstance(data, dict):
        data = {}

    mcp_servers = data.get("mcpServers")
    if not isinstance(mcp_servers, dict):
        mcp_servers = {}
    data["mcpServers"] = mcp_servers
    mcp_servers[server_name] = payload

    if dry_run:
        print(f"[dry-run] update {config_path} with MCP server {server_name}")
    else:
        write_json(config_path, data)
    return config_path


def install_codex_mcp(*, dry_run: bool) -> Path:
    if dry_run:
        print(f"[dry-run] ensure codex MCP server {SEMBLE_MCP_NAME}")
        return codex_home() / "config.toml"

    if command_exists("codex"):
        result = run_windows_command(f"codex mcp get {SEMBLE_MCP_NAME}", dry_run=dry_run)
        if result.returncode != 0:
            run_windows_command(
                'codex mcp add semble -- uvx --from "semble[mcp]" semble',
                dry_run=dry_run,
            )
        return codex_home() / "config.toml"

    config_path = codex_home() / "config.toml"
    ensure_dir(config_path.parent)
    return update_toml_mcp_server(config_path, SEMBLE_MCP_NAME, dry_run=dry_run)


def install_windsurf_mcp(*, dry_run: bool) -> list[Path]:
    written: list[Path] = []
    payload = {
        "command": SEMBLE_MCP_COMMAND[0],
        "args": SEMBLE_MCP_COMMAND[1:],
        "disabled": False,
    }
    for root in [codeium_home() / "windsurf", codeium_home() / "windsurf-next"]:
        config_path = root / "mcp_config.json"
        written.append(update_json_mcp_server(config_path, SEMBLE_MCP_NAME, payload, dry_run=dry_run))
    return written


def install_qoder_user_mcp(*, dry_run: bool) -> Path:
    if dry_run:
        print(f"[dry-run] ensure qoder MCP server {SEMBLE_MCP_NAME} (scope=user)")
        return qoder_home() / ".qoder.json"

    if command_exists("qodercli"):
        result = run_windows_command(
            f"qodercli mcp get {SEMBLE_MCP_NAME} -s user",
            dry_run=dry_run,
        )
        if result.returncode != 0:
            run_windows_command(
                f'qodercli mcp add {SEMBLE_MCP_NAME} uvx --from "semble[mcp]" semble -s user -t stdio',
                dry_run=dry_run,
            )
        return qoder_home() / ".qoder.json"

    payload = {
        "command": SEMBLE_MCP_COMMAND[0],
        "args": SEMBLE_MCP_COMMAND[1:],
        "type": "stdio",
    }
    return update_json_mcp_server(qoder_home() / ".qoder.json", SEMBLE_MCP_NAME, payload, dry_run=dry_run)


def install_qoder_project_mcp(project_root: Path, *, dry_run: bool) -> Path:
    if dry_run:
        print(f"[dry-run] ensure qoder MCP server {SEMBLE_MCP_NAME} (scope=project)")
        return project_root / ".mcp.json"

    if command_exists("qodercli"):
        result = run_windows_command(
            f"qodercli mcp get {SEMBLE_MCP_NAME} -s project -w {project_root}",
            dry_run=dry_run,
        )
        if result.returncode != 0:
            run_windows_command(
                f'qodercli mcp add {SEMBLE_MCP_NAME} uvx --from "semble[mcp]" semble -s project -t stdio -w {project_root}',
                dry_run=dry_run,
            )
        return project_root / ".mcp.json"

    payload = {
        "command": SEMBLE_MCP_COMMAND[0],
        "args": SEMBLE_MCP_COMMAND[1:],
        "type": "stdio",
    }
    return update_json_mcp_server(project_root / ".mcp.json", SEMBLE_MCP_NAME, payload, dry_run=dry_run)


def install_project(project_root: Path, *, dry_run: bool) -> None:
    ensure_project_agents_entry(project_root, dry_run=dry_run)
    install_skill(AST_GREP_SKILL_NAME, AST_GREP_SKILL_TEMPLATE, project_skill_roots(project_root), dry_run=dry_run)
    install_skill(SEMBLE_SKILL_NAME, SEMBLE_SKILL_TEMPLATE, project_skill_roots(project_root), dry_run=dry_run)
    install_qoder_project_mcp(project_root, dry_run=dry_run)


def install_global(*, dry_run: bool) -> None:
    ensure_codex_global_agents(dry_run=dry_run)
    ensure_claude_global_guide(dry_run=dry_run)
    ensure_windsurf_global_rules(dry_run=dry_run)
    install_skill(AST_GREP_SKILL_NAME, AST_GREP_SKILL_TEMPLATE, global_skill_roots(), dry_run=dry_run)
    install_skill(SEMBLE_SKILL_NAME, SEMBLE_SKILL_TEMPLATE, global_skill_roots(), dry_run=dry_run)
    install_codex_mcp(dry_run=dry_run)
    install_windsurf_mcp(dry_run=dry_run)
    install_qoder_user_mcp(dry_run=dry_run)


def main() -> int:
    parser = argparse.ArgumentParser(description="Install ast-grep + semble toolchain")
    parser.add_argument("--project-root", help="Project root to integrate into")
    parser.add_argument("--skip-project", action="store_true", help="Skip project-local integration")
    parser.add_argument("--skip-global", action="store_true", help="Skip global integration")
    parser.add_argument("--dry-run", action="store_true", help="Print actions without writing files")
    args = parser.parse_args()

    if args.skip_project and args.skip_global:
        print("Nothing to do: both --skip-project and --skip-global were set.")
        return 0

    project_root = Path(args.project_root).expanduser().resolve() if args.project_root else Path.cwd().resolve()

    if not args.skip_project:
        install_project(project_root, dry_run=args.dry_run)
    if not args.skip_global:
        install_global(dry_run=args.dry_run)

    print("Done.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
