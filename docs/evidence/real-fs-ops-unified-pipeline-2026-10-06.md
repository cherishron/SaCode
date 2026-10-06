# 真实文件操作与统一工具执行管线（2026-10-06，W40 E 工作包）

本轮补齐能力矩阵 filesystem 行原先登记的两项缺口（受保护原子替换、有界读取），
并把 `agent.cj` `pipeline` 的硬编码 if 分支链改成统一执行器表。目标原文：
「模型工具仍按 todo_write/read/write 硬编码分支……model_tool_runtime.cj 和
agent.cj 未统一执行器/管线；filesystem 仅实现观察+直接覆盖，缺少受保护原子替换和有界读取」。

## 一、统一执行器表（tools 行）

改动前 `pipeline()` 是一串逐名比较：`if (name == "todo_write")`（内联构造 TodoTool）、
`if (name == "read")`……`if (name != "write") → unknown-tool`，write 的写入逻辑整段内联在
pipeline 体内。

改动后（`core/src/agent.cj`）：

- `ToolRuntime` 新增 `executors = HashMap<String, (String, String) -> ApprovalOutcome>`，
  init 末尾 `registerBuiltinExecutors()` 一行注册一个工具：
  `todo_write`/`read`/`write`/`edit`/`glob`/`grep`/`bash`/`pwsh`/`run_code`/`lsp`。
- `pipeline()` 只查表：`match (executors.get(name))`，Some 走执行器，None 归一 `unknown-tool`
  （与 `unregistered` 仍是两种失败，阶段码不变）。
- todo_write 的内联逻辑提取为 `todoStep`；write 的内联逻辑提取为 `writeStep`，
  逐字段保持原行为（normalizeArgs、观察检查、`fs-not-observed`/`fs-stale-version`、
  torn-write 比对、观察更新）。
- 三个入口共用同一张表：手工 `execute`（answer 审批）、`executeWithApproval`（工单审批）、
  `ModelToolRuntime.execute`（模型工具）。`model_tool_runtime.cj` 本身无需改派发——
  它只经 `executeWithApproval` 进入管线，执行器表自动生效。

`pipeline_test.cj` 的 `unknown-tool` 占位从已实现的 `edit` 换成执行器表里没有的 `mcp`
（原占位在 edit 实现后已测不出该阶段码）。

## 二、受保护原子替换（filesystem 行）

改动前：已有文件的 write 走 `File.writeTo(path, ...)` 直接覆盖，edit 写回同样——
写途中崩溃会留下撕裂的目标（半份新内容）。

改动后（`core/src/agent.cj`）：

- 新增 `replaceFileAtomically(path, bytes)`：独占临时文件（`File.createTemp`）先写完整，
  再 `rename(staging, to: path, overwrite: true)` 原子落位；`finally` 兜底清理失败路径上的
  staging。与新建路径的 `publishNewFile`（`rename overwrite:false` 禁止替换）共用同一道
  「先写完整、再原子改名」保护，区别只在落位语义：发布绝不覆盖、替换必须覆盖。
- `writeStep` 与 `editStep` 对已有文件的写入全部改走 `replaceFileAtomically`；
  新建文件仍走 `publishNewFile`（不变量：观察过缺失后外部创建仍拒绝覆盖）。
- snapshot 段的观察/版本检查（不变量 14）在替换之前判，语义与阶段码不变。

## 三、有界读取（filesystem 行）

改动前：`readStep` 全量读入并全文返回，超长文件会把模型上下文和会话日志撑爆。

改动后（`core/src/agent.cj` readStep + `model_tool_runtime.cj` schema + CLI params）：

- 参数：可选 `offset`（起始行，默认 0）、`limit`（行数上限，默认 2000），
  另有 256 KiB 字节硬上界兜底超长单行；负 offset / 非正 limit 归一 `bad-args`。
  JSON 形态 `{"path":..., "offset":N, "limit":N}`；裸路径形态保持兼容（默认分页）。
- 截断时返回切片 + 尾部标记 `[read-truncated:offset=N,lines=R/T]`；会话日志只进切片
  （`ok-read:${path}:${bytes}:lines=R/T\n切片\n标记`）。
