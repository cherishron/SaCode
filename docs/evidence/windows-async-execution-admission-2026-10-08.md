# Windows 异步执行准入增量取证（2026-10-08）

## 新完整核心的前置验证

稳定快照核心库 SHA256 76a059b365cc3f98f5a13f0ad505ccf1a7ba28ee993511afad23e9597a711d2f，22 条执行契约测试全通过，详见 execution-shared-freeze-2026-10-08.md。不等于公开提供方已接线。

## 大型工具校验红灯

新完整核心直接链接异步 AppContainer 探针，87 MB Node 文件的 sha256Hex(File.readFrom(exe)) 触发 Out of memory，exit=1，未写 session.log。原件：C:\Users\jingg\AppData\Local\Temp\sacode-new-async-225c41cc3eda4c59a9204272e8a6e82f/stop.log。流式摘要探针修订后成功进入独占写者断言，但 service.propose 仍调用静态库内旧 ExecutionSandboxPolicy，再度 OOM，exit=1；原件：C:\Users\jingg\AppData\Local\Temp\sacode-bounded-async-37938ae7decc495db1dd895034988843/stop.log。不能把选定文件替换等同于所有核心调用已更新。

## 有界摘要修复与向量

sha256.cj 提取既有压缩轮，不改常量或位运算；sha256_file.cj 固定读取缓冲64KiB、块64字节、64词调度及8词摘要。ExecutionSandboxPolicy 文件身份校验换为流式摘要。原向量2条+新增文件向量2条全部通过，TOTAL=4 / PASSED=4 / SKIPPED=0 / ERROR=0 / FAILED=0，exit=0。新增用例覆盖 padding、65536读取边界、缺文件与字节篡改。证据：C:\Users\jingg\AppData\Local\Temp\sacode-stream-hash-c7ea82f5584c4b51bd22bd9ebe1d5f7d/build.log、tests.log、manifest.json。

## 当前未收口

正在独占临时目录重建包含流式修订的完整核心；随后复跑真实隔离异步请求、双流在途落盘、停止、句柄登记失败、准入不可重放和恢复。公开 Host/CLI 提供方仍未装配，未升级产品完成状态。新增探针是只在测试进程内注入可信提供方，不向 RPC 暴露放行值。所有增量未提交。

## 完整流式修订核心与后续红灯
包含流式摘要的完整核心 build exit=0（33.26 秒），libcore.a SHA256=2a04b1f1f65b1064b44ee494bffbbd55fad8a7417f4a6461ad318e956aefc2e4。指定执行+摘要26条全部通过，TOTAL=26/PASSED=26/SKIPPED=0/ERROR=0/FAILED=0，exit=0，28.12秒；日志 C:\Users\jingg\AppData\Local\Temp\sacode-bounded-tests-660ead77d4f74e99a505d6971d6269ce/test.log。
大型 Node 异步探针本轮未再出现 OOM，但240秒超时退出，不算通过；需要继续收口大型工具摘要性能。小型真实双流进程夹具的异步 stop 场景通过；持续高频输出夹具曾超过15秒观察窗口，未作为成功。句柄回调失败场景复现启动停止重复写 broker stdin，stream write error，日志保持 unknown；正修为写锁内只发送一次停止命令。修后完整核心与该真实场景待验。

## 启动停止竞态修复后的真实闭环
WindowsJobExecutor 将停止标记放入现有命令写锁，两线程共用 AtomicBool，确保停止只发送一次；不掩盖第一次写入失败。修后完整核心 build exit=0，25.00秒；库SHA256：92287370b475eecd0ec1baee183b21848ffa5cac5a43130590fce7080063c840。真实 AppContainer stop 与 callback-failure 两场景均 exit=0，两个 WINDOWS_ASYNC_PASS；包含双流在途持久化（stop）、句柄登记失败保留原始错误、取消确认退出+双EOF、一次性准入拒重放、磁盘恢复保留退出与最终释放租约。证据：C:\Users\jingg\AppData\Local\Temp\sacode-stop-once-async-44b604cbf41e4ed5a80395dc6679edf0/manifest.json、stop.log、callback-failure.log。真实夹具为小型C#双流进程，产物及源码位于同一目录；公开提供方仍未装配，大型Node性能仍未收口。

2026-10-09 00:04 追加复验：停止去重修订核心链接26条执行/摘要测试再次全通过（22.39秒），日志 C:\Users\jingg\AppData\Local\Temp\sacode-stop-once-tests-4c595d717c604a4b88dff8c925cc0895/test.log，exit=0。两真实隔离场景的自持进程 PID5684与4876均已消失，cleanup-proof.json记录命令夹具与探针产物哈希及当前进程库存对照，路径 C:\Users\jingg\AppData\Local\Temp\sacode-stop-once-async-44b604cbf41e4ed5a80395dc6679edf0。
旧统一快照Host构建达到1800秒观察预算，工作脚本返回 stage-timeout-process-live；重新查证 cjpm14960/cjc10384/llc2492仍存活，llc CPU持续增加，不计编译失败或终止，不重启。CLI顺序阶段尚未执行；Host新监督/提供方仍待完整产品验收。
