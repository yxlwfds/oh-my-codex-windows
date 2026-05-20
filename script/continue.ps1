param(
    [string]$RepoRoot = "",
    [switch]$Local
)

$ErrorActionPreference = "Stop"

function Get-ScriptDir {
    if ($PSScriptRoot) { return $PSScriptRoot }
    return Split-Path -Parent $PSCommandPath
}

$scriptDir = Get-ScriptDir
$ckScript = Join-Path $scriptDir "ck.ps1"
$resumeScript = Join-Path $scriptDir "resume-ck.ps1"

$args = @()
if ($RepoRoot) { $args += @("-RepoRoot", $RepoRoot) }
if ($Local) { $args += "-Local" }

& pwsh -NoProfile -File $ckScript @args
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

& pwsh -NoProfile -File $resumeScript @args
exit $LASTEXITCODE
