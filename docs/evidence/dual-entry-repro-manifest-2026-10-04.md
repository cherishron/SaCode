# 双入口产物复现清单（2026-10-04）

**目的**：给「同一套仓颉核心 + 独立 CLI + Electron 桌面安装包」这套交付一个能在他机独立复现并按哈希对账的清单。凡本清单里出现的数字（用例计数、字节数、sha256、能力条数）都取自 `D:\Project\sa\saai\sa-code` 上 `refactor/dsh-learning` 分支 `b2b5942` 之前的实测输出，见 `docs/evidence/p0-status-2026-10-02.md` 「双入口回归与打包态复验」。

## 前置

- 平台：Windows x86_64（其它平台需换 `dsh-cli-<triple>` 与 electron 目标）。
- 工具：`cjc`/`cjpm` **1.1.3**（target `x86_64-w64-mingw32`）、Node ≥ 18（本地 v22）、Git Bash。
- 环境变量：
  - `CANGJIE_HOME` — 默认 `D:\Program Files\HuaWei\Cangjie`。
  - `STDX_HOME` — 默认 `C:/Users/jingg/stdx-work/stdx-1.1.3.1/windows_x86_64_cjnative/dynamic/stdx`。**换机器必须改**（`apps/host/cjpm.toml` 硬编码）。
  - `OPENSSL_HOME`（可选）— Windows 原生路径；不设时 `scripts/pack-cli.mjs` 走 PATH 找 MinGW DLL，Git Bash 下需先 `cygpath -w` 转一条 Windows 形式路径进 PATH。
- 依赖包已发布：`@stand-alone/sacode@0.2.0` 与 `@stand-alone/sacode-win32-x64@0.1.0`；本机离线复现不需要 registry 访问。

## 一、共享核心

```
cd core
cjpm test
```

**判据**：剥 ANSI 后 `Summary:` 段末行 `RESULT:` 上一段应给出
```
Summary: TOTAL: 370
    PASSED: 369, SKIPPED: 1, ERROR: 0
    FAILED: 0
cjpm test success
```

**注意**：`cjpm test` 空测试集返回 `RESULT: PASSED: 0, SKIPPED: 0, ERROR: 0, FAILED: 0` 且 rc=0 —— 那不是绿灯。判数字用 `sed -e 's/\x1b\[[0-9;]*m//g'` 剥 ANSI、`grep` 只取最后一个 `Summary:` 块，不能用 `grep -c "[ PASSED ]"` 数标记（详见用户记忆「空测试集是假绿」）。

**70 个 `*_test.cj` 覆盖 63 矩阵模块**；1 条 SKIPPED 是需要真 provider 凭证的 SSE 网络测试。

## 二、可发布 npm CLI（平台包）

### 2.1 构建可执行

```
cd apps/cli && cjpm build          # 期望 rc=0，打印 cjpm build success
```

产物 `apps/cli/target/release/bin/main.exe`，本会话实测 **sha256 `c2bf44641bf59c881f789d39f3b18ab12ec240667562146b3d04ff4c4ce75bdc`**。

### 2.2 打包平台包

```
node scripts/pack-cli.mjs
```

**判据**：末行 `packed 45 个文件到 npm/dsh-cli-win32-x64/bin（其中 stdx 33 + openssl 2 + mingw 3），扩展宿主 2 + 样例工具 4 个到 npm/dsh-cli-win32-x64/extjs`。

`npm/dsh-cli-win32-x64/bin/dsh.exe` 应与 2.1 的 `main.exe` **sha256 相同**（同 exe 改名）。

### 2.3 出 tarball

```
cd npm/dsh-cli && npm pack --offline --no-audit --no-fund --pack-destination ../../dualtest/npm-offline-verify/tarballs
cd ../dsh-cli-win32-x64 && npm pack --offline --no-audit --no-fund --pack-destination ../../dualtest/npm-offline-verify/tarballs
```

**判据**：主包 2 文件（package.json + bin/cli.js），平台包 **90 文件**。

### 2.4 隔离装 + 剥 SDK PATH

