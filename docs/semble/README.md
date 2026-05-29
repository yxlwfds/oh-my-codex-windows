# semble_rs

Official repo: https://github.com/johunsang/semble_rs (Rust-optimized semantic code search, a fast alternative to Python's `semble`).

Use `semble_rs` for extremely fast semantic code search and related-file discovery.

## Usage

Use the compiled executable path directly: `D:\code\my\semble_rs\target\release\semble_rs.exe` or simply `semble_rs` if it is added to your system `PATH`.

### Search

```powershell
# Using absolute path
D:\code\my\semble_rs\target\release\semble_rs.exe search "authentication flow" ./my-project

# If added to PATH
semble_rs search "save model to disk" ./my-project --top-k 10
```

### Related code

```powershell
semble_rs find-related src/auth.py 42 ./my-project
```

`path` defaults to the current directory when omitted; git URLs are accepted.

## Workflow

1. Start with `semble_rs search` (or using full path) to find code by behavior, symbol name, or intent.
2. Use `semble_rs find-related` with a promising result's path and line number to find related implementations.
3. Open full files only when the snippet is not enough context.
4. Use grep only for exhaustive literal matches or quick confirmation of an exact string.

## Comparison with Python version

- **No Python environment / uvx overhead**: Running as a compiled Rust binary means sub-millisecond start time.
- **Fast Multithreaded Indexing**: Uses parallel processing in Rust to build BM25 + semantic vector indices.
- **No MCP configuration required**: Can be invoked directly as a CLI tool by agent subagents.
