param(
  [string]$CodexTarget = "$HOME\.codex\skills",
  [string]$DeepseekHome = "$HOME\.deepseek",
  [string]$OhMyCodexRoot = "D:\code\my\oh-my-codex"
)

python "$PSScriptRoot\sync_ast_grep_toolchain.py" `
  --codex-target "$CodexTarget" `
  --deepseek-home "$DeepseekHome" `
  --ohmycodex-root "$OhMyCodexRoot" `
  --all-defaults
