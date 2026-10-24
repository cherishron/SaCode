# 2026-10-23 LongCat 真实模型主闭环（宿主级与 GUI 级）

- 类别：⑦历史证据（本目录冻结，只增不改）
- 取证日：2026-10-23；执行：Qoder 会话（Windows 本机）
- 分支：`dev`；构建时 HEAD `83837c1ef2380d969d7c534f1dd0d733d54b8d80`，工作区有未提交改动。本轮探针全部位于 `target/tmp/longcat-real-20261023/`，不入库。
- 授权：用户在本会话明确提供 LongCat 端点、模型与 API Key，并要求配置进应用、用真实模型自测主闭环。密钥只经进程环境注入，未写入数据根、会话日志或本记录；文中不出现密钥值。
- **结论：宿主级与 GUI 级真实任务闭环均 PASS**——真实模型读取项目、提出并执行文件修改、用户审批、真实落盘与 diff、关闭重开后记录和文件回放正确。**这仍不是用户亲手复验，不宣称版本已交付**。

## 1. 被测身份

| 项 | 值 |
|---|---|
| 候选目录 | `D:/tmp/sacode-final-20261023`（2026-10-23 01:49 中性导出） |
| `SaCode.exe` | SHA256 `403f56814b1bf02fd243fd17161f35c6bd08a31f1d64154f0182e9c192ad6044` |
| 随包宿主 | `resources/host/bin/sacode-host.exe` SHA256 `e90998498778593f2dec0a01ddad8c8a3029d636d68dabdb1899821367404af9` |
| `app.asar` | 7,976,296 B，SHA256 `03bb917d092bcf93e6c30a679c114e84528a3297cb50a3e6d5d3c9a69837400a` |
| 数据根 | `target/tmp/longcat-real-20261023/gui-root/{data,settings,temp,project}` |
| 项目 | `gui-root/project`，独立 `git init`，初始 `README.md` 状态为「未完成」 |
| 模型 | 供应商 `longcat` / `LongCat-2.5-Preview`，端点 `https://api.longcat.chat/openai/v1`，协议 `openai-completions`，凭据引用 `SA_CODE_LONGCAT_API_KEY` |

## 2. 隔离与凭据

- 启动时设 `SACODE_DATA_DIR=<gui-root>/data`、`SACODE_USER_SETTINGS_DIR=<gui-root>/settings`，`TEMP/TMP/TMPDIR=<gui-root>/temp`，删除 `ELECTRON_RUN_AS_NODE`，传 `--no-sandbox` 与 `--remote-debugging-port=9333`。
- 工作区用一次性宿主 `workspace/set-directory` 预置绑定，避免 CDP 无法操作原生目录对话框；GUI 启动后直接使用该会话。
- 真实密钥仅以 `SA_CODE_LONGCAT_API_KEY` 注入 GUI 与宿主的进程环境。GUI 供应商页显示 `keyConfigured:true`、`credentialWritable:false`，并提示该供应商密钥由启动环境提供（只读）。
- 收尾递归扫描整个 `gui-root`（含 `session.log`、`providers.log`、Electron 缓存）：`KEY_ON_DISK_FILES=[]`。会话日志与设置文件均不含密钥。

## 3. 宿主级主闭环（协议直连）

探针 `host-task-loop.cjs` 直接驱动随包宿主：`model/registry/update`（revision 0 → 1，模型 `LongCat-2.5-Preview`）→ `model/registry/set-default`（expectedRevision 1）→ `workspace/set-directory` → `session/submit`（user/message）→ `task/start` → 轮询 `approval/asked` 并 `approval/answer` → `turn/poll`。第二轮读数（[task-loop-out2.log](../../target/tmp/longcat-real-20261023/task-loop-out2.log)）：

