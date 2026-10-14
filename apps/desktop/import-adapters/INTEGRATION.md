# F19 / F17 独立模块集成清单

## 本批归属与交付边界

修改范围仅为 `apps/desktop/import-adapters/`、`apps/desktop/scan-adapters/` 及本批专项测试。未接公共 main/preload、Host/CLI、ACP、共享执行、核心会话日志或公共打包链。交接格式是待协调协议，不是当前产品已注册 RPC。

## 来源格式依据与兼容登记

当前解析器显式支持 JSON 数组、会话 id/title/current_node/mapping、节点 id/parent/message、消息 author.role/content.content_type/parts 的测试契约。全部样本为内存生成的合成夹具，尚无用户提供并允许验证的匿名真实导出，因此**不登记真实格式兼容 PASS**。

曾尝试读取 `https://help.openai.com/en/articles/7260999-how-do-i-export-my-chatgpt-history-and-data`，访问工具因域名解析到非公网地址拒绝，未取得页面正文，不能声称已核官方格式。即使官方导出说明可读，也须确认其是否定义稳定 JSON schema，不能由“支持导出”推导字段稳定。

目标来源登记：

| 来源 | 当前实现 | 实际证据 | 后续验收 |
| --- | --- | --- | --- |
| ChatGPT 上述结构化 JSON | 合成契约可解析、预览、交接 | Node 专项与跨模块测试 | 用户授权匿名导出，覆盖分支/隐藏/多模态/缺字段；核是否存在其他 ID 字段 |
| ChatGPT 分享网页、ZIP | 不支持 | 明确不接路径、网页抓取或解压 | 若确需支持，单独设计限额与安全边界 |
| 其他产品 | 未实现 | 无真实 schema/样本 | 先核来源再实现，不按猜测生成适配器 |

本条属于待验证登记，不把缺真实样本隐藏成完整兼容声明。后续尝试外部格式检索时，当前搜索服务返回 HTTP 402（余额不足），未取得来源资料；没有改动搜索端点、充值或安装其他工具。真实格式核验需用户提供授权匿名样本或可访问资料。本批可以继续完成独立代码边界，但这项外部验收保持待验证。

## F19 公共接线需要协调的事项

1. 读取文件由既有授权入口负责，先检查来源大小，再传 JSON 文本；限制并行工作线程，不能传任意 worker 路径或脚本。
2. 在实际 Electron 环境验证线程文件可定位、打包载荷齐备；当前包清单未修改，不能直接称安装态可用。
3. UI 预览需安全转义正文、展示跳过内容与损坏/重复/冲突，敏感正文向用户披露；哈希不是脱敏或来源认证。
4. 用户明确选择后构建交接，目标项目/修订/请求身份由可信调用方取得，不能允许来源文档决定目标。
5. 核心需要定义导入普通记录的权威存储与投影。不能把外部 assistant/user 文本追加成可重放的原生工具、审批或执行事件。
6. 幂等键、来源摘要、项目作用域、CAS、flush、取消安全点及结果报告由核心实现；模拟摘要测试不代替写入与恢复验证。
7. 重复请求、并发修订变化、撤销授权、取消/断连/持久失败均需真实入口用例，不能写成功后再补审批。

## F17 公共接线需要协调的事项

1. 提供方运行扫描器必须走现有执行授权/取消/结算链，取得真实状态与被扫描源码摘要，不能用外部声明伪造 executionStatus。
2. 在生成发现时绑定对应文件摘要；核心核项目/任务/请求身份，迟到报告不得污染新任务。
3. partial、failed、cancelled、unknown 保持原状态；usable 仅表示原范围可展示，不是通过或扫描范围完整。outsideScope 文件不得称已扫描。
4. current 快照需真实重读；软链接、大小写别名、非规则文件与资源作用域由核心判断，纯路径字符串不能承担隔离。
5. deep 标签不能替代真实跨函数数据流扫描。不同扫描器须独立证据，不提供假回显驱动。
6. 修复提案需要完整差异、所有受影响版本、独立写权限与最终 CAS；前置校验之后仍可能发生竞争，不能直接落盘。
7. 实际扫描器输出、超时/取消、失效报告、修复冲突以及打包态 UI 需独立验收。

## 验证命令与证据边界

在仓库根依次直接运行以下测试，避免启动全量套件或公共构建：

```powershell
node apps/desktop/test/import/conversation-import.test.mjs
node apps/desktop/test/import/conversation-import-worker.test.mjs
node apps/desktop/test/import/import-handoff.test.mjs
node apps/desktop/test/scan/scan-report.test.mjs
node apps/desktop/test/scan/scan-handoff.test.mjs
node apps/desktop/test/integration/adapter-integration.test.mjs
```

数量分别为 17、10、7、16、6、4，共 60 条。导入单候选与扫描归一结果新增累计字节检查，避免条数与单条限额组合成无界交接；稀疏消息/发现不能静默跳过。跨模块测试验证 worker→预览→选择交接→模拟已落库摘要，以及增量范围→报告→交接→外部修改失效→修复冲突；不发生真实持久化、扫描器执行、核心授权或安装。
