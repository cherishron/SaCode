# 对话面组标签移除（「角色 · N 条消息」）与中性壳冒烟配方（2026-10-17）

**结论**：用户 10-16 深夜裁决——气泡上的「用户 · 1 条消息」「系统 · 1 条消息」前缀标签不要。已从渲染层移除并翻转冒烟断言；UI 冒烟（中性壳，本 agent 通道）**改后与基线副本同为 `UI OK 293 / UI FAIL 5`、失败集合逐条相同（零新增）**；关键断言双边验证：改前 `组标签=系统 · 1 条消息`、改后 `气泡组标签数=0`。裁决发生于 10-16 23:57（跨零点收尾），改动与取证在 10-17。

## 1. 变更（3 文件，工作区未提交）

| 文件 | 改动 |
|---|---|
| `apps/desktop/renderer/app.js` | 删 BubbleList `prefix` 槽（组标签唯一出处）与随之无用的 `roleName` 助手；注释注明用户裁决 |
| `apps/desktop/test-support/ui-smoke.cjs` | `组标签=<角色> · N 条消息` 断言翻转为 `气泡组标签数=0`（同计数替换，断言条数不减） |
| `apps/desktop/layout-smoke.cjs` | `messageLabels`（每个气泡必须带标签）检查改为 `noRoleLabels`（`#messages .msg-role === 0`） |

保留不动：`renderer/markdown.js` 流式占位标签「助手 · 流式输出」；`.msg-role` 样式（被流式标签复用；`#messages` 专属选择器已无消费者）。历史批次文档（`docs/superpowers/plans/2026-10-03-conversation-surface-tinyrobot.md` 等）按冻结区规则不改写。

## 2. 运行时验证

### 2.1 环境事实（本轮实测，先于验证本身发现）

仓库内 Low 标签的 exe **启动即被写锁死**，与产品代码无关：

- `node_modules/electron/dist/electron.exe`（继承仓库根 Low 标签）直启**立即段错误**（连 `--version` 都崩，rc=139）；复制到中性目录后 `--version` 正常（v33.4.11）。
- `dist/host/bin/sacode-host.exe`（Low 标签）经 2×2 探针（`target/tmp/role-label-removal-20261016/probe-host-settings.cjs`）实测：**对 Low 目录与系统 TEMP 创建 user-settings 均 `-13 Permission denied`**；对照组换成中性副本宿主后两处全通。"Low 进程可写 Low 对象"的预期在本机被实测否定——Low 宿主对任何目录写入都被拒。
- 推论：仓库内直接跑 UI/布局冒烟必红（先 Electron 段错误，再宿主全拒），此前 `目标/tmp` TEMP 重定向、`--no-sandbox` 等单点调整均无效；必须**中性副本**。

### 2.2 可用配方（后续会话可复用）

1. 中性 Electron：`D:\tmp\electron-neutral-20261016`（robocopy 自 `node_modules/electron/dist`，281,064,609 B，icacls 无 Mandatory 标签）。
2. 中性 App 壳：`D:\tmp\sacode-desktop-neutral-20261017`（`apps/desktop` 减 `node_modules`/`dist`，再烘入中性宿主 `dist/host/bin`）。
3. 启动（清 `ELECTRON_RUN_AS_NODE`）：`electron.exe --no-sandbox --disable-gpu . --ui-smoke`。
4. 增强夹具路径：`SACODE_SSE_FIXTURE=<repo>\scripts\sse-contract-server.cjs`（中性壳 `__dirname` 上溯三级找不到仓库 `scripts/`，不设会报 `Cannot find module 'D:\scripts\...'`）。
5. 归因对照：复制第二份壳、仅回退被测改动（基线 b1），同环境跑，比失败集合差集。
6. 先验：同壳 `--smoke`（协议腿）可先跑通做冒烟前置确认（本轮 `SMOKE PASS`）。

### 2.3 读数

- 失败形态留存（`target/tmp/role-label-removal-20261016/*.log`）：v4 系统 TEMP 下宿主 user-settings 全 `-13`；v5 Low TEMP 下同拒；默认沙箱 GPU 进程连崩后 `FATAL: GPU process isn't usable`。
- **v7（改后）与 b1（基线）**：均为 `UI OK 293 / UI FAIL 5`，失败集合**逐条相同（零新增）**（`ui-smoke-v7.log`、`ui-smoke-b1.log`）。
- 断言双边：b1 `UI OK 组标签=系统 · 1 条消息`；v7 `UI OK 气泡组标签数=0（应为 0；角色只由气泡形态与定位区分）`；`种子角色分布=1/1/1/1|组4` 双方均过（分组行为未受影响）。
- 5 条原样失败（工作区既有，与本改动无关）：preload 额外键清单、tips 两入口、「会话轨迹时间线子节点」、指南页审批入口、项目菜单 Escape。
- 布局冒烟本轮**不可跑**：`layout-smoke.cjs` 仍引用已被并发改动移除的 `#budget-input`/`#apply-budget`（脚本首句 `box('#budget-input')` 即抛），与本次改动无关；本改动的 `noRoleLabels` 检查已随文件就位，待该迁移收口后生效（本轮由 ui-smoke 断言覆盖）。

## 3. 边界

- `--no-sandbox --disable-gpu` 为通道夹具参数，不代表默认沙箱或安装态验收；真实双击（用户通道）仍为最终验收。
- 生效路径：改动在仓库源码（未提交）；用户当前运行实例（`D:\tmp\SaCode-latest`，10-16 构建）不含此改动，需下一轮构建/中性导出后可见。
- 未改产品代码以外任何系统项（未动 ACL/注册表）；一次性产物在 `target/tmp/role-label-removal-20261016/` 与 `D:\tmp` 中性区。
