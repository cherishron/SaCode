# 通用设置：繁忙发送行为接入取证（2026-10-06）

## 范围和实现

承接 DSH 现场已核实的「排队发送 / 插话发送」契约：普通 Enter 和发送按钮使用偏好，Ctrl/Cmd+Enter 使用另一行为；空闲时仍进入下一轮。共享仓颉核心保存偏好并决定送达位置，渲染层不自行制造送达事实。

- `core/src/global_appearance.cj`：用户级 `settings/busy-send`，旧文件默认 queue；租约下重读、原子发布，不覆盖主题和字号；保留原二参数快照构造接口。
- `core/src/inbox.cj`：next-step 入列可携带已绑定附件引用，沿用原 claimStep/claimTurn 契约。
- Host：有限 `global/appearance/set-busy-send` 协议及能力声明；queue/enqueue 读取真实运行状态、核心偏好与严格布尔 accelerated，返回实际 mode。
- Electron：有限 IPC、参数校验、真实会话输入框快捷键；回执到达才清空本次草稿，保留发送期间新增的附件，跨会话迟到失败不覆盖当前错误提示。
- `general-settings.ts`：`ui-settings-general` 声明槽位，`ui-conversation-preferences` 注入中文设置行；核心配置是业务真源。卸载贡献/父槽位可清理，dispose 后拒绝注册。该切片不等于全产品插件管理已经完成。

## 验证快照与限制

主仓：`D:/Project/sa/saai/sa-code`，HEAD `6f9cc45`，存在其他工作流的大量未提交修改。本批接线文件也未独立提交；不要把整个 working tree diff 当成本批改动。

隔离验证：`D:/Temp/SaCode-general-settings-20261005`，以 6f9cc45 为基点，复制本批核心、接线及桌面源代码。Host 为编译当前接线还带入当时工作区的 `prompt_enhance.cj`、`enhance_charge.cj` 依赖快照；不是仅由已提交 HEAD 构建。

主树核心有 `migration_pack.cj` 的编译错误，整页构建有在途 `custom-models.ts:190` 语法错误。本批未修改它们。隔离页装配使用已提交版本 `client-slots.ts`，避免载入在途模型中心页面。以下通过结果不可推算为最新整树、完整 CLI 或最终安装包通过。

## 已实测结果

| 验证 | 结果 | 边界 |
| --- | --- | --- |
| 隔离核心完整回归 | TOTAL 590 / PASSED 588 / SKIPPED 2 / ERROR 0 / FAILED 0，rc=0 | 本批后续仅补二参数兼容构造与断言 |
| 最终核心定向回归 | TOTAL 590 / PASSED 3 / SKIPPED 587 / ERROR 0 / FAILED 0，rc=0 | 587 为过滤排除，不是凭据跳过 |
| Host/IPC 初轮 | 12/12，rc=0 | 偏好重启、跨写保留主题字号、非法值、两种偏好下的互补送达 |
| 设置插件作用域回归 | 1/1，rc=0 | 真 SlotCore + Vue；贡献卸载、父槽释放、自用贡献注册和 dispose 护栏 |
| 实际整页冒烟 | 258 组 / 749 检查 / 0 failed，rc=0 | 设置实际保存；运行中 Ctrl+Enter 实际进入本轮用户消息，无需队列改送按钮 |

模型送达测试使用本机 HTTP/SSE 提供商夹具：首请求挂起，真实 todo_write 工具边界后检查第二次模型请求中仅包含插话条目；排队条目留给下一轮。不是外部 StepFun 真模型验收。

新增能力声明断言曾对旧构建宿主失败（接口能调用，initialize 能力清单缺新字段），说明该二进制早于声明更新。最后构建与握手复验结果随后记录，不用旧结果覆盖此红灯。

整页证据：`D:/Temp/sacode-busy-frame-review-20261006/captures/reports.json`；实页截图 `general-busy-send.png`。再次冒烟必须使用新的空会话目录；复用已有非空目录会在空页几何前置检查失败，不能算新功能失败，也不能删除现场掩盖失败。

## 未闭项

本批没有打新的 NSIS/npm 包，没有真实运行安装器，没有外部真模型测试。已安装窗口不会因此更新。权限、工作步骤四档、代码工作视图、快捷键编辑、链接打开方式、性能/用量展示、打开配置文件和 Agent 预设仍分别需要真实接入与验收；本项通过不将通用设置或完整前端标为完成。

## 最终宿主复验

重新编译隔离 Host 并重新组装自包含目录后，`busy-send`、`global-appearance`、`global-appearance-ipc`、`task-start-ipc`、`bridge`、`general-settings` 六组文件共 **53/53，0 fail / 0 skipped，rc=0**。握手已声明 `global/appearance/set-busy-send`。包括预先上传的文件凭证随插话入列、步边界送达并出现在历史附件投影。

新增附件用例首次 51/53：运行中调用 attachment/upload 被既有 `turn-in-flight` 护栏拒绝。调整为起轮前上传、运行中绑定与发送后 53/53。此结果仅证明已上传附件的插话送达；运行中选择并上传新附件仍是现存限制，不宣称完成。

最终日志：`D:/Temp/sacode-busy-desktop-verified-20261006.log`。整页 749 项证据的宿主早于最后能力声明重编，业务方法相同；新宿主的声明与业务由上述 53 项复验确认，没有把两份二进制当成同一份。整页截图可用于检查本批实际页面，未重新打安装包。
