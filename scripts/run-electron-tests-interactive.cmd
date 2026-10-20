@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0.."

set "PAUSE_AT_END=1"
if /i "%~1"=="--no-pause" set "PAUSE_AT_END=0"

where node >nul 2>nul
if errorlevel 1 (
  echo [错误] 未找到 node。请先安装 Node.js 22，或把 node.exe 所在目录加入 PATH。
  if "%PAUSE_AT_END%"=="1" pause
  exit /b 3
)

node "scripts\run-electron-tests-interactive.cjs" %*
set "RC=%ERRORLEVEL%"

echo.
if "%RC%"=="0" (
  echo 跑道结束：全部通过。
) else (
  echo 跑道结束：退出码 %RC%，请看上面的失败文件与报告路径。
)
if "%PAUSE_AT_END%"=="1" pause
exit /b %RC%