- **观察面仍登记全量字节**：「给模型看多少」与「我读过盘上这份」解耦——
  分页读不放宽也不收紧不变量 14（分页观察后文件被外部改，write 照旧 `fs-stale-version` 拒）。
- 无截断路径的日志格式 `ok-read:${path}:${size}\n正文` 与既有重放断言逐字一致
  （`fs_test.cj` replay 用例不动照过）。
- read 的声明面同步：`model_tool_runtime.cj` schema 增加 `offset`/`limit`（integer，非必需）；
  CLI `builtinTools()` read 描述与 params 串更新为「path offset limit」。

## 四、验证证据

| 验证 | 命令 | 结果 |
|---|---|---|
| core 构建 | `cd core && cjpm build` | exit 0（137 条预存 warning，无 error） |
| 测试编译（含新增 fs_test 6 条 + pipeline_test 修改） | `cd core && cjpm test --no-run --target-dir target/verify-e40` | exit 0，`cjpm test success` |
| CLI 构建 | `cd apps/cli && cjpm build` | exit 0 |
| CLI tool 断言自测（真实管线行为） | `main.exe tool` | **16/16 PASS**，`ALL PASS`，exit 0 |
| CLI 全量自测（seed/projection/stream/tool/ext/cancel/extjs/sig 等全部断言链） | `main.exe all` | `ALL PASS`，exit 0 |
| CLI headless 自测（审批工单路径 `executeWithApproval` → 执行器表） | `main.exe headless` | `ALL PASS`，exit 0 |

CLI `tool` 断言链新增 5 条实测（`apps/cli/src/main.cj`）：

1. `limit 截断只交回前两行并带标记`（含 `[read-truncated:offset=0,lines=2/5]`）
2. `offset 翻页从第 4 行读到文件尾`（含 `[read-truncated:offset=3,lines=2/5]`）
3. `分页读建立的是全量观察，写照常放行且内容完整落位`（覆盖 replaceFileAtomically 落位）
4. `分页观察后外部改动照样按 stale 拒`
5. `非法分页参数归一成 bad-args`

`fs_test.cj` 新增 6 条 @Test 用例（limit 截断+全量观察、offset 翻页、分页不放宽 stale、
非法分页、原子替换专用目录无 staging 残片、write 工具替换路径全链）——**编译已过**
（`cjpm test --no-run` exit 0）。

## 五、测试基础设施阻断（如实记录，非本轮引入）

`cjpm test`（运行阶段）在本机持续失败于 unittest 框架自身的 worker 启动：

```
Exception: Too many attempts to create a temporary file
  at std.unittest::TempDirectory::createTempFile(std/unittest\tempdir.cj:91)
  at std.unittest::Framework::initWorker(std/unittest\framework.cj:202)
  at std.unittest::WorkerProcess::createAndRegister(std/unittest\execution.cj:330)
```

- 失败发生在 `initWorker`（worker 进程启动），**尚未执行到任何用例**，与测试内容无关。
- 已排除的环境因素：`%TEMP%` 磁盘空闲 178 GB；TEMP 普通写入、`.exe` 后缀写入、
  `CreateNew` 独占创建均成功；`unittest_bin` 内复制 core.exe 成功。
- 该阻断影响本机所有 `cjpm test` 调用（并行会话成员以 `--filter` 逐条尝试同样失败），
  属预存环境问题；行为验证由 CLI 断言自测通道替代完成（见上表）。
- `--skip-build` 复用已编译产物、`--filter` 单条、独立 `--target-dir` 均复现同一堆栈。

## 六、改动清单

- `core/src/agent.cj`：executors 表 + `registerBuiltinExecutors` + `todoStep`/`writeStep` 提取、
  `replaceFileAtomically` 新增并接入 write/edit、`readStep` 有界切片（offset/limit/字节上界/截断标记）。
- `core/src/model_tool_runtime.cj`：read schema 增加 offset/limit。
- `apps/cli/src/main.cj`：builtinTools read 描述与 params 串；`tool` 断言链新增 5 条实测。
- `core/src/pipeline_test.cj`：unknown-tool 占位 edit→mcp。
- `core/src/fs_test.cj`：新增 6 条用例（编译已过，待测试基础设施修复后运行）。
- `docs/plans/dsh-capability-matrix.md`：filesystem 行、tools 行二次增量回填。
