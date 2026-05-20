param(
  [string]$ProjectRoot = "",
  [switch]$SkipProject,
  [switch]$SkipGlobal,
  [switch]$DryRun
)

$args = @("$PSScriptRoot\install_code_intelligence_toolchain.py")
if ($ProjectRoot) { $args += @("--project-root", $ProjectRoot) }
if ($SkipProject) { $args += "--skip-project" }
if ($SkipGlobal) { $args += "--skip-global" }
if ($DryRun) { $args += "--dry-run" }

& python @args
