# R2 Host获批编辑后的真实冷启动持久性验证（2026-10-18）

## 范围与候选

- 用户指定R2候选：`D:/tmp/sacode-delivery-R2-20261018/win-unpacked/resources/host/bin/sacode-host.exe`，SHA256 `a01957e0e68d6185a6a082e76161b62dd14b0c657f674a7a65e0d5e825e74f1f`。未重建、修改或另出候选，未改生产代码、未提交/推送。
- 可维护测试：`apps/host/test/session/cold-restart-edit.test.mjs`，由用户指定managed Node 22.22.2运行。
- 本地合成HTTP模型提供read/edit调用；**真实Host执行read和获批edit**。没有真实LongCat请求、真实凭据、GUI或产品受控执行器测试；加法单测由外部managed Node执行，范围单独标注。
- 前轮[三路径协议记录](2026-10-18-r2-three-path-protocol.md)的 `coldRestartVerified:false` 保持原样。本轮另起两个真实进程取得新证据，不把旧日志读取改称冷启动。

## 执行与结果

测试 **1/1通过，零跳过**。证据目录：`D:/tmp/opencode-cold-restart-nr5wzi/`，包含result.json、rpc-before-close.json、rpc-after-restart.json、session/session.log及合成项目。

| 项 | 关闭前进程 | 冷启动新进程 |
|---|---|---|
| PID | **36216** | **9528**，新HostBridge对象、新子进程，同一会话目录 |
| 会话事件数 | 40，durable=40，pending=0 | 40，完整投影逐项相同 |
| 投影消息数/内容 | 8，包含实际工具结果、中文及引号/反斜杠/换行标记 | 8，messages和messageRows逐项相同 |
| 分页事件 | 7条一页，共6页，收齐40事件 | 序号、类型和已开放data逐项相同 |
| 权限模式 | 最终显式保存 **plan**（非默认build，更保守） | approval/get-mode读取 **plan** |
| 工作区/请求追踪 | RPC记录工作区绑定与3次请求追踪 | 新进程RPC回放逐项一致 |
| 文件 | 真实获批edit将 `a - b` 改为 `a + b` | 仍为 `a + b` |
| 外部加法单测 | 修改前exit1，修改后exit0 | 重启后exit0；测试源码哈希始终相同 |
| Host退出 | code=0、signal=null、forced=false | code=0、signal=null、forced=false |

session.log长7539字节，关闭前、首进程退出后、新进程查询后及第二次退出后字节完全相同，SHA256均为 `b22f3965bfe45be7aebc8875e2db9cbd1472cbccefd8bd38ded3913c3b925ad7`。

## 不以读文件冒充冷启动的证据

1. 第一进程执行完真实工具链，核验实际ok-read/ok-edit、一次allowed-once审批、pendingToolCalls=0、正常stop终态。
2. 第一进程通过关闭stdin触发EOF正常收束；实际观察exitCode=0后才启动第二进程，断言进程对象及PID不同。
3. 第二进程仅发送明确只读RPC白名单：initialize、session/projection、approval/get-mode、workspace/get、session/request-trace、session/subscribe（6页）。没有append、select、mode写入、task/start、turn/start或审批应答。
4. 记录条数及内容的一致性来自**新进程的RPC回放**，不是驱动解析日志伪造投影。日志字节/文件与测试仅作额外持久性检查。
5. 模型HTTP请求总数重启前后均为3，新进程没有重新请求模型或重放编辑；只读回放及第二次正常关闭没有追加会话事实。

结果明确登记 `coldRestartVerified:true`、`readOnlyReplayVerified:true`。两次正常关闭、同目录新进程回放均实际执行，不是同进程reload。

## 验收边界

- 通过的是正常关闭后的**协议层Host持久回放**，不是断电/crash恢复、GUI关闭重开、安装态或其他平台保证。
- 当前仍缺LongCat进程凭据，因此没有真实远端模型任务通过结论；合成模型不冒充真实模型服务。
- 未修改系统权限、防护或沙箱，不读取用户配置/密钥；子进程不继承供应商凭据，PATH仅系统目录，依赖候选相邻DLL。
- 外部Node执行测试不等于产品受控命令执行。完整版本仍是未交付/候选待验；A3及运行库正式分发边界保留。

## 复验

显式设置 `SACODE_HOST` 为上述R2包内Host，`COLD_EVIDENCE_PREFIX` 为独立中性取证前缀，然后用managed Node执行：

```text
node --test apps/host/test/session/cold-restart-edit.test.mjs
```

缺SACODE_HOST明确跳过，不自动借旧dist；没有模型凭据也能运行本地合成验证。不自动提交、发布或安装。
