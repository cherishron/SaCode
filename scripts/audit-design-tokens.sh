#!/usr/bin/env bash
# 设计令牌门禁（仿 scripts/audit-gui-coupling.sh 的收口思路）
# 棘轮式：只拦「新增」，不拦历史存量。清理一处就下调一个基线。
set -uo pipefail

UI_DIR="interfaces/desktop/src/ui"
# 令牌定义处：允许写裸 hex
TOKEN_FILES="theme.css|tdesign-theme.css|layout-contract.css"

# 基线 = 本次收口后的实测存量，只能降不能升
BASE_BRIDGE_BYPASS=13   # shell.css 直取 var(--td-*)（裸梯度，需逐处定语义）
BASE_VUE_RAW_HEX=3      # .vue 内裸 hex
BASE_SHELL_RAW_HEX=27   # shell.css 内裸 hex（含 .file-glyph.tone-* 域调色板）
BASE_IMPORTANT=30       # shell.css !important

fail=0


# 1) 业务 CSS / 组件不得绕过 theme.css 桥接层直取 TDesign 令牌
bypass=$(grep -rhoE 'var\(--td-[A-Za-z0-9-]+' "$UI_DIR/styles/shell.css" "$UI_DIR/components" 2>/dev/null | wc -l | tr -d ' ')

# 2) 业务 CSS / 组件不得写裸 hex
vue_hex=$(find "$UI_DIR" -name '*.vue' -exec grep -hoE '#[0-9a-fA-F]{3,8}\b' {} + 2>/dev/null | wc -l | tr -d ' ')
shell_hex=$(grep -oE '#[0-9a-fA-F]{3,8}\b' "$UI_DIR/styles/shell.css" 2>/dev/null | wc -l | tr -d ' ')
imp=$(grep -oE '!important' "$UI_DIR/styles/shell.css" 2>/dev/null | wc -l | tr -d ' ')

check() { # check <name> <actual> <baseline>
  local name="$1" actual="$2" base="$3"
  if [ "$actual" -gt "$base" ]; then
    printf 'FAIL  %-24s %s > baseline %s (新增 %s)\n' "$name" "$actual" "$base" "$((actual - base))"
    fail=1
  else
    printf 'ok    %-24s %s (baseline %s%s)\n' "$name" "$actual" "$base" \
      "$([ "$actual" -lt "$base" ] && printf ' — 已降 %s，请下调基线' "$((base - actual))")"
  fi
}

check 'bridge-bypass var(--td-*)' "$bypass" "$BASE_BRIDGE_BYPASS"
check 'vue raw hex'               "$vue_hex" "$BASE_VUE_RAW_HEX"
check 'shell.css raw hex'         "$shell_hex" "$BASE_SHELL_RAW_HEX"
check 'shell.css !important'      "$imp" "$BASE_IMPORTANT"

# 3) 引用的令牌必须有定义：缺定义会静默落到 fallback 或 unset
#    注意字符类必须含大写（--td-comp-paddingLR-xxs），否则会在大写字母处截断成假阳性
missing=0
for t in $(grep -rhoE 'var\((--td-[A-Za-z0-9-]+)' "$UI_DIR/styles" "$UI_DIR/components" 2>/dev/null | sed 's/var(//' | sort -u); do
  grep -rqE "^[[:space:]]*$t:" "$UI_DIR/styles/tdesign-theme.css" || { echo "FAIL  令牌被引用但从未定义: $t"; missing=1; }
done
# 桥接别名允许定义在 theme.css（语义色/字/影）或 layout-contract.css（几何/结构线）
for t in $(grep -rhoE 'var\((--(bg|text|accent|border|shadow|code|success|warning|danger|info|radius|space|font|dur|ease)-[A-Za-z0-9-]+)' "$UI_DIR/styles" "$UI_DIR/components" 2>/dev/null | sed 's/var(//' | sort -u); do
  grep -rqE "^[[:space:]]*$t:" "$UI_DIR/styles/theme.css" "$UI_DIR/styles/layout-contract.css" \
    || { echo "FAIL  桥接别名被引用但未定义: $t"; missing=1; }
done
[ "$missing" -eq 0 ] && echo "ok    所有被引用的令牌均有定义"

[ "$fail" -eq 0 ] && [ "$missing" -eq 0 ] && { echo; echo "设计令牌门禁通过"; exit 0; }
echo; echo "设计令牌门禁失败：新增的裸值应改走 theme.css 别名；确属必要的例外请写进基线并注明原因。"
exit 1
