@echo off
REM SaCode 开发钩子安装脚本 (Windows CMD)
REM
REM 启用 .githooks/ 目录下的 git hooks。
REM
REM 用法：scripts\setup-hooks.bat

setlocal enabledelayedexpansion

cd /d "%~dp0\.."

if not exist .githooks (
    echo 错误: .githooks 目录不存在 1>&2
    exit /b 1
)

git config core.hooksPath .githooks
echo ==^> 已启用 .githooks 钩子目录

echo ==^> 完成：后续 git commit 将自动执行提交前验证