| 读数 | 实测 |
|---|---|
| `SET_DIR` / `WORKSPACE` | 目录已保存，`configured:true`、`available:true` |
| `TASK_PROVIDER` | `real` |
| `ASKED` | 1 条 `write`，参数为 `{"path":"README.md","content":"# 小项目\n\n状态：已完成\n..."}` |
| `ANSWERED` | `{"id":1,"accepted":true,"state":"allowed-once"}` |
| `SETTLED` | `settled:true`、`interrupted:false`、`finishReason:"stop"`、`used:12659`、`frames:6`；回复明确说明已用 read 读取、用 write 重写 |
| `FILE_AFTER` | `状态：已完成` |
| `GIT_DIFF` | `exitCode:0`，含 `-状态：未完成` / `+状态：已完成` |
| `LOG_EVENTS` | user/message 1、assistant/message 3、tool/call 2、tool/result 2、tool/runtime/call 2、tool/runtime/result 2、approval/asked 1、approval/decided 1 |
| `TOOL_CALLS` | `["read","write"]` |
| `LOG_HAS_KEY` / `KEY_ON_DISK` | `false` / `[]` |
| `PROJECTION` | total 7、assistant 3、toolResult 2、含用户任务正文 |
| `STOP` / `STOP2` | 均 `code:0`、`signal:null`、`forced:false` |
| `RESTART` | 同目录冷启动后 total 7、assistant 3、toolResult 2、文件仍为已完成、日志不含密钥 |
| `VERDICT` | **PASS** |

首轮同一探针曾出现 `GIT_DIFF={"exitCode":-1,"failure":"bad-git-path"}` 并判 `FAIL`；同一候选第二轮 `exitCode:0`，GUI 侧 `workspaceGitDiff` 也为 `exitCode:0`。首轮异常未再复现，首轮探针版本未保留，**不把它归因为产品缺陷，也不拿首轮当通过证据**；宿主级 `workspace/git-diff` 的稳定性仍列为未验边界。

## 4. GUI 级主闭环

### 4.1 供应商与模型（`gui-step1.cjs`、`gui-step2.cjs`）

- 模型中心是旧版「供应商管理」页（tab `provider-settings`），内置供应商目录含 `longcat|LongCat`；本轮全程用真实界面控件操作，不直接写配置文件。
- `MODELS_BEFORE`：revision 0、无实例。
- 选内置 `longcat` → 点「添加实例」后：revision 1、`keyConfigured:true`、`credentialWritable:false`。
- 点行内「拉取 LongCat 模型目录」后：revision 2，模型 `["LongCat-2.5-Preview","LongCat-2.0"]`，界面提示「模型目录已拉取成功」。
- `select[aria-label="默认模型 LongCat"]` 选中 `LongCat-2.5-Preview`：默认模型 `{"provider":"longcat","model":"LongCat-2.5-Preview"}`。
- 持久文件 `gui-root/settings/providers.log` 与上述一致：2 条 `provider/upsert`（第二次带模型目录）、1 条 `provider/default`，无密钥字段。

### 4.2 真实任务与审批（`gui-step3.cjs`）

- composer 模型触发器（`.model-select-trigger`）显示 `LongCat-2.5-Preview`。
- 通过真实输入框发送任务：「请使用工具完成这个工作区里的任务：先用 read 工具读取 README.md，然后使用 write 工具把其中的“状态：未完成”改为“状态：已完成”，其余内容保持不变。必须真实调用 read 和 write 工具，不要只在回复里说明。」
- 发送后 `SEND_ENABLED=true`；审批卡出现：`等待审批：写入文件（工单 #1，仅本次调用）`，参数完整显示目标 `README.md` 与写入正文；点击「允许一次」。
- 模型实际工具链：`read` → `write` → `read`（写入后复读确认）。
- 落盘结果：`README.md` 第 3 行为 `状态：已完成`；`git diff` 只有一行变化：`-状态：未完成` / `+状态：已完成`，`exitCode:0`；`ERROR_BOX=""`。
- 会话日志（`gui-root/data/sessions/session.log`，28,128 B，SHA256 `2097eeba…72df8`）共 **142** 条事件：

```
workspace/directory 1、user/message 1、system/message 1、knowledge/context/clear 1、
knowledge/retrieval 1、turn/start 1、request/header 4、stream/chunk 108、request/end 4、
assistant/message 4、tool/call 3、tool/runtime/call 3、tool/runtime/result 3、tool/result 3、
approval/asked 1、approval/decided 1、turn/end 1、turn/usage 1
```

- 工具调用按序为 `read`（seq 41）→ `write`（seq 81）→ `read`（seq 98）；审批为 `approval/asked 1:write`（seq 82）→ `approval/decided 1:allowed-once`（seq 83）。
- `request/header` 4 条均为 `model:"LongCat-2.5-Preview"`（initial + 3 次 series）；`turn/usage` 原始值 `18784:18784`。
- 日志中没有「未完成」残留的 assistant 消息，也没有密钥。

