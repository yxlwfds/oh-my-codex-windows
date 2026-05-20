param(
    [string]$RepoRoot = ""
)

$ErrorActionPreference = "Stop"

function Get-RepoRoot {
    param([string]$StartPath)

    $current = if ($StartPath) { (Resolve-Path -LiteralPath $StartPath).Path } else { (Get-Location).Path }
    while ($true) {
        if ((Test-Path -LiteralPath (Join-Path $current ".git")) -or (Test-Path -LiteralPath (Join-Path $current ".omx"))) {
            return $current
        }
        $parent = Split-Path -Parent $current
        if (-not $parent -or $parent -eq $current) {
            return $current
        }
        $current = $parent
    }
}

function Read-JsonFile {
    param([string]$Path)
    if (-not (Test-Path -LiteralPath $Path)) { return $null }
    try {
        $raw = Get-Content -LiteralPath $Path -Raw -ErrorAction Stop
        if (-not $raw.Trim()) { return $null }
        return $raw | ConvertFrom-Json -ErrorAction Stop
    } catch {
        return $null
    }
}

function ConvertTo-List {
    param($Value)
    if ($null -eq $Value) { return @() }
    if ($Value -is [string]) {
        $trimmed = $Value.Trim()
        if ($trimmed) { return @($trimmed) }
        return @()
    }
    if ($Value -is [System.Collections.IEnumerable]) {
        $items = @()
        foreach ($item in $Value) {
            $text = "$item".Trim()
            if ($text) { $items += $text }
        }
        return $items
    }
    $text = "$Value".Trim()
    if ($text) { return @($text) }
    return @()
}

function Get-GitState {
    param([string]$RepoRoot)
    try {
        $raw = & git -C $RepoRoot status --short --branch 2>$null
        $text = ($raw | Out-String).TrimEnd()
    } catch {
        return @{}
    }
    $lines = @()
    if ($text) {
        $lines = $text -split "`r?`n" | Where-Object { $_ -and $_.Trim() -ne "" }
    }
    return [ordered]@{
        branch = if ($lines.Count -gt 0) { $lines[0].TrimStart("# ").Trim() } else { "" }
        changed = if ($lines.Count -gt 1) { $lines.Count - 1 } else { 0 }
    }
}

function Render-Resume {
    param(
        [object]$Checkpoint,
        [string]$RepoRoot
    )

    $lines = @()
    $lines += "# Resume checkpoint"

    $goal = "$($Checkpoint.goal)".Trim()
    if ($goal) {
        $lines += "Goal: $goal"
    }

    foreach ($pair in @(
        @{ Label = "Done"; Key = "done" },
        @{ Label = "Open"; Key = "open" },
        @{ Label = "Risks"; Key = "risks" },
        @{ Label = "Next"; Key = "next" },
        @{ Label = "Files"; Key = "files" }
    )) {
        $items = ConvertTo-List $Checkpoint.($pair.Key)
        if ($items.Count -gt 0) {
            $lines += "## $($pair.Label)"
            foreach ($item in $items) {
                $lines += "- $item"
            }
        }
    }

    $git = Get-GitState -RepoRoot $RepoRoot
    if ($git.branch -or $git.changed -gt 0) {
        $lines += "## Repo"
        if ($git.branch) { $lines += "- branch: $($git.branch)" }
        if ($git.changed -gt 0) { $lines += "- changed files: $($git.changed)" }
    }

    $nextItems = ConvertTo-List $Checkpoint.next
    $lines += "## Continue"
    if ($nextItems.Count -gt 0) {
        $lines += "- Start with: $($nextItems[0])"
    } else {
        $lines += "- No next step saved; inspect the checkpoint and decide the first action."
    }

    return ($lines -join "`n").Trim() + "`n"
}

$repoRoot = if ($RepoRoot) { Get-RepoRoot -StartPath $RepoRoot } else { Get-RepoRoot }
$checkpointPath = Join-Path $repoRoot ".omx\state\context-checkpoint.json"
$checkpoint = Read-JsonFile -Path $checkpointPath

if (-not $checkpoint) {
    Write-Host "No checkpoint found. Run pwsh -NoProfile -File D:\code\my\oh-my-codex\script\ck.ps1 first."
    exit 1
}

Write-Host (Render-Resume -Checkpoint $checkpoint -RepoRoot $repoRoot) -NoNewline
