# 三件套门禁修复记录（2026-10-16）

本批先修验收判据与静态门禁的扫描口径，避免退出码、旧分母或遗漏拆分模块把回归伪装成通过。验证范围是 Windows 本机 Node.js 22 的静态脚本与测试；没有运行完整仓颉单测、桌面安装态或真实模型请求。

## 变更

- `scripts/gate-verdict.mjs` 现在只接受非零检查数、`fail=0`、非零自证探针、`missed=0` 且 `baseline=green` 的完整 PASS 行；非零进程退出码始终判失败。
- `scripts/verify-output.mjs` 统一解析 cjpm 与 Node TAP 汇总，要求所有结果计数齐全且合计闭合、至少一项实际通过；零测试、全跳过、TODO、取消、失败、ERROR 和 FAILED 均不算通过。
- `scripts/verify-all.mjs` 的核心测试使用每轮独立 `--target-dir`，不删除或重试共享 `core/target` 的二进制，避免碰到其他会话占用的 worker。
- 桌面 IPC 门禁从 `main.cjs` 找到的实际注册调用继续扫描注册模块，并解析有限的字面通道、动作表及循环注册通道。当前工作区的 13 个注册模块覆盖 138 条 preload 方法。
- Host 门禁扫描 `main.cj` 的内联分派，以及实际由入口调用的 ACP、页面工具、工作树、提醒、团队、执行与历史等 8 个闭集路由谓词。历史证据 `p0-interface-freeze-2026-10-06.md` 的 82 是当时快照，已经过期；提交 `ef5d923ebcc7e4ace5e89759670c255992552763` 的当前分母为 158。

## 验证读数

当前工作区：

- `node --test test/gate-verdict.test.mjs test/verify-output.test.mjs`（工作目录 `apps/desktop`）：**5/5 通过**。
- `node scripts/check_ipc_surface_parity.cjs`：**138 个 preload 方法 ↔ 138 条已注册通道，8/8 检查通过**；`--selftest` **9/9 探针捕获，基线绿**。
- `node scripts/check_host_method_surface.cjs`：诚实失败。声明集 166 条，当前分母 158；路由集比声明多 `automation/control`、`automation/list`、`automation/save` 三条。`--selftest` 的 **12/12 探针均捕获**，但实际工作区基线为红，因此自证也保持失败。
- `node scripts/verify-all.mjs gates`：退出码 **1**；责任映射、路径责任、当前 IPC 门禁通过，Host 门禁红。执行器按首个失败停止，不继续声称后续项目已验。

固定提交态复核：

- 基线为 `ef5d923ebcc7e4ace5e89759670c255992552763`。从该提交读取 Host 源文件到 `apps/desktop/.tmp-test/host-gate-head-2aa0bd1f07c74534b8ee10889a5b7cd2` 的临时快照，并用本批检查器复跑：Host 分派与能力 **158/158**；`GATE: PASS (10 checks, fail=0)`、`SELFTEST: PASS (probes=12, missed=0, baseline=green)`。
- 同一提交的桌面 IPC 检查器发现已有三条真实缺口：`webSettingsDescribe`、`webSettingsApply`、`webSettingsSetCredential` 在 preload 有暴露但未注册 handler。其 `--selftest` 的 **9/9 探针均捕获**，基线按设计为红；这说明提交态该页面链尚未闭合，门禁不把它改写为绿。

上述分开的读数不能互相覆盖：固定提交 Host 基线通过，不会掩盖当前工作区新增的自动化能力声明缺失；当前工作区 IPC 通过，也不会掩盖固定提交中 Web 设置的旧缺口。后续产品批次应分别补齐对应真实入口，再重跑门禁。

本批没有暂存或提交其他会话的产品改动，也没有推送。
