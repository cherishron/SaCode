# 会话持久化与并发修复

- 日期：2026-10-13
- 范围：`core/src/session.cj`、`lease.cj`、`filewin.cj` 及专项回归；不改桌面前端、Host IPC 或 codex 文件。
- 技术：仓颉 1.1.3 cjnative，Windows x64；原生文件调用使用 CFFI，无 C#、Rust 或 PowerShell 运行依赖。
- 本轮限制：先前 CangjieSkills 1.1.3 临时副本已被清理，没有重新下载；本轮以本机编译器、API 既有绑定及本地编译/运行探针复核，不声称重新读取 skill。

## 当前结论

1. 补回共享消费者要求的 `durableCheckpoint`、`durableCheckpointBatched`、`isDurableFrozen`、`freezeAfterDurableFailure`。
2. 完整 core 私有快照 `cjpm build` **rc=0**，真实输出 `cjpm build success`。
3. 小范围专项包含原有 `loglock_test.cj` 四条和新 `persistence_repair_test.cj` 九条，**13/13，0 FAIL、0 ERROR，编译及运行 rc=0**。
4. 真实全 core 生产源码的会话/执行集成验证：**58 条，57 PASS、0 FAIL、1 ERROR，编译 rc=0、运行 rc=1**。
   唯一错误为 `executionOutputRealProcessPersistsAndPagesAfterReload`，默认沙箱无后端时
   真启动失败 `execution-provider-failed`。没有为此解除产品拒绝。此结果不是全量核心通过。
5. 未重建 Host、CLI、daemon 或 Electron 交付包，不宣称这些入口或安装态已通过。

## 修复设计

### 不再扩展引用计数竞态

无参 `flush()` 的调用面已经广泛存在，直接删除自动取写权语义会破坏大量调用方。
本轮保留兼容行为，但把**查已有租约、获取临时租约、发布、归还**整个序列放在
同一个 SessionLog 实例锁内。已有外部租约只借用，不由 flush 归还。

不引入引用计数，也不修改公共入口签名。同实例三个线程的 120 次 append/flush
均返回成功；冷实例重开仍为 120 条连续事件。原有
`appendFlushAndReplayInterleaveWithoutTearing` 同时有磁盘读线程，已实跑通过。

### 相对路径租约

`writerKey` 原来直接 canonicalize 空 parent，成功落位后登记抛错，会把已 acquire 的
租约错误报告为失败。本轮空 parent 回退 `.`，并将键解析移到任何磁盘发布之前。
因此既保留规范路径身份，也不通过吞异常掩盖“发布成功后报告失败”。

### 未打开句柄与写后失败分开

Windows `CreateFileW` 可能因活读句柄的共享模式而拒绝写句柄。此时还没调用任何写入 API。
普通 flush 返回 false、durable 不推进，但不冻结；关闭读句柄后可重试成功。
显式副作用准入 checkpoint 的失败策略更严格：失败即冻结，不自动重试变更。

提供方返回 `not-opened` / `failed` / `ok` 的阶段事实。`GetLastError` 跨仓颉 CFFI 调用
的线程错误状态未可靠取证，因此不以它猜测根因；未打开并不等同“必定只是共享冲突”。
拿到句柄后任何前缀核对、写入或屏障失败仍冻结。

### 持久与恢复

同一句柄核对全量原盘字节、拒绝前缀分叉、只追加差量、完成 FlushFileBuffers 后推进 durable。
尾修复沿用 load 的现有口径，不另造第二套帧解析；checkpoint 不接受尚未恢复的坏尾。
日志先按字节裁掉无 LF 的物理半尾，再 UTF-8 解码，避免半个中文字符阻止完整前缀恢复。

相关消息事件重建新的投影列表，无关事件仍复用缓存；之前交出的列表不被就地清空。

## 专项验证

所有临时源码、桩、输出、夹具在
`apps/desktop/.tmp-test/persistence-repair-20261013/`。
重点生产文件直接复制原件，没有改包名或重写被测实现。小范围探针只桩掉未调用的
hook 依赖和模型文本辅助函数，完整集成快照不使用这些桩。

命令：

```text
cjc --test -O0 -p <focused> -o <focused-tests.exe>
focused-tests.exe --parallel=1 --no-color --no-progress
cjpm build                           # 在 full-core 私有快照中执行
```

证据：`focused-build.{stdout,stderr}.log`、`focused-run.{stdout,stderr}.log`、
`core-build.{stdout,stderr}.log`、`core-build.rc`。

| 用例/行为 | 结果 |
| --- | --- |
| 原有并发 append、并发投影、durable 计数 | PASS |
| 原有三线程 flush 与磁盘回放交错，120 条完整事件 | PASS |
| 新三线程 120 次 flush 每次返回成功 | PASS |
| 活读句柄阻挡写侧，durable 不推进、不冻结、解除后成功 | PASS |
| 错会话租约拒绝、自己的租约仍有效、flush 不归还借用租约 | PASS |
| 中文半尾恢复、尾修复、再次冷回放 | PASS |
| 旧投影引用稳定，无关事件不重建 | PASS |
| 分叉草稿不得改写已提交前缀 | PASS |
| 超过 4 KiB 的中文 pending 一次检查点正确回放 | PASS |
| 显式 checkpoint 失败冻结，禁止普通 flush 兜底 | PASS |
| 丢失租约不得发布或删掉新持有者凭据 | PASS |

读句柄冲突用例曾实跑为 **8 PASS / 1 FAIL**，失败为会话冻结及后续无法提交；
改为按“是否已经打开句柄/可能写入”的阶段区分后，同断言转绿。
这条是新增的确定性失败→修复证据，不依赖统计式并发抽样。

## 格式与静态检查

- 仅格式化本次修改的 `session.cj`、`lease.cj`、`filewin.cj`，`cjfmt -f` 各 rc=0。
- 格式化后重新编译专项并重跑，13/13、rc=0。
- `git diff --check` 通过。
- `cjlint` rc=0；最终独立报告 `lint-final.json` 为 **25 SUGGESTIONS / 2 MANDATORY**，
  不把工具 rc=0 声称为 lint 零诊断。两条 MANDATORY 都指向 `lease.cj` 中
  `synchronized(localWriterMtx)` 位于 try 块内；这里采用语言的自动解锁结构，
  没有手动 lock/unlock 配对缺失。该规则的静态诊断保留，不为消警改回更脆弱的手动锁。
- 旧报告输出路径重复使用时 cjlint 会追加多份 JSON；最终报告使用新的文件名，
  原件不拼接计数。日志 parser 的失败不算源码构建失败。

## 尚不声明完成的部分

- 本机测试证明调用到了屏障并可重开，不等同物理断电实验。
- 跨进程并发陈旧租约接管、租约丢失的全时序原子性尚待独立设计与双进程试验。
- 原子替换文件的并发/崩溃验收、真正 AppContainer enforcement 尚未完成。
- 之前全量结果和本轮测试不同源码/不同范围，不能相减得到“新增失败数”。