### 4.3 关闭重开与回放（`gui-step4.cjs`）

- `window.close()` 后调试端口下线；同环境重启（当轮输出 `RESTART_PID=11960`），未重建数据根。
- 重启后：`WORKSPACE` 仍指向 `gui-root/project`；`DEFAULT_MODEL` 仍为 `longcat/LongCat-2.5-Preview`（模型目录持久）；消息完整回放（read/write/read 与最终答复）；composer 仍显示 `LongCat-2.5-Preview`；`README.md` 仍为已完成。
- 当轮 `CHECKS` 五项全 `true`；最后再次关闭，`PORT_DOWN_FINAL=true`。
- 重启落盘物证：`gui-root/electron-err-restart.log` 有 `DevTools listening on ws://…`；`artifact-readout.log` 的 `restartArtifact.devtoolsListening=true`。

## 5. 可复核产物

| 路径 | 内容 |
|---|---|
| [artifact-readout.cjs](../../target/tmp/longcat-real-20261023/artifact-readout.cjs) / [artifact-readout.log](../../target/tmp/longcat-real-20261023/artifact-readout.log) | 只读汇总：工作区、供应商 revision、模型目录、默认模型、README 状态、diff、142 条事件直方图、工具/审批、密钥落盘扫描、重启日志 |
| [host-task-loop.cjs](../../target/tmp/longcat-real-20261023/host-task-loop.cjs) / [task-loop-out2.log](../../target/tmp/longcat-real-20261023/task-loop-out2.log) | 宿主级闭环探针与第二轮 PASS 日志；首轮日志 [task-loop-out.log](../../target/tmp/longcat-real-20261023/task-loop-out.log) 保留失败读数 |
| `gui-step1.cjs`～`gui-step4.cjs`、`cdp-client.cjs`、`log-tools.cjs`、`usage-readout.cjs` | GUI 四步探针、CDP 驱动与会话日志解析（均在 `target/tmp/longcat-real-20261023/`，不入库） |
| `gui-root/settings/providers.log` | 真实界面产生的供应商与默认模型持久记录（无密钥） |
| `gui-root/data/sessions/session.log` | 本轮唯一会话真源（142 条事件） |
| `gui-root/project/README.md`、项目内 `git diff` | 真实落盘结果与差异 |
| `gui-root/electron-err.log` / `electron-err-restart.log` | 首启/重启日志；首启 stderr 含探针 `bad-limit`，见下 |

## 6. 探针自身缺陷与更正

1. **`sessionEvents` 分页上限**：首轮补读用 `limit=200`，主进程返回 `bad-limit`（上限 <200）。产品主闭环已完成，该错误只来自探针；改 `limit=64` 并用 `gui-step3b.cjs` / `gui-step3c.cjs` 翻页，统计到全部 142 条事件。`gui-root/electron-err.log` 保留这条 `bad-limit` 栈，属探针缺陷，不是产品失败。
2. **composer 选择器**：最初 `button[aria-haspopup="menu"]` 先命中「添加内容」按钮；改用 `.model-select-trigger` 后才读到真实模型标签。
3. **宿主级首轮 `bad-git-path`**：见 §3，未复现，未归因产品。
4. GUI 四步的完整控制台输出未 tee 到日志；可从磁盘产物复核的读数已汇总进 `artifact-readout.log`，其余（重启 PID、`CHECKS` 五项、审批文案、composer 标签）来自当轮工具输出。

## 7. 未验边界

- **用户亲手复验仍是唯一最终验收**：本轮是自动化探针（宿主协议 + CDP 驱动真实界面），不能替代用户从唯一入口双击走通。
- 本闭环只用了 `read`/`write` 文件工具，**未验证 shell、run_code、测试执行**；D14（GUI 默认不设 enforcing、`run_code` 默认 `io-error`、bash 默认 fail-closed）不因本轮改变。
- 未验证安装态、portable/Setup、Linux/macOS、多供应商 failover（D24）、真实外部 MCP、D23 的 DeepSeek 链路。
- 未提交、推送、安装或发布；交付候选目录与旧证据未改动。
- 本轮产生了真实 LongCat 计费调用（宿主轮 `used:12659`，GUI 轮原始 `18784:18784`）；模型可用性与计费归外部服务。