```
mkdir -p dualtest/npm-offline-verify/isolated && cd dualtest/npm-offline-verify/isolated
npm init -y
npm install --offline --no-audit --no-fund \
  ../tarballs/stand-alone-sacode-0.2.0.tgz \
  ../tarballs/stand-alone-sacode-win32-x64-0.1.0.tgz

# 剥 SDK 只留 node 可见
export PATH=$(echo "$PATH" | tr ':' '\n' | grep -viE 'cangjie|stdx-work|mingw64' | paste -sd ':' -)
command -v cjc  # 期望无输出
command -v cjpm # 期望无输出
command -v node # 期望有输出
```

装包内 `dsh.exe` 与 2.1/2.2 三段 **sha256 逐字相等**（`c2bf4464…`）。

### 2.5 逐子命令断言

```
CLI=node_modules/@stand-alone/sacode/bin/cli.js
for m in all stream tool ext cancel extjs headless; do
  timeout 30 node "$CLI" $m > /tmp/m-$m.txt 2>&1
  echo "$m rc=$? PASS=$(grep -c '^PASS' /tmp/m-$m.txt) FAIL=$(grep -c '^FAIL' /tmp/m-$m.txt)"
done
```

**判据**（七模式断言）：`all 77 / stream 21 / tool 11 / ext 8 / cancel 9 / extjs 12 / headless 36`，共 **175 PASS / 0 FAIL**（`headless` 36 条已被 `all` 77 条覆盖，独立跑证明子集可解耦）。

四条非断言输出模式：`seed` 输出 `ok seeded <n>`、`projection` 输出真实投影、`tools` 列表工具目录、`call` 无参数返 64 与 usage 错。

`sig` 与 `realstream` 各自的环境阻塞已在 p0-status 记录，不缩范围凑绿。

## 三、Electron 桌面安装包

### 3.1 构建宿主

```
cd apps/host && cjpm build
```

产物 `apps/host/target/release/bin/main.exe`，实测 **sha256 `7f290fc4591b00cdf1ea82be429ec65c23dfcbcbdb6a9f0a3bd3192609bc7d8e`**（体积 4728320 B）。

### 3.2 打自包含宿主目录

```
MGW_WIN="$(cygpath -w /c/Users/jingg/.qoder-cn/bin/git/mingw64/bin)"
export PATH="$MGW_WIN;C:\\Program Files\\Git\\mingw64\\bin;$PATH"
node scripts/pack-host.mjs apps/host/target/release/bin/main.exe dualtest/host-verify-fresh \
  "$STDX" "$RT"
```

**判据**：末行 `host 打包完成：91 个文件 → dualtest\host-verify-fresh\bin`；`dualtest/host-verify-fresh/bin/dsh-host.exe` 与 3.1 **sha256 逐字相等**。

### 3.3 桌面依赖 + vendor 折叠

```
cd apps/desktop && npm install
npm run vendor    # 依次 pack-vendor / pack-tinyvue / pack-tinyrobot
```

`renderer/vendor/` 被 gitignore，是构建产物；判可复现要重跑并核文件回没回来。

### 3.4 electron-builder 出 win-unpacked + Setup + Portable

**关键顺序**：`apps/desktop/dist/host/bin/dsh-host.exe` 会被运行中的 Electron 占用（并发场景），而 `apps/desktop/dist/electron/win-unpacked/resources/host/bin/dsh-host.exe` 是另一份、可以覆盖。

```
# 先只出 win-unpacked
npx electron-builder --dir --config.electronDist=node_modules/electron/dist

# 覆盖 win-unpacked 里的宿主为 fresh
cp dualtest/host-verify-fresh/bin/dsh-host.exe \
   apps/desktop/dist/electron/win-unpacked/resources/host/bin/dsh-host.exe

# 再从 win-unpacked 封 Setup + Portable（--prepackaged 跳过打包步骤）
npx electron-builder --prepackaged=dist/electron/win-unpacked
```

**判据**：
- `dist/electron/win-unpacked/SaCode.exe` 存在。
- `dist/electron/SaCode Setup 0.1.0.exe` 与 `dist/electron/sacode-portable.exe` 生成，体积各约 86 MB。
- 覆盖前后 sha256 一致。

**踩坑**：`--config.extraResources.0.from=…` 会被 electron-builder 26.15.3 schema 拒（`configuration.extraResources should be one of these: array | null | string`），或者静默丢 `host/bin/`。**唯一可行路径是「先覆盖 win-unpacked 里那份，再用 `--prepackaged` 只跑 targets」**。

