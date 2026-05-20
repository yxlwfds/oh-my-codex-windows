param(
    [string]$RepoRoot = "",
    [switch]$Local,
    [switch]$NoWrite
)

$ErrorActionPreference = "Stop"
$target = Join-Path $PSScriptRoot "continue.ps1"
$args = @()
if ($RepoRoot) { $args += @("-RepoRoot", $RepoRoot) }
if ($Local) { $args += "-Local" }
if ($NoWrite) { $args += "-NoWrite" }
& pwsh -NoProfile -File $target @args
exit $LASTEXITCODE
