#!/usr/bin/env bash
# audit-gui-coupling — 架构边界守卫（CLI/Desktop 边界评估报告建议项）
#
# 断言：kernel（core）与 interfaces/cli 不得引用 GUI/托盘/窗口/原生 UI API。
# desktop 侧（src-tauri）允许引用。用法：
#   bash scripts/audit-gui-coupling.sh        # 退出码 0 = 通过，1 = 发现违规
#
# 背景：CLI 必须能在无图形会话环境运行；core 不得持有"窗口是否可见"等 UI 状态。
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
fail=0

check() {
  local dir="$1"
  local label="$2"
  # 只检索 Rust 源码里的真实引用（排除注释行与测试夹具）
  local hits
  hits=$(grep -rnE '\b(tray|webview|wry|tauri::|TrayIconBuilder|\.show_window|WindowEvent)\b' \
    "$ROOT/$dir" --include='*.rs' 2>/dev/null \
    | grep -vE '^\s*//|^\s*///|#\[cfg\(test\)\]|mod tests' || true)
  if [ -n "$hits" ]; then
    echo "✗ $label 发现 GUI 引用："
    echo "$hits" | head -10 | sed 's/^/    /'
    fail=1
  else
    echo "✓ $label 无 GUI 引用"
  fi
}

echo "== GUI 耦合审计 =="
check "kernel/src" "kernel（core）"
check "interfaces/cli/src" "interfaces/cli"

# Cargo 依赖方向断言：kernel 不得传递依赖 tauri/wry
if command -v cargo >/dev/null 2>&1; then
  echo "== kernel 依赖树检查 =="
  gui_deps=$(cargo tree -p sacode-kernel -e normal 2>/dev/null \
    | grep -iE '\b(tauri|wry|tao|webview2-com)\b' || true)
  if [ -n "$gui_deps" ]; then
    echo "✗ kernel 依赖树含 GUI crate："
    echo "$gui_deps" | head -5 | sed 's/^/    /'
    fail=1
  else
    echo "✓ kernel 依赖树无 GUI crate"
  fi
fi

if [ "$fail" -eq 0 ]; then
  echo "== 结果：PASS =="
  exit 0
fi
echo "== 结果：FAIL（修复上述违规后重跑）=="
exit 1
