# SaCode 统一验收运行手册（2026-10-05）

入口脚本：[`scripts/verify-all.mjs`](../verify-all.mjs)（Lead 落盘；`automated-test` 成员连续四次报告「已创建」但盘上没有，故由 Lead 据其交回的设计与自身实测信息写成）。

## 用法

```text
node scripts/verify-all.mjs                 # 跑全部 9 类
node scripts/verify-all.mjs core            # 只跑某一类
node scripts/verify-all.mjs core desktop    # 跑指定几类，按给定顺序
node scripts/verify-all.mjs --list          # 列出可选项
```

退出码：全部通过 0；任一步失败 1；用法错误 2。**任一步失败即停**，后续不跑——避免拿前半段的绿掩盖后半段的红。

## 9 类验证与预期

| key | 命令（工作目录） | 预期 |
|---|---|---|
| `core` | `cjpm test --no-color --no-progress`（`core/`） | `Summary: TOTAL: N`，`PASSED` + `SKIPPED` + `ERROR` + `FAILED` 合计等于 TOTAL；TOTAL 不得为 0 |
| `desktop` | `npm test`（`apps/desktop/`） | TAP `# tests N / # pass N / # fail 0`。**必须 `npm test`，不能写 `node --test test/`** |
| `extjs` | `node --test`（`extjs/`） | TAP 汇总，14/14 |
| `vendor` | `npm run vendor`（`apps/desktop/`） | pack-vendor / pack-tinyvue / pack-tinyrobot / pack-pages **四个标记都出现**（4/4） |
| `smoke` | `npm run smoke`（`apps/desktop/`） | 输出含 `SMOKE PASS` |
| `ui-smoke` | `npm run ui-smoke`（`apps/desktop/`） | 输出含 `UI_SMOKE PASS`，且 `UI OK` 计数 > 0、`UI FAIL` = 0 |
| `pack-cli` | `node scripts/pack-cli.mjs`（仓库根） | 输出含 `packed N 个文件到 ...` |
| `npm-install` | `node scripts/smoke-npm-install.mjs`（仓库根） | 输出含 `NPM_INSTALL_SMOKE PASS` |
| `real-model` | `node --test test/real-provider-e2e.test.mjs test/real-provider-tools.test.mjs`（`apps/desktop/`） | 两个用例通过；**缺凭据时标「跳过」而非失败** |

## 四个环境陷阱与排法

### 1. cjpm test 重链互锁

现象：`ld.lld: error: failed to write the output file: Permission denied`，stdout 0 行、没有测试汇总、`cjpm test` 退出码 1。

成因：上一个约 20MB 的 `core.exe` 被系统（实测为实时扫描/短暂占用）持有，紧随其后的重建链不回去。

排法：跑 `core` 前删掉 `core/target/release/unittest_bin/` 下的 `core.exe` 与 `std.testrunner.exe`。脚本内置三道：先清产物 → 撞锁才退避重试（最多 3 次）→ 重试前再清一次。

**只在这一种形态下重试**：匹配 `/ld\.lld: error|failed to write the output file|Permission denied/i`。其它失败立即停，不重试——否则会把真红灯拖成看似通过。

### 2. Electron 被当 Node 跑

现象：`TypeError: Cannot read properties of undefined (reading 'isPackaged')`，栈顶在 `main.cjs`。

成因：进程继承了 `ELECTRON_RUN_AS_NODE=1`，Electron 以 Node 模式启动，`app` 对象不存在。

排法：跑 `smoke` / `ui-smoke` 前删掉该环境变量。脚本用 `envWithoutElectronRunAsNode()`，按大小写不敏感匹配删除（Windows 环境变量名不区分大小写，只删 `ELECTRON_RUN_AS_NODE` 一种拼写会漏）。

### 3. npm 安装态验收必须保留 Node

现象：`'node' is not recognized as an internal or external command`，安装成功但 `sacode.cmd` 起不来。

成因：npm 包已声明 `engines.node`，启动包装器是 Node 脚本。把 Node 一起移出 PATH 不是包的缺陷。

排法：PATH 里保留 `process.execPath` 所在目录，只移除仓颉 SDK 相关路径。相关实现见 `scripts/smoke-npm-install.mjs`。

### 4. 桌面单测的目录坑

`node --test test/` 在本机 Node 下会把目录当模块解析，整串失败。必须 `npm test`（即裸 `node --test`，自动发现）。

## 汇总解析的两条防骗线

这两条都是被实测打脸后才加的，改脚本时**不要改回去**：

1. **TOTAL 为 0 不算通过**。测试根本没跑（链接失败、进程被杀）时 cjpm 也会打印 `Summary`，只是数字全 0。只看「有没有 Summary」会把 0 条当通过。故 `parseCjpm` 在 `total` 缺失或为 0 时返回 `ok: false`，主循环按失败处理。
2. **全 skip 不算通过**。`node --test` 在全部用例 skip（例如真实模型缺凭据）时也打 `# tests N / # pass 0`。`parseNodeTest` 现在区分「通过 / 跳过 / 未验完」三种结论，汇总里单独统计跳过数。

`ui-smoke` 与 `vendor` 同样要求正向标记出现才判通过，避免拿上一轮残留的 `UI OK` 计数或少数几步的输出当通过。

## 尚未纳入的验证（已知缺口，未猜实现）

- **Ctrl+C / SIGINT 背压**：`core/src/sigwin.cj` 与 CLI `sig` 子命令覆盖核心取消机制，但退出码契约未实测，故未写进入口——不想在无依据的情况下加一个会骗人的项。
- **崩溃残留租约接管**：`core/src/procwin.cj` 与 `takeoverIfStale` 同理。

## 实测状态

本文档记录的命令与陷阱均为 Lead 逐条实测过；`verify-all.mjs` 本身的完整执行结果见当轮汇报，不要在未跑的情况下引用它的通过结论。
