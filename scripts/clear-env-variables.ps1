# PowerShell 脚本: 清除 OMX 相关环境变量
# 此脚本只会删除指定的环境变量,不会影响其他变量

$ErrorActionPreference = "Stop"

Write-Host "🗑️  清除 OMX 环境变量" -ForegroundColor Red
Write-Host ""
Write-Host "⚠️  警告: 此操作将永久删除以下环境变量:" -ForegroundColor Yellow
Write-Host ""

# 定义要删除的环境变量
$envNames = @(
    "DEEPSEEK_API_KEY",
    "OMX_SUBAGENT_MODEL",
    "OMX_SUBAGENT_THINKING_MODE",
    "OMX_SUBAGENT_MAX_TURNS",
    "OMX_SUBAGENT_ENABLED",
    "OMX_SUBAGENT_CACHE_ENABLED",
    "OMX_SUBAGENT_CACHE_TTL",
    "OMX_RATE_LIMIT_CONCURRENCY",
    "OMX_RATE_LIMIT_DELAY_MS",
    "OMX_RATE_LIMIT_ENABLED"
)

# 显示将要删除的变量
foreach ($name in $envNames) {
    $value = [Environment]::GetEnvironmentVariable($name, "User")
    if ($value -ne $null) {
        Write-Host "  - $name" -ForegroundColor DarkGray
        if ($name -eq "DEEPSEEK_API_KEY") {
            $masked = $value.Substring(0, 5) + "..." + $value.Substring($value.Length - 4)
            Write-Host "    值: $masked" -ForegroundColor DarkGray
        } else {
            Write-Host "    值: $value" -ForegroundColor DarkGray
        }
    }
}

Write-Host ""
Write-Host "此操作不会删除其他环境变量。" -ForegroundColor DarkGray
Write-Host ""

# 确认删除
$confirmation = Read-Host "确定要删除这些环境变量吗? (y/N)"

if ($confirmation -ne 'y' -and $confirmation -ne 'Y') {
    Write-Host "❌ 已取消操作" -ForegroundColor Yellow
    exit 0
}

Write-Host ""

$deleted = 0
$notFound = 0

foreach ($name in $envNames) {
    $value = [Environment]::GetEnvironmentVariable($name, "User")
    
    if ($value -ne $null) {
        # 删除永久环境变量
        [Environment]::SetEnvironmentVariable($name, $null, "User")
        Write-Host "  ✓ 已删除: $name" -ForegroundColor Green
        $deleted++
    } else {
        $notFound++
    }
}

Write-Host ""
Write-Host "📊 删除完成" -ForegroundColor Green
Write-Host "  已删除: $deleted 个变量"
Write-Host "  未找到: $notFound 个变量"
Write-Host ""
Write-Host "⚠️  注意:" -ForegroundColor Yellow
Write-Host "  - 需要重启 PowerShell 终端才能完全生效" -ForegroundColor DarkGray
Write-Host "  - 当前会话中的变量仍然可用,直到关闭终端" -ForegroundColor DarkGray
Write-Host ""