### 3.5 装包 → 逐 verb 断言

```
INSTALL_DIR="D:\\Project\\sa\\saai\\sa-code\\dualtest\\nsis-install"
mkdir -p "$INSTALL_DIR"
"./dist/electron/SaCode Setup 0.1.0.exe" /S "/D=$INSTALL_DIR"

# 关键：装包内宿主与源链 sha256 必须逐字相等
sha256sum "$INSTALL_DIR/resources/host/bin/dsh-host.exe"
# 期望 7f290fc4…7d8e

"$INSTALL_DIR/SaCode.exe" --smoke      # 期望末行 SMOKE PASS
"$INSTALL_DIR/SaCode.exe" --ui-smoke   # 期望末行 UI_SMOKE PASS（19 条 UI OK）
```

**判据（`--smoke`）**：`initialize` 拉到 **35 条能力**（含 `global/appearance/{get,set-theme,set-font-size}` 由并发线 45df368/98ec4d5 落地）；`session/projection` 出 4 条消息；`session/subscribe` 5 个事件；未知方法 `-32601 method not found`；`durability 屏障: submit(durable=5) → flush(durable=6)`；`stop forced=false code=0 signal=null`；末行 `SMOKE PASS`。

**判据（`--ui-smoke`）**：`UI_SMOKE PASS` + 19 条 `UI OK` 覆盖：新建会话保存并自动打开、会话名称来自核心持久日志、主标题随实际会话切换、旧会话延迟投影不覆盖新会话界面、新会话不继承原会话消息、新会话预算独立初始化 + 全局主题保持、新会话不继承旧会话项目目录、新会话输入为空且焦点进入输入区、新会话清空草稿并收缩输入高度、新会话消息从核心重新投影、列表可切回默认会话、切回后恢复原会话草稿、切回后重新适配长草稿高度、新会话消息不会混入原会话、原会话预算恢复 + 旧主题保留、切回后恢复原会话项目目录、放行工具调用与结果写入会话日志、被拒调用按拒绝记账、审批 asked/decided 进同一份会话日志。

## 四、四段字节级一致（核心不变量）

**CLI 链**（三段相等）：
```
apps/cli/target/release/bin/main.exe
= npm/dsh-cli-win32-x64/bin/dsh.exe
= <隔离安装>/node_modules/@stand-alone/sacode-win32-x64/bin/dsh.exe
sha256 = c2bf44641bf59c881f789d39f3b18ab12ec240667562146b3d04ff4c4ce75bdc
```

**桌面链**（四段相等）：
```
apps/host/target/release/bin/main.exe
= dualtest/host-verify-fresh/bin/dsh-host.exe
= apps/desktop/dist/electron/win-unpacked/resources/host/bin/dsh-host.exe
= <NSIS 装包>/resources/host/bin/dsh-host.exe
sha256 = 7f290fc4591b00cdf1ea82be429ec65c23dfcbcbdb6a9f0a3bd3192609bc7d8e
```

**任一段哈希不等即说明该段不是「从当前 HEAD 复现出来的产物」**。

## 五、未覆盖项（不视为已完成）

1. **代码签名**：`signExecutable:false` 显式关，产物 NotSigned。三档阶梯（接受未签名 / Azure Trusted Signing / 商业 CA）需先定档；无公司主体默认走第一档。
2. **CLI `sig` 模式 4 FAIL**：本机 ConPTY 不投递 GenerateConsoleCtrlEvent；闭这条需真人按 Ctrl+C 或换 CI 环境。
3. **CLI `realstream` BLOCKED**：需真 provider base URL + API key。
4. **49 模块在宿主 NDJSON verb 面「未接入」**：矩阵相应行 ◐，`apps/host/src/main.cj` 与 `apps/cli/src/main.cj` 由并发线在飞，本会话不吞并不 revert。
5. **registry 上 `sacode-win32-x64@0.1.0` 的 inner dsh.exe 与本会话本机构建** sha256 不同（`2268bfc6…` vs `c2bf4464…`），差异来自 cjpm build 时间戳/中间符号；**行为面 175 条断言逐模式一致**即证明线上包已含 49 模块切片。若需要「线上包字节级等于本会话产物」需另行授权 `npm publish`（不可回退动作，本会话未做）。
