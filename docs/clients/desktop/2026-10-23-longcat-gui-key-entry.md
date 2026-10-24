# 2026-10-23 GUI 界面填写 API 密钥与真实闭环补验

- 类别：⑦历史证据（本目录冻结，只增不改）
- 取证日：2026-10-23；执行：Qoder 会话（Windows 本机）
- 分支：`dev`；工作区未提交。探针与隔离数据根均在 `target/tmp/longcat-keyui-20261023/`，不入库。
- 授权：用户在本会话提供 LongCat 端点、模型与 API Key，并要求配置进应用、用真实模型自测。本文不出现密钥值。
- **结论：正常双击路径的「界面填写 API 密钥 → 隔离设置目录落盘 → 真实拉取模型 → 真实任务审批 → 重启回放」各项产品读数通过**。探针脚本第二轮的 `VERDICT=FAIL` 只来自它自己的事件分页检查（只读了第 1 页 64 条事件）；同一会话日志离线补读为 tool/call 2（read、write）、审批 1/1 `allowed-once`。**这仍不是用户亲手复验，不宣称版本已交付。**

## 1. 补验动机

前一份 [LongCat 真实主闭环](../../evidence/2026-10-23-longcat-real-task-loop.md) 的 GUI 轮把密钥注入进程环境，因此界面显示 `keyConfigured:true`、`credentialWritable:false`，密钥输入框由启动环境提供而只读。用户正常双击 `SaCode.exe` 时没有该环境变量，必须在界面里自己填 Key。本轮补的正是这条此前未验的链路：**无环境密钥 → 界面填写并保存 → 产品用文件层密钥发真实请求**。

## 2. 被测身份

| 项 | 值 |
|---|---|
| 候选目录 | `D:/tmp/sacode-final-20261023`（未改动） |
| `SaCode.exe` | SHA256 `403f56814b1bf02fd243fd17161f35c6bd08a31f1d64154f0182e9c192ad6044`（本轮复算一致） |
| 随包宿主 | `resources/host/bin/sacode-host.exe` SHA256 `e90998498778593f2dec0a01ddad8c8a3029d636d68dabdb1899821367404af9`（复算一致） |
| `app.asar` | SHA256 `03bb917d092bcf93e6c30a679c114e84528a3297cb50a3e6d5d3c9a69837400a`（复算一致） |
| 隔离数据根 | `target/tmp/longcat-keyui-20261023/root/{data,settings,temp,project}` |
| 项目 | `root/project`，独立 `git init`，初始 `README.md` 状态为「未完成」 |
| 模型 | 供应商 `longcat` / `LongCat-2.5-Preview`，端点 `https://api.longcat.chat/openai/v1` |

## 3. 隔离与密钥来源

- 启动时设 `SACODE_DATA_DIR=<root>/data`、`SACODE_USER_SETTINGS_DIR=<root>/settings`、`TEMP/TMP/TMPDIR=<root>/temp`，删除 `ELECTRON_RUN_AS_NODE`，传 `--no-sandbox` 与 `--remote-debugging-port=9334`。
- 子进程环境显式删除 `SA_CODE_LONGCAT_API_KEY`、`LC_KEY` 及旧的 `SACODE_PROVIDER_*`；探针在启动前断言这些键不存在（`key-env-leaked-into-child` 会直接中止）。
- 密钥来源是本机真实用户设置目录 `~/.sacode/user/credentials.env` 中的 `SA_CODE_LONGCAT_API_KEY`（32 字符）。探针只把它读入内存并输入界面，**不打印、不写入本文**；真实文件在补验前后均为 57 B、mtime `2026-10-19 20:40:48 +0800`，未被改动。
- 产品按设计把界面输入的密钥写入**隔离设置目录**的 `credentials.env`（`core/src/credential.cj` 明示：`user-file` 层是用户自有文件里的明文，不是系统钥匙串）。该隔离副本在取证后删除，见 §6。

## 4. 界面操作与读数

