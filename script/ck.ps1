param(
    [string]$RepoRoot = "",
    [switch]$Local,
    [switch]$NoWrite
)

$ErrorActionPreference = "Stop"
$global:PSNativeCommandUseErrorActionPreference = $false

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

function Invoke-GitText {
    param(
        [Parameter(Mandatory = $true)]
        [string[]]$Args,
        [Parameter(Mandatory = $true)]
        [string]$RepoRoot
    )

    try {
        $output = & git -C $RepoRoot @Args 2>$null
        if ($null -eq $output) { return "" }
        return ($output | Out-String).TrimEnd()
    } catch {
        return ""
    }
}

function Get-GitState {
    param([string]$RepoRoot)

    $status = Invoke-GitText -RepoRoot $RepoRoot -Args @("status", "--short", "--branch")
    $lines = @()
    if ($status) {
        $lines = $status -split "`r?`n" | Where-Object { $_ -and $_.Trim() -ne "" }
    }

    $changedFiles = @()
    if ($lines.Count -gt 1) {
        foreach ($line in $lines[1..($lines.Count - 1)]) {
            if ($line.Length -ge 4) {
                $path = $line.Substring(3).Trim()
                if ($path) { $changedFiles += $path }
            }
        }
    }

    return [ordered]@{
        branch_line   = if ($lines.Count -gt 0) { $lines[0] } else { "" }
        changed_count  = $changedFiles.Count
        changed_files  = $changedFiles
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

function Extract-JsonText {
    param([string]$Text)
    if (-not $Text) { return $null }
    $start = $Text.IndexOf("{")
    $end = $Text.LastIndexOf("}")
    if ($start -lt 0 -or $end -lt $start) { return $null }
    return $Text.Substring($start, $end - $start + 1)
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

function Normalize-Checkpoint {
    param(
        [hashtable]$Base,
        [object]$Delegate
    )

    $normalized = [ordered]@{
        timestamp = [DateTimeOffset]::UtcNow.ToString("o")
        goal      = ""
        confirmed = @()
        done      = @()
        open      = @()
        risks     = @()
        next      = @()
        files     = @()
        commands  = @()
        notes     = ""
    }

    $keys = @($normalized.Keys)
    foreach ($key in $keys) {
        if ($Base.ContainsKey($key)) {
            $value = $Base[$key]
            if ($key -eq "notes" -or $key -eq "goal") {
                $normalized[$key] = "$value".Trim()
            } else {
                $normalized[$key] = ConvertTo-List $value
            }
        }
    }

    if ($Delegate) {
        foreach ($key in @("goal", "notes")) {
            $incoming = $Delegate.$key
            if ($incoming) {
                if ($key -eq "goal") {
                    if (-not $normalized.goal) { $normalized.goal = "$incoming".Trim() }
                } else {
                    if (-not $normalized.notes) { $normalized.notes = "$incoming".Trim() }
                }
            }
        }
        foreach ($key in @("confirmed", "done", "open", "risks", "next", "files", "commands")) {
            $incoming = ConvertTo-List $Delegate.$key
            if ($incoming.Count -gt 0) {
                $merged = @($normalized[$key]) + $incoming | ForEach-Object { "$_".Trim() } | Where-Object { $_ }
                $normalized[$key] = $merged | Select-Object -Unique
            }
        }
    }

    return [pscustomobject]$normalized
}

function Render-Markdown {
    param([object]$Checkpoint)

    $lines = @()
    $lines += "# Checkpoint $($Checkpoint.timestamp)"

    if ($Checkpoint.goal) {
        $lines += "## Goal"
        $lines += "$($Checkpoint.goal)"
    }

    foreach ($pair in @(
        @{ Label = "Confirmed"; Key = "confirmed" },
        @{ Label = "Done"; Key = "done" },
        @{ Label = "Open"; Key = "open" },
        @{ Label = "Risks"; Key = "risks" },
        @{ Label = "Next"; Key = "next" },
        @{ Label = "Files"; Key = "files" },
        @{ Label = "Commands"; Key = "commands" }
    )) {
        $items = ConvertTo-List $Checkpoint.($pair.Key)
        if ($items.Count -gt 0) {
            $lines += "## $($pair.Label)"
            foreach ($item in $items) {
                $lines += "- $item"
            }
        }
    }

    if ($Checkpoint.notes) {
        $lines += "## Notes"
        $lines += "$($Checkpoint.notes)"
    }

    $git = Get-GitState -RepoRoot $script:RepoRoot
    if ($git.branch_line -or $git.changed_count -gt 0) {
        $lines += "## Repo"
        if ($git.branch_line) { $lines += "- branch: $($git.branch_line)" }
        if ($git.changed_count -gt 0) { $lines += "- changed files: $($git.changed_count)" }
    }

    return ($lines -join "`n").Trim() + "`n"
}

function Write-CheckpointFiles {
    param(
        [object]$Checkpoint,
        [string]$RepoRoot
    )

    $omxRoot = Join-Path $RepoRoot ".omx"
    $stateDir = Join-Path $omxRoot "state"
    New-Item -ItemType Directory -Force -Path $stateDir | Out-Null

    $jsonPath = Join-Path $stateDir "context-checkpoint.json"
    $notePath = Join-Path $omxRoot "notepad.md"

    $Checkpoint | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $jsonPath -Encoding utf8

    $markdown = Render-Markdown -Checkpoint $Checkpoint
    if (Test-Path -LiteralPath $notePath) {
        $existing = Get-Content -LiteralPath $notePath -Raw -Encoding utf8
        if ($existing.Trim()) {
            $markdown = $existing.TrimEnd() + "`n`n---`n`n" + $markdown.TrimStart()
        }
    }
    Set-Content -LiteralPath $notePath -Value $markdown -Encoding utf8

    return [pscustomobject]@{
        jsonPath = $jsonPath
        notePath = $notePath
    }
}

function Invoke-DelegateCheckpoint {
    param([string]$RepoRoot)

    $prompt = @"
Inspect the current repository state and return ONLY a JSON object with keys:
goal, confirmed, done, open, risks, next, files, commands, notes.

Use .omx/notepad.md, .omx/state/context-checkpoint.json, git status --short --branch, and git diff --stat.
Keep entries short and current. Ignore stale historical notes unless they explain the active task.
Do not add markdown, fences, code blocks, or commentary.
"@

    $lastMessage = Join-Path ([System.IO.Path]::GetTempPath()) ("ck-last-message-{0}.txt" -f ([guid]::NewGuid().ToString("N")))
    if (Test-Path -LiteralPath $lastMessage) {
        Remove-Item -LiteralPath $lastMessage -Force -ErrorAction SilentlyContinue
    }
    try {
        $prompt | & owx exec --ephemeral --cd $RepoRoot --output-last-message $lastMessage - 2>&1 | Out-String | Out-Null
    } catch {
        # fall through to file-based parse; exit code is not reliable for owx exec
    }

    if (-not (Test-Path -LiteralPath $lastMessage)) {
        return $null
    }

    $raw = Get-Content -LiteralPath $lastMessage -Raw -Encoding utf8
    $jsonText = Extract-JsonText -Text $raw
    if (-not $jsonText) {
        return $null
    }

    try {
        return $jsonText | ConvertFrom-Json -ErrorAction Stop
    } catch {
        return $null
    }
}

function Invoke-LocalCheckpoint {
    param([string]$RepoRoot)

    $existingPath = Join-Path (Join-Path $RepoRoot ".omx") "state\context-checkpoint.json"
    $existing = Read-JsonFile -Path $existingPath
    $base = [ordered]@{
        goal      = if ($existing) { $existing.goal } else { "" }
        confirmed = if ($existing) { $existing.confirmed } else { @() }
        done      = if ($existing) { $existing.done } else { @() }
        open      = if ($existing) { $existing.open } else { @() }
        risks     = if ($existing) { $existing.risks } else { @() }
        next      = if ($existing) { $existing.next } else { @() }
        files     = if ($existing) { $existing.files } else { @() }
        commands  = if ($existing) { $existing.commands } else { @() }
        notes     = if ($existing) { $existing.notes } else { "" }
    }

    $git = Get-GitState -RepoRoot $RepoRoot
    $checkpoint = Normalize-Checkpoint -Base $base -Delegate $null
    if ($git.branch_line) {
        if (-not $checkpoint.notes) {
            $checkpoint.notes = "branch: $($git.branch_line)"
        }
    }
    if ($git.changed_count -gt 0) {
        if ((ConvertTo-List $checkpoint.files).Count -eq 0) {
            $checkpoint.files = $git.changed_files
        }
    }
    return $checkpoint
}

$script:RepoRoot = if ($RepoRoot) { Get-RepoRoot -StartPath $RepoRoot } else { Get-RepoRoot }

$delegate = $null
if (-not $Local) {
    $delegate = Invoke-DelegateCheckpoint -RepoRoot $script:RepoRoot
}
if (-not $delegate) {
    $delegate = Invoke-LocalCheckpoint -RepoRoot $script:RepoRoot
}

$base = @{}
$checkpoint = Normalize-Checkpoint -Base $base -Delegate $delegate

$checkpoint | Add-Member -NotePropertyName git -NotePropertyValue (Get-GitState -RepoRoot $script:RepoRoot) -Force

if (-not $NoWrite) {
    $paths = Write-CheckpointFiles -Checkpoint $checkpoint -RepoRoot $script:RepoRoot
    Write-Host "# Checkpoint $($checkpoint.timestamp)"
    if ($checkpoint.goal) {
        Write-Host "Goal: $($checkpoint.goal)"
    }
    foreach ($field in @("confirmed", "done", "open", "risks", "next", "files", "commands")) {
        $items = ConvertTo-List $checkpoint.$field
        if ($items.Count -gt 0) {
            Write-Host "$($field.Substring(0,1).ToUpper() + $field.Substring(1)):`n- " -NoNewline
            Write-Host ($items -join "`n- ")
        }
    }
    if ($checkpoint.notes) {
        Write-Host "Notes: $($checkpoint.notes)"
    }
    Write-Host "written: $($paths.jsonPath)"
    Write-Host "written: $($paths.notePath)"
    Write-Host "Next: open a new thread and run `$resume-ck"
} else {
    $checkpoint | ConvertTo-Json -Depth 8
}
