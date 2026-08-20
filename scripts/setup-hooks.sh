#!/bin/sh
# SaCode 开发钩子安装脚本
#
# 启用 .githooks/ 目录下的 git hooks（核心钩子目录重定向），
# 使 pre-commit 验证钩子对所有协作者生效。
#
# 用法：
#   sh scripts/setup-hooks.sh
# 或（Windows Git Bash / WSL）：
#   ./scripts/setup-hooks.sh
#
# 说明：core.hooksPath 是仓库级配置，会写入 .git/config，
# 不随提交分发；新克隆的仓库需重新执行本脚本。

set -e

cd "$(dirname "$0")/.."

if [ -d .githooks ]; then
    git config core.hooksPath .githooks
    echo "==> 已启用 .githooks 钩子目录"
else
    echo "错误: .githooks 目录不存在" >&2
    exit 1
fi

# 校验钩子可执行（Unix 系）
if [ -f .githooks/pre-commit ]; then
    chmod +x .githooks/pre-commit 2>/dev/null || true
    echo "==> pre-commit 钩子已就绪"
fi

echo "==> 完成：后续 git commit 将自动执行提交前验证"
