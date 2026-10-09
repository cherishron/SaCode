# 目标轮次持久检查点与失败冻结（2026-10-08）

## 基线

产品仓库 `D:/Project/sa/saai/sa-code`，分支 `refactor/dsh-learning`。开工 HEAD 为计划基线 `35a69ca9e0f8b7b6ac51271ec76eff3515eaa820`，收口观察 HEAD 为 `78f79e0727d5d6481e61dfbda438fdc5099442e6`，期间别的写者落了 glob 修复及 LSP 文档提交。本会话没有提交、暂存、推送、安装、发布或新增分支。此次仍为工作区实现，不能当作任一固定提交的验收。

## 实现及安全边界

- SessionLog 新增 durableCheckpointBatched，在完整事件行边界分批，每次调用既有 Windows 同句柄核对前缀、追加、Flush(true) 提供方；每批不超过 4096 字节。每批前后校验租约，不截断、不改旧事件格式。旧 durableCheckpoint 单批限制保留。
- 待提交总量最多 1 MiB，单事件行超过 4096 字节预先拒绝；这两种容量缺口不能靠拆坏日志行解决。中途 I/O 失败可能已持久部分完整前缀，但不能算整批成功，flushedCount 只在全部成功后推进。
- GoalCheckpoint 检查点失败冻结该 SessionLog 实例；追加、消息投影、事件快照抛 session-durable-frozen，旧 flush 也拒绝。不能用旧整写挽回未知部分提交。不释放租约；需明确新建实例从磁盘恢复，不重放命令或授权。
- GoalRunner 产品 start 的失败回调也执行冻结。GoalDriver 的完成 CAS 与完成检查点在同一日志锁内，读线程不能在内存 complete 与持久确认之间看到成功。失败返回 error:goal-settle-checkpoint-failed，不发 projection:goal。
- 兼容同步 Driver 默认检查点仍保留，仅产品 start 强制使用检查点；不宣称整个 W10 写入迁移已完成。Host/CLI 产品尚未调用此新入口，真实执行门禁仍关闭。

## 实测

私有副本 `.tmp-test/goal-product-source`，`cjpm test --no-run -i` rc=0。Windows 仓颉 1.1.3，stdx dynamic，TMP/TEMP/TMPDIR 为 D 盘私有目录，测试二进制使用现有 stdx DLL 路径。

直接运行 `core.exe --no-color --parallel=false --timeout-each=30s --no-progress`，**TOTAL 125 / PASSED 124 / SKIPPED 1 / ERROR 0 / FAILED 0，rc=0**。选定测试集，不是全量核心。跳过为缺真实模型密钥的测试。

本批三条点名通过：

| 测试 | 真实观察 |
|---|---|
| goalCheckpointPersistsMultipleCompleteLineBatches | 超过旧单批限制，实际 Windows 提供方分批追加；前缀不变，重载 181 个完整事件 |
| goalCheckpointFailureFreezesUnpersistedCompletionAndKeepsLease | 容量拒绝后内存 complete 不可读，旧 flush/追加拒绝，磁盘前缀不变，新实例仍 active，租约保留 |
| goalRunnerFailedFinalCheckpointCannotPublishComplete | 最后检查点用错误租约拒绝；异步返回错误，没有完成投影，磁盘重载仍 active |

后两条是故障条件测试，不代表真实磁盘损坏、断电或全部 I/O 故障已取证。完成读窗口由最终源码的同锁临界区约束；本批未宣称已取得 Host 并发读的运行证据。

最终日志为 `apps/desktop/.tmp-test/goal-checkpoint-atomic-build.log`、`goal-checkpoint-atomic-tests.log`。收口 141 个相关生产/选定测试文件与副本逐文件 SHA256 相同，清单 `goal-checkpoint-source-manifest.json`。辅助 appendSse 仅用于选定测试依赖。

核心测试二进制 SHA256 `A734BAFF865D2CC6E69853A983ADF26E26C371BC15B592301EC12FB346E9E296`。源码副本、清单、日志及二进制已留存到 `apps/desktop/.tmp-test/goal-checkpoint-proof/`，避免后续复用构建 target 覆盖本批证据。

## 继续实施

A/W90 将显式任务启动接到 GoalRunner.start，以 GoalCheckpoint 回调替代旧 flush；错误后保留租约并返回结构化错误，禁止继续消费冻结内存投影。第一轮与后续轮均在准入后从日志构造模型请求，轮内预算与最终计量不得重复。CLI 产品任务入口、Host 并发控制/中断恢复与真实服务分别取证；G/W60 的 Electron 启动仍需解锁。大单事件需独立契约扩展，不能自动改日志格式。