| 步骤 | 实测 |
|---|---|
| 初始状态 | `writable:true`、无 `longcat` 实例、无 `credentials.env` |
| 选内置目录 →「添加实例」 | `longcat` 实例创建成功；`keyConfigured:false`、`credentialWritable:true` |
| 「编辑 LongCat」 | 密钥输入框存在、`type=password`、`disabled:false`、`placeholder=""`（不是「由启动环境提供（只读）」） |
| 输入密钥 | 输入框长度 32；按钮「保存」可点击 |
| 保存 | 页面提示「已保存（能力按用户声明记录，未自动验证）」；`modelsDescribe` 变为 `keyConfigured:true`；隔离 `settings/credentials.env` 出现，57 B，含 `SA_CODE_LONGCAT_API_KEY`，值与输入逐字节一致 |
| 拉取模型 | 真实请求成功，提示「模型目录已拉取成功；后台已收束」，操作 `pull-b173b795-3476-4946-acb5-4a129e3fa63f`；模型 `["LongCat-2.5-Preview","LongCat-2.0"]` |
| 设默认模型 | `{"provider":"longcat","model":"LongCat-2.5-Preview"}` |
| 真实任务 | 发送 read→write 任务；审批卡「等待审批：写入文件（工单 #1，仅本次调用）」；点「允许一次」后 read、write 均完成 |
| 落盘与差异 | `README.md` 为「状态：已完成」；`workspaceGitDiff` `exitCode:0`，只含 `-状态：未完成` / `+状态：已完成`；`ERROR_BOX=""` |
| 关闭重开 | 用同一环境（仍无环境密钥）重启：`keyConfigured:true`（来自文件层）、`credentialWritable:true`、默认模型仍为 `LongCat-2.5-Preview`、模型目录两项仍在、工作区、消息、文件与 composer「选择模型，当前 LongCat-2.5-Preview」全部回放正确 |
| 收尾 | 两次 `window.close()` 后端口均下线；无 `SaCode.exe`/`sacode-host.exe` 残留；9333/9334 仅 `TIME_WAIT` |

## 5. 会话日志（持久真源）

`root/data/sessions/session.log`：22,244 B，SHA256 `4f0bffd60ec516f9e9a46393a7bcb0b1b8984303c757de43258c241280bbd4ba`，共 **107** 条事件（seq 0–106）：

```
workspace/directory 1、user/message 1、system/message 1、
knowledge/context/clear 1、knowledge/retrieval 1、
turn/start 1、request/header 3、stream/chunk 80、request/end 3、
assistant/message 3、tool/call 2、tool/runtime/call 2、tool/runtime/result 2、tool/result 2、
approval/asked 1、approval/decided 1、turn/end 1、turn/usage 1
```

以上 18 类合计 107 条，与文件事件总数相等（各计数由 `log-check.cjs` 的 `HISTOGRAM` 输出）。

- 工具调用：`read`（seq 31，`README.md`）→ `write`（seq 77，正文为「状态：已完成」）。
- 审批：`approval/asked`（seq 78，`1:write`）→ `approval/decided`（seq 79，`1:allowed-once`）。
- 助手最终答复含「状态：已完成」；日志中无「未完成」残留的消息。

## 6. 密钥落盘扫描

- 删除隔离副本前：整个 `root` 只有 `settings/credentials.env` 命中 1 次（预期存储位置），`session.log`、`providers.log`、Electron 日志均 0 命中。
- 取证后删除隔离 `credentials.env`；删除后递归扫描 `root` 命中 0。
- 另对探针目录与 `docs/` 共 **451** 个文件做密钥字面量扫描：`HITS=[]`、`CLEAN=true`；`run2.log` 等控制台日志不含密钥。同批文档登记完成后按同一命令复扫为 **453** 个文件，仍 `HITS=[]`、`CLEAN=true`；文件数增加来自期间 `docs/` 下新增文档，未作逐一归因。
- 真实用户 `~/.sacode/user/credentials.env` 未改动（见 §3）。产品把用户文件层密钥存为明文是既有设计事实，本轮不把它说成已加密。

