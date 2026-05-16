# PowerShell 脚本: 查看 OMX 相关环境变量
# 安全查看,不会修改任何变量

$ErrorActionPreference = "Stop"

Write-Host "🔍 OMX 环境变量状态" -ForegroundColor Cyan
Write-Host ""

# 定义要检查的环境变量
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

$found = 0
$notFound = 0

foreach ($name in $envNames) {
    # 获取用户级别的永久值
    $permanentValue = [Environment]::GetEnvironmentVariable($name, "User")
    
    # 获取当前会话的值
    $currentValue = [Environment]::GetEnvironmentVariable($name, "Process")
    
    Write-Host "$name" -ForegroundColor White
    
    if ($permanentValue -ne $null) {
        Write-Host "  永久值: " -NoNewline -ForegroundColor DarkGray
        if ($name -eq "DEEPSEEK_API_KEY") {
            # 隐藏 API Key 的实际值
            $masked = $permanentValue.Substring(0, 5) + "..." + $permanentValue.Substring($permanentValue.Length - 4)
            Write-Host $masked -ForegroundColor Yellow
        } else {
            Write-Host $permanentValue -ForegroundColor Green
        }
        
        $found++
    } else {
        Write-Host "  永久值: (未设置)" -ForegroundColor DarkGray
        $notFound++
    }
    
    if ($currentValue -ne $null -and $currentValue -ne $permanentValue) {
        Write-Host "  当前值: " -NoNewline -ForegroundColor DarkGray
        if ($name -eq "DEEPSEEK_API_KEY") {
            $masked = $currentValue.Substring(0, 5) + "..." + $currentValue.Substring($currentValue.Length - 4)
            Write-Host $masked -ForegroundColor Yellow
        } else {
            Write-Host $currentValue -ForegroundColor Cyan
        }
        Write-Host "  ⚠️  当前会话值与永久值不同" -ForegroundColor Yellow
    }
    
    Write-Host ""
}

Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor DarkGray
Write-Host ""
Write-Host "📊 统计:" -ForegroundColor Cyan
Write-Host "  已设置: $found 个" -ForegroundColor Green
Write-Host "  未设置: $notFound 个" -ForegroundColor DarkGray
Write-Host ""

if ($notFound -gt 0) {
    Write-Host "💡 提示:" -ForegroundColor Yellow
    Write-Host "  运行以下命令设置缺失的变量:" -ForegroundColor DarkGray
    Write-Host "  .\scripts\set-env-variables.ps1" -ForegroundColor Cyan
    Write-Host ""
}

# 检查 API Key 格式
$apiKey = [Environment]::GetEnvironmentVariable("DEEPSEEK_API_KEY", "User")
if ($apiKey -ne $null) {
    if ($apiKey -match "^sk-[a-f0-9]{32}$") {
        Write-Host "✅ DEEPSEEK_API_KEY 格式正确" -ForegroundColor Green
    } else {
        Write-Host "⚠️  DEEPSEEK_API_KEY 格式可能不正确" -ForegroundColor Yellow
        Write-Host "   期望格式: sk-[32位十六进制字符]" -ForegroundColor DarkGray
    }
    Write-Host ""
}

Write-Host "🔧 快速操作:" -ForegroundColor Cyan
Write-Host "  设置变量:   .\scripts\set-env-variables.ps1" -ForegroundColor DarkGray
Write-Host "  清除变量:   .\scripts\clear-env-variables.ps1" -ForegroundColor DarkGray
Write-Host ""
