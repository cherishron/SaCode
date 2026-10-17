# D22 Host模型发现：总预算、取消与精确操作结果（2026-10-17）

## 1. 范围与构建身份

- 基线：HEAD `5c22a36` + 并发工作区；本轮未提交、不打正式安装包、不覆盖用户Downloads或默认dist宿主。
- 入口/平台：Windows x64，本地真实HTTP/TLS合成服务 → 新构建Host的NDJSON协议；桌面既有handler仅作一项兼容集成。
- 当前源码与依赖复制到 `target/tmp/model-pull-host-20261017-v1/workspace/`，单成员 `cjpm build --skip-script`，退出0；该私有副本不含build.cj，生产构建钩子未验。本批不占其他会话的target、不清理其进程。
- 源快照记录：`target/tmp/model-pull-host-20261017-v1/source-manifest-final.json`；包内同时包含并发线既有工作区源码，构建通过不是对那些功能的认领或验收。
- 经现有字节导出流程进入中性位置 `D:/tmp/sacode-model-pull-host-20261017-v1/bin/model-pull-verified.exe`；SHA256 `c40b45a5c2bbf99d0f130d0f084ba00fd07c8b90f9eec6c3ae2d1d059474fa1e`。未改ACL/完整性标签/防护设置。运行库沿既有SDK来源，本轮不解除来源未明修正版runtime的交付风险。

## 2. 实际改动

- `core/src/model_catalog_request.cj`：单调时钟总预算、精确取消、原始TCP socket与独占Client关闭、提交准入竞争。
- `core/src/model_catalog.cj`：可选control连接器及从信任锚准备到响应解析的监视；未传control的既有调用不新增监视线程，15秒读超时默认兼容。
- `core/src/provider_registry.cj`：拉取合并持有写租约，重放当前配置并核对expectedRevision；幂等清单不增加revision。
- `apps/host/src/model_pull_job.cj`：异步模型拉取、Host生命周期操作表、操作ID、总预算回执与真实资源结算分开、稳定脱敏失败、EOF取消收束。
- `apps/host/src/main.cj`：有限接线与两项能力声明；仅局部修改，保留并发执行隔离/工作区关闭接线。
- `docs/plans/host-capabilities.json`：新增两方法；当前源码/清单均178条。未扩展daemon远程面、Electron preload或页面。

协议细节见[接口契约](../interfaces/model-pull-lifecycle-2026-10-17.md)。默认网络总预算20秒、允许100–25000ms。成功视图新增operationId；查询/取消按该ID关联实际状态，不再凭全局revision猜成功。

## 3. 验证读数

| 验证 | 实际结果 |
|---|---|
| 最小网络控制仓颉切片 | cjc编译成功；先验证真实API而非猜测 |
| 当前完整私有Host | `cjpm build success`、BUILD_EXIT=0；Host有4条既有unused警告 |
| 使用当前完整core库的定向仓颉测试 | **16/16**，0跳过/0错误/0失败；6条新控制测试、4条原模型目录测试、6条原拉取合并测试 |
| 实际Host协议 + 桌面慢响应兼容集成 | **16/16**，0跳过/0失败；首次完整轮约10.5秒，补TLS显式取消后最终复验约6.85秒；15条Host生命周期用例 + 1条6.5秒真实handler集成 |
| Host源码方法门禁 | **178条**路由/声明相等，HEAD171条全部保留；11 checks / fail=0 |
| Host门禁自检 | **13 probes / missed=0 / baseline=green** |
| daemon既有契约回归 | **15/15**；新增Host控制方法没有隐式开放远程代理 |
| 产物放置守卫 | **13 checks / fail=0** |
| 桌面既有定向回归 | **44/44**，0跳过；本轮未改桌面生产代码，不包括前轮四组页面渲染失败 |
| IPC与文档校验 | IPC147/147、8项通过；放置自证10条通过；8份本轮文档317条相对链接、0缺失；指定差异空白检查与JS语法检查通过 |

原始结果：`target/tmp/model-pull-host-20261017-v1/host-integration-verified.txt`、`core-pull-tests.txt`、`host-build-current-snapshot.txt`。

实际覆盖：

