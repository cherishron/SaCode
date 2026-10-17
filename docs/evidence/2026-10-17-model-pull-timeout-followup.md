# D22 模型拉取超时复核：撤回 revision 判成功，保留结果未知（2026-10-17）

- 范围：Windows x64，桌面 IPC 工作区修复；未提交、未重打包、未替换用户安装目录。
- 前轮记录：[模型拉取超时修复](2026-10-17-model-pull-timeout-fix.md)。其中「全局 revision 前进即迟到成功」与据此闭合 D22 的结论**撤回**；历史原文保留，当前状态以本补记和 PRD 跟进台账为准。
- 产品入口：`sacode:modelPull` → `customs-ipc.cjs` → `HostBridge.request('model/pull')` → Host `GET /models`。

## 1. 复核发现与处理

全局供应商配置修订号可由其他写入推进；反过来，幂等拉取未必推进修订号。模型清单变化也不能唯一关联某次网络请求。因此前轮「等待 2.5 秒后查询 revision，前进就返回 late:true」可能伪报成功，不能作为正确的操作结算。

本轮删除该推断和固定 2.5 秒等待：

1. 保留模型拉取专用的 **30000ms 桌面等待窗口**，经 `main.cjs` 第三参传递；其余动作仍使用各自原有等待时间。
2. 仅在实际 RPC 成功帧返回时认定成功。不按 revision 或模型列表推断本次成功，不自动重发。
3. 仅精确匹配桥的 `timeout: model/pull`，转换为 `model-pull-timeout-unknown`，中文说明后台可能仍在处理，提示稍后刷新核对、不要立即重复拉取；其他 RPC/HTTP/宿主退出错误保持原样。
4. **30 秒只是桌面等待上限，不是 Host 的端到端网络预算**。Host 15 秒读取超时也不是连接、握手和读取整体总时限。本轮没有增加 Host 取消协议或请求级持久操作标识。

## 2. 可维护回归与实际运行

新增测试按职责落在 `apps/desktop/test/models/`，不把可维护断言只留在忽略目录。

| 验证 | 结果与范围 |
|---|---|
| IPC、原版 HostBridge 生命周期、模型目录刷新及修订测试 | **28/28 通过**，含新 handler 10 条和桥接时钟测试 3 条；无真实网络或凭据 |
| 合成时钟 + 实际 HostBridge JSON-RPC 路径 | 8 秒成功、其他动作仍 5 秒超时；30 秒后报未知、迟到 id 不污染新查询、不重发；HTTP 401 与宿主退出不伪报成功 |
| 模型中心现有单测 | **16/16 通过**；未修改模型中心页面源码或这些既有断言 |
| 真实 Host 可维护集成用例 | 显式 `SACODE_HOST` 指向用户 Downloads 中性验证包，**1/1 通过，6709ms**。本地 HTTP 实际延迟 6.5 秒，模型成功落库；后续 401 保持失败且 revision/模型清单不变；两次动作总共两个 HTTP 请求 |
| 前轮一次性端到端探针复验 | 真实中性 Host、8 秒响应，**8088ms** 返回、无 late、双模型入库；只证明 IPC/Host/本地 HTTP 链，不是完整 Electron UI 验收 |
| IPC 集合门禁 | **147/147 对齐，8 checks / fail=0**；无新增通道 |
| JS 语法检查 | `main.cjs`、`customs-ipc.cjs` 与本轮三个测试文件均通过 |

最终合并执行上述 IPC/桥接/目录/模型中心测试及真实 Host 集成：**45/45 通过，0失败、0跳过**（约6.9秒），输出在 `target/tmp/modelpull-followup-20261017/regression.txt`。这不包含下节已失败的四组页面渲染，也不代表完整桌面通过。放置守卫 **13 checks / fail=0**、自检 **10 probes / missed=0 / baseline=green**；本轮文档7文件 **252条相对链接、0缺失**，指定文件 `git diff --check` 通过。

没有显式 `SACODE_HOST` 时新增真实集成用例会注明原因跳过，不默认使用某份 dist 来冒充当前源码验收。测试只使用合成无效凭据、隔离用户配置根和本机 HTTP 服务。

## 3. 扩大回归的失败，单独保留

- 首次扩大执行 8 个测试文件共 **48 条，44 通过、4 失败**。四个失败来自模型设置渲染的亮/暗 × 1000/600 四组，每组同一断言「内置供应商目录字段只读且说明保存范围」未通过；报告中其余拉取并发/修订/失败提示等断言通过。尚无独立基线对照，不能断言失败由本轮引入，也不能称全页面验收通过。
- 该既有渲染夹具自行使用 `--no-sandbox`，本轮未更改其参数，不能据它判断默认安全启动。
- 前轮仓内 `model-pull-host.test.mjs` 在 `%TEMP%/.../settings` 创建时返回 -13，发生在实际拉取前。该失败不单独证明具体 ACL/完整性标签根因，不能仅凭中性 Host 成功就断言同根因；没有改权限或安全设置。
- 新增 handler 测试初版误假设修订允许字符串，实读 `customs-guard.cjs` 后按既有整数契约修正；没有扩展产品接口。

## 4. D22 状态与下一步

**部分修复、未闭合**。5 秒误超时和无依据成功推断已在工作区修正并取得定向运行证据；尚缺：

1. Host 端到端网络总预算、请求关联结果与安全取消/迟到结算方案；本轮不以 JS 层超时冒充已取消。
2. 页面级未知状态的持续展示与手动核对流程，防止将后台仍在途误当可安全重试。
3. 修复后同源重打包、默认安全启动、实际 Electron IPC 与用户安装态验证；当前 Downloads 旧包未变。
4. 模型页面四组失败的独立基线与归属确认。

## 5. 复验

在 `apps/desktop` 执行：

```powershell
node --test test/custom-models-ipc.test.mjs test/models/model-pull-timeout.test.mjs test/model-revision-precision.test.mjs test/host-bridge-lifecycle.test.mjs test/model-directory-state.test.mjs test/model-directory-invalidation.test.mjs
node --test test/model-center.test.mjs
# SACODE_HOST 须由调用方显式设置为中性位置宿主的绝对路径。
node --test test/models/model-pull-host-integration.test.mjs
```

桌面 package.json 未提供 lint 或 typecheck/ts:check 脚本；本轮未改 TS 页面，执行 JS 语法检查与上述定向测试，不把缺失脚本写成通过。未做全仓构建、全量 npm test、安装或发布。
