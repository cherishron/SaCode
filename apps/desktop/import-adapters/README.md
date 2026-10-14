# 会话数据导入来源适配器

本目录负责 F19 的来源格式解析与预览，不是另一份会话核心。当前新增代码与 ACP/CodeBuddy 控制线无依赖，不修改 main/preload、Host、CLI、共享核心或包清单。

## ChatGPT JSON 预览

`chatgpt.cjs` 导出 `previewChatGpt(text, options)`。输入为调用方已读取的会话导出 JSON 数组文本，不接受路径、不自行扫描用户目录、不联网。当前只支持包含 `id/title/current_node/mapping` 的结构化导出，不支持共享网页、压缩包或其他产品格式。

```js
const { previewChatGpt } = require('./chatgpt.cjs');
const result = previewChatGpt(exportText, {
  existing: [{ source: 'chatgpt', sourceId: '已导入来源 ID', fingerprint: '64 位小写十六进制摘要' }],
  signal: abortController.signal
});
```

结果分为：

- `candidates`：可供用户预览的候选，只含来源、标题、当前分支的普通用户/助手文本、指纹与警告。
- `duplicates`：批内重复或与调用方提供的已落库摘要一致。
- `conflicts`：相同来源 ID 内容不同；整组排除，不覆盖旧记录，也不由输入顺序决定保留版本。
- `issues`：损坏条目的位置与固定错误码，不回显解析异常载荷。
- `summary`：总数及上述四类计数。

默认上限：输入 16 MiB、2000 条会话、每条 20000 个节点、10000 条有效文本消息、单消息 1 MiB UTF-8。`limits` 只能收紧这些上限。非法 JSON、根形状、输入限额或现有摘要异常整批拒绝；损坏会话逐条报告，其余继续。

## 安全与接线边界

1. 系统/工具角色不进入候选正文，隐藏消息跳过；非文本内容报告不支持，不读取附件地址。
2. 白名单不复制配置、元数据、凭据字段、工具调用或来源脚本；正文与标题仍可能包含用户自己写入的敏感内容，**不是自动脱敏保证**。后续需在预览/确认阶段明确披露。
3. 来源正文是不可信文本，后续展示必须转义，导入不得成为新系统提示、授权凭据或可执行工具事件。
4. 指纹为规范化候选的 SHA256，未知元数据不参与；标题、消息顺序、正文与来源身份变化会改变指纹。只凭调用方提供的摘要做预览分类，不证明数据库状态未变。
5. 同步解析仍仅用于小输入或已有隔离的调用方。新增 `async-preview.cjs` 的 `previewChatGptAsync(text, options)`，在固定工作线程中解析；取消或超时只终止该次线程，等待退出后拒绝 Promise，不返回部分结果。默认超时 30 秒，可设 1–120000 毫秒；工作线程设置 V8 堆与栈上限，不提供任意脚本/模块加载接口。专项 Node 测试已验证线程取消、超时及并行隔离，但尚未接入 Electron，不能称 GUI 取消已验收。
6. 核心落库必须重新核对目标作用域、来源摘要与当前修订，执行独立授权、幂等追加及持久化；不能直接将外部消息伪造成原生执行事件。当前无 apply/落库接口，无 UI/IPC/打包接线，不宣称 F19 完成。

## 预览选择与交接

`handoff.cjs` 的 `buildImportHandoff(preview, selection, target)` 将预览变成明确选择的普通记录交接包。selection 为 `{sourceId,fingerprint,displayTitle?}` 数组；target 为 `{projectId,expectedRevision,requestId}`，只接受不透明身份，不接路径或自报审批字段。

交接前重新校验全部候选的白名单、角色、消息 ID 与内容指纹；陈旧选择、被修改预览、重复来源或消息、未知候选拒绝。只允许映射展示标题，保留原来源标题与指纹，不修改角色/正文。输出是独立副本，operation 为 `append-imported-transcripts`，不是可执行事件。现有摘要最多 10000 条，克隆到工作线程前只保留来源/ID/指纹。候选交接总量最多 16 MiB。

SHA256 是内容一致性检测而非认证；调用方能够重新计算指纹，核心不能把交接包当授权凭据，仍需核授权、项目身份与当前修订。当前数据结构是待协调的适配层交接协议，不声称 Host 已支持此方法。空白标题需用户显式映射非空展示标题。

## 专项测试

从仓库根运行：

```powershell
node apps/desktop/test/import/conversation-import.test.mjs
node apps/desktop/test/import/conversation-import-worker.test.mjs
node apps/desktop/test/import/import-handoff.test.mjs
```

测试使用内存构造夹具，覆盖当前分支、损坏条目、重复/冲突、白名单、未知内容、环与缺节点、限额、取消和指纹稳定性。不启动 Host/外部 Agent，不使用用户配置或模型，不占用共享编译输出。同步解析 17 条、工作线程 10 条、选择交接 7 条通过；未使用真实导出样本，不代表所有导出版本兼容。工作线程 V8 限额不等于进程总内存限额，调用方仍需控制并行预览数和传入摘要规模。