1. 响应头一直不回，400ms总预算在约530ms整用例内返回、连接关闭、线程收束、配置不变。
2. 每25ms滴流但不结束，仍按总预算停止，不因有字节而无限刷新时限。
3. 取消及时应答，原请求带精确ID返回取消；服务端迟到写响应也不落库，下一次拉取独立成功。
4. 原桥150ms先超时后，按原operationId取回同一次操作的成功视图，网络只发一次。
5. 相同清单幂等成功（revision不涨），仍可查到succeeded；重复ID不重发。
6. HTTP401/坏JSON/陈旧revision/不存在供应商保持明确失败，旧模型不受影响。
7. 拉取在途拒绝同Host第二笔拉取与配置写，读面和取消继续应答；另一Host更新后旧拉取提交拒绝覆盖。
8. TLS服务接受TCP但不响应ClientHello，500ms预算后断开且收束；另有可信合成证书成功、不可信自签证书拒绝的对照，不关闭证书验证。
9. Host关闭时取消网络并正常退出，重启不追加旧结果；旧ID查询为unknown，自动ID有随机epoch，不碰撞。
10. 取消/提交临界区30轮竞争只有一个赢家；已完成失败不会日后变为超时。

## 4. 诊断过程限制与失败保留

- 首轮TLS停滞用例7/8：服务端socket没有消费ClientHello，未持续观察FIN；补socket.resume后8/8。不是降低断连断言。
- 首次可信TLS用例11/12：以IP URL访问合成证书失败；改用证书的DNS SAN `localhost`后可信/不可信对照通过。本轮不据此宣称IP HTTPS问题已修复，供应商域名外的IP场景待核。
- 一次最终重编失败：主入口新增并发线shutdownWorkspaces，私有core副本还是旧版；刷新完整core/Host快照并记录444文件哈希后构建成功。没有回退并发代码。
- 编译测试入口初次用了不适用的`--test-only`自包含切片；按工具文档改`--test`，可选Future补类型后切片编译成功；最终16条测试使用当前完整core库及`--test-only`，不是只靠切片通过。
- 技能：读取本机cangjie-coding SKILL并批量search_docs.py检索，核对两安装位置SKILL哈希相同；当前安装副本无README/上游提交信息，未声称完成来源版本核验。未重新安装/清理既有stdx。Context7作辅助，具体API以本机1.1.3编译与运行结果为准。
- OpenSSL仅为本机测试生成回环合成证书，显式用已装Git工具；私钥只存在忽略目录和测试进程，不入库、不输出，不构成用户额外安装要求。

## 5. 未闭合边界

- 总预算保证到期停止接受网络结果并禁止提交；DNS/底层不可中断调用若仍在跑，回执保留settled=false，继续保留资源，不声明强制线程回收。该系统调用停滞未做可控注入。
- 已赢得提交准入的磁盘操作不因取消伪报回滚；写后异常为outcome-unknown。磁盘故障、挂起提交和落盘持久关联的专项尚未完成。
- 操作表仅当前Host生命周期、最多128条，满时拒绝，不静默淘汰；容量回收未实现。
- 本轮新增Host查询/取消没有接桌面preload/页面；桌面仍30秒等待并在桥自身超时时提示unknown，不会自动按ID恢复，也没有可见取消按钮。
- `model/list`等未传control的既有调用、系统代理、全部供应商、其他平台、全量core/桌面测试未宣称通过。
- D22保持部分修复；旧包未替换、正式打包/默认安全窗口/安装态均待后续授权与验收。

## 6. 复验命令

```powershell
# 显式指定本轮构建中性Host；不得以旧dist替代。
$env:SACODE_HOST='<当前源码构建的绝对Host路径>'
# 仅本地TLS测试需要；缺此变量时该用例明确跳过，不自动安装。
$env:SACODE_TEST_OPENSSL='<已安装openssl.exe绝对路径>'
node --test apps/host/test/models/model-pull-lifecycle.test.mjs apps/desktop/test/models/model-pull-host-integration.test.mjs
node scripts/check_host_method_surface.cjs
node scripts/check_host_method_surface.cjs --selftest
node --test apps/daemon/test/remote-capability-contract.test.mjs
```

没有根package.json；桌面package.json无lint/typecheck脚本，本轮以仓颉完整私有构建、定向测试、格式检查和JS语法检查验证，不把缺失脚本当PASS。
