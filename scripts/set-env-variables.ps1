# PowerShell 脚本: 安全地设置 OMX 永久环境变量
# 此脚本只会添加/更新指定的环境变量,不会影响其他变量

$ErrorActionPreference = "Stop"

Write-Host "🔧 设置 OMX 永久环境变量" -ForegroundColor Cyan
Write-Host ""

# 定义要设置的环境变量
$envVars = @{
    "DEEPSEEK_API_KEY" = "sk-d0c9e3396036472f88a04212c5f0faa6"
    "OMX_SUBAGENT_MODEL" = "deepseek-v4-flash"
    "OMX_SUBAGENT_THINKING_MODE" = "smart"
    "OMX_RATE_LIMIT_CONCURRENCY" = "5"
    "OMX_RATE_LIMIT_DELAY_MS" = "500"
}

# 记录变更
$changed = @()
$unchanged = @()

foreach ($key in $envVars.Keys) {
    $newValue = $envVars[$key]
    
    # 获取当前值 (用户级别)
    $currentValue = [Environment]::GetEnvironmentVariable($key, "User")
    
    if ($currentValue -eq $newValue) {
        Write-Host "  ✓ $key 已是最新值,跳过" -ForegroundColor Green
        $unchanged += $key
    } else {
        # 设置永久环境变量 (用户级别,写入注册表)
        [Environment]::SetEnvironmentVariable($key, $newValue, "User")
        
        if ($currentValue -eq $null) {
            Write-Host "  + $key 已添加 (新变量)" -ForegroundColor Yellow
        } else {
            Write-Host "  ~ $key 已更新" -ForegroundColor Yellow
            Write-Host "    旧值: $currentValue" -ForegroundColor DarkGray
        }
        Write-Host "    新值: $newValue" -ForegroundColor DarkGray
        
        $changed += $key
    }
}

Write-Host ""
Write-Host "📊 设置完成" -ForegroundColor Green
Write-Host "  新增/更新: $($changed.Count) 个变量"
Write-Host "  未变更: $($unchanged.Count) 个变量"
Write-Host ""

if ($changed.Count -gt 0) {
    Write-Host "⚠️  注意:" -ForegroundColor Yellow
    Write-Host "  - 永久环境变量已写入注册表" -ForegroundColor DarkGray
    Write-Host "  - 需要重启 PowerShell 终端才能生效" -ForegroundColor DarkGray
    Write-Host "  - 当前会话不会立即生效" -ForegroundColor DarkGray
    Write-Host ""
    Write-Host "💡 立即生效的方法:" -ForegroundColor Cyan
    Write-Host "  1. 关闭并重新打开 PowerShell" -ForegroundColor DarkGray
    Write-Host "  2. 或者在当前会话手动设置:" -ForegroundColor DarkGray
    foreach ($key in $changed) {
        Write-Host "     `$env:$key=`"$($envVars[$key])`"" -ForegroundColor DarkGray
    }
} else {
    Write-Host "✅ 所有变量已是最新值,无需更改" -ForegroundColor Green
}

Write-Host ""
Write-Host "验证设置 (重启终端后):" -ForegroundColor Cyan
Write-Host "  Get-ChildItem Env: | Where-Object { `$_.Name -like '*OMX*' -or `$_.Name -eq 'DEEPSEEK_API_KEY' }" -ForegroundColor DarkGray
Write-Host ""
