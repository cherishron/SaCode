# D23 reasoning_content 核心链路局部验证（2026-10-21）

## 范围与身份

未提交工作区，Windows x86_64，仓颉1.1.3/stdx1.1.3.1；内部诊断快照 `target/tmp/d23-20261021/snapshot`，不是新候选交付。生产只改 [sse.cj](../../core/src/sse.cj)、[model_agent.cj](../../core/src/model_agent.cj)、[model_request.cj](../../core/src/model_request.cj)，新增 [reasoning_content_test.cj](../../core/src/reasoning_content_test.cj)。未修改Host/前端，本轮不再修改MCP。

## 修复事实

- delta.reasoning_content 解析为独立 reasoning chunk，choice 0限定；空/null忽略，类型错误与finish后数据沿现有协议错误路径拒绝。
- Agent每请求独立拼接思考正文，在普通回答及tool_calls消息中均写入模型线格式assistant/message的reasoning_content字符串。TurnResult.text与content不混入思考；已有stream事实与背压仍生效。
- 请求重建校验思考字段字符串并保留；不补造旧日志字段、不从content推断。工具调用ID及结算守卫不变。

## 验证

隔离core中 `cjpm build` rc=0，35警告无错误。

`cjc --test-only` 链接隔离core库，输入 reasoning_content_test.cj、model_agent_test.cj、model_request_test.cj、attach_test.cj：**25总数、25通过、0跳过/失败/错误**。覆盖中文及换行分片、choice隔离、null、普通完成、工具调用后下一步、flush/load重建、旧消息无字段、非法历史字段。初次选取测试时遗漏pngBytes共享夹具导致编译失败，补入attach_test后通过，未修改原测试绕过。

另跑sse_test全文件：**33总数、23通过、1跳过、9错误**。首次从错误工作目录且未带scripts运行，网络夹具无法加载；补齐隔离scripts并从隔离core重跑，网络夹具在系统Temp目录mkdtemp报EPERM，9项仍错误。真实供应商用例跳过，重跑显式清空STEPFUN_API_KEY；无真实模型调用。保留失败证据，不宣称SSE全套通过。

一次性输出在 `target/tmp/d23-20261021/`：d23-test-results.txt、d23-sse-results.txt、d23-sse-results-rerun.txt。后两项含PowerShell编码输出，用搜索工具可定位错误。

## 状态边界

D23核心修复已实施、局部隔离验证通过，但真实DeepSeek思考模式+工具调用、统一Host候选与GUI/安装态待验；不据合成测试宣称缺陷全量闭合或产品交付。历史缺失思考记录不可恢复，不伪造补全。未提交、推送、安装、发布或发起收费请求。