## 7. 探针自身缺陷与更正

1. **首轮保存选择器错误**：供应商页的 CSS 前缀是 `ps-`，编辑器实际为 `fieldset.ps-editor`；首轮用了 `fieldset.editor`，得到 `SAVE_CLICK=missing-editor`，密钥未保存、`VERDICT=FAIL`。这是探针选点错误，不是产品失败；原日志保留为 [run-first-attempt.log](../../../target/tmp/longcat-keyui-20261023/run-first-attempt.log)，修正后才重跑。
2. **第二轮事件分页不足**：`sessionEvents(..., 0, 64)` 只返回第 1 页（`more=true`），因此 `approvalAsked/approvalDecided` 读到 0、工具名解析失败，探针的 `toolsOk` 为 false，脚本 `VERDICT=FAIL`。同一会话日志（§5）完整读出 107 条事件，`tool/call` 2 条为 `read`/`write`，审批 1/1 `allowed-once`。**以日记为持久真源，不因探针分页缺陷改判产品失败，也不把脚本的 FAIL 当产品通过证据。**
3. `sessionEvents` 的 `limit=200` 曾返回 `bad-limit`（上限 <200），属产品 IPC 的测试支持约束，非本轮新增缺陷；补读一律用 `limit=64` 翻页或直接读日志。

## 8. 可复核产物

| 路径 | 内容 |
|---|---|
| [gui-keyui-loop.cjs](../../../target/tmp/longcat-keyui-20261023/gui-keyui-loop.cjs) | 本轮补验探针（真实 DOM + CDP，无内部捷径） |
| [run2.log](../../../target/tmp/longcat-keyui-20261023/run2.log) | 第二轮完整读数（含 `VERDICT=FAIL` 与各步实测） |
| [run-first-attempt.log](../../../target/tmp/longcat-keyui-20261023/run-first-attempt.log) | 首轮选择器错误读数，保留不删 |
| [log-check.cjs](../../../target/tmp/longcat-keyui-20261023/log-check.cjs) / [log-check.out](../../../target/tmp/longcat-keyui-20261023/log-check.out) | 会话日志离线补读（107 条事件、read/write、审批 1/1） |
| [secret-scan.cjs](../../../target/tmp/longcat-keyui-20261023/secret-scan.cjs) / [secret-scan.out](../../../target/tmp/longcat-keyui-20261023/secret-scan.out) / [复扫输出](../../../target/tmp/secret-scan-rescan-20261023.out) | 密钥字面量扫描两次：取证时 451 文件、登记后 453 文件，均 `HITS=[]`、`CLEAN=true`；复扫输出放在被扫描目录之外，避免自计入 |
| `root/settings/providers.log` | 真实界面产生的供应商/默认模型记录（无密钥） |
| `root/data/sessions/session.log` | 本轮唯一会话真源（107 条事件） |
| `root/project/README.md` 与项目内 `git diff` | 真实落盘结果与差异 |
| `root/electron-*.log` | 首启/重启 Electron 日志 |

## 9. 未验边界

- **用户亲手复验仍是唯一最终验收**：本轮是自动化探针驱动真实界面，不能替代用户从唯一入口双击走通。
- 本闭环只用了 `read`/`write` 文件工具；shell、run_code、测试执行未验；D14（GUI 默认不设 enforcing、`run_code` 默认 `io-error`、bash 默认 fail-closed）不因本轮改变。
- 未验安装态（Setup/portable）、Linux/macOS 桌面实机、多供应商 failover（D24）、真实外部 MCP、D23 的 DeepSeek 链路。
- 候选包未重建、未改动；`--ui-smoke` 仍为 283/16（16 项已分诊为测试支持滞后），不因本轮改变。
- 未提交、推送、安装或发布。
- 本轮产生真实 LongCat 计费调用（模型目录拉取 1 次、真实任务 1 轮）；模型可用性与计费归外部服务。
