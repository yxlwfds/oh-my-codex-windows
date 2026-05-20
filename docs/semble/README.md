# semble

Official repo: https://github.com/MinishLab/semble

Use Semble for semantic code search.

## Search

```powershell
semble search "authentication flow" ./my-project
semble search "save_pretrained" ./my-project
semble search "save model to disk" ./my-project --top-k 10
```

## Related code

```powershell
semble find-related src/auth.py 42 ./my-project
```

`path` defaults to the current directory when omitted; git URLs are accepted.
If `semble` is not on `$PATH`, use `uvx --from "semble[mcp]" semble`.

## Workflow

1. Start with `semble search`.
2. Use `semble find-related` for a nearby implementation.
3. Open full files only when the snippet is not enough.
4. Use grep only for exact-string confirmation.

## MCP

```powershell
codex mcp add semble -- uvx --from "semble[mcp]" semble
```

Use the same command in Windsurf/Qoder MCP config.
