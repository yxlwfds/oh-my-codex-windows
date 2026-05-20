@echo off
pwsh -NoProfile -ExecutionPolicy Bypass -File "%~dp0continue.ps1" %*
exit /b %ERRORLEVEL%

