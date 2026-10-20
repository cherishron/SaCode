# F16 数据库面板实现设计（2026-10-20）

> 纯设计，非代码。不碰 core/Host 源码。覆盖 core 连接器接口、Host `database/*` 分派、安全边界、与执行审阅通路关系、依赖与平台兼容、待确认项。

## 0. 现状

- PRD F16（`docs/product/PRD.md:202,315-335,564-583`）：支持 MySQL/PostgreSQL/达梦，三引擎各自真实驱动验收；连接管理、对象树、查询、分页、可视化编辑、事务、导出；默认只读、写入单独授权、无界查询限制、DDL 不可靠回滚提前说明、断连不假报提交。DB01–DB12 逐引擎验收。
- 当前状态（`docs/product/PRD.md:814`）：core/src 无 db/database/sql 文件；Host 无 `database/*` 分派（`docs/plans/host-capabilities.json` 仅 `approval/*`/`execution/review-*`/`extension/host/*`/`page/tool/*`）；桌面 `renderer/pages/` 无 `database.ts`（仅有 vendored SQL 语法高亮文件，非功能）。
- 可复用资产：`core/src/extproc.cj`（NDJSON 帧解析）、`core/src/ext.cj`（ToolRegistry + needsApproval fail-closed）、`core/src/mcp_client.cj`（真 stdio 子进程 + TurnToken 取消 + 单调钟 deadline 超时 + fail-closed 结构化结果）、`core/src/acp_process.cj`（外部进程驱动）、extjs 扩展宿主（`extjs/host.cjs`+`server.cjs`，NDJSON JSON-RPC，已被 `extension/host/*` RPC 驱动）、`execution/review-apply*`（现有执行审阅通路）、`approval/ask`/`approval/answer`（工单审批）。

## 1. 核心架构决策

**驱动承载在 extjs（Node），不在仓颉 core 做 FFI。**

- 理由：PostgreSQL/MySQL/达梦的成熟驱动是 npm 包（`pg`/`mysql2`/`dmdb`），纯 JS 或带原生绑定；仓颉无 DB 驱动，FFI 到 `libpq`/`libmysqlclient`/达梦 C API 是三套 C ABI × 三平台 × 类型映射，成本高且与既有 extjs NDJSON 通道重复。
- 复用 `extension/host/*` 通道：core spawn extjs 子进程（已有），在 extjs 侧加载 `db-driver` 模块（Node，require pg/mysql2/dmdb），core 经 `extension/host/call` 以 JSON-RPC 调用。core 不直接 require 任何 npm 驱动。
- core 负责：连接元数据/句柄、查询参数校验、ResultSet 中立结构、事务状态机、取消（TurnToken）、授权门控、审计日志。extjs 负责：驱动加载、连接池、协议通信、类型→JSON 转换、cursor 流式。

**连接池在 extjs 侧。** core 只持连接句柄 ID（`connectionId`）+ 引擎/目标元数据 + 只读标志 + 事务状态，不自己池化（避免仓颉侧重复实现并发池，且池是 driver 协议内能力，pg/mysql2 自带）。

**结果集中立序列化。** core 不解释驱动类型；extjs 把行转 JSON 值（JSONB/数组/几何等在 extjs 侧序列化），core 透传。

## 2. core 层连接器接口设计

### 2.1 连接器接口（core 定义，extjs 实现）

core 侧定义中立接口（伪签名，非产品代码）：

```
interface DatabaseConnector {
  engine(): String                                   // "postgresql" | "mysql" | "dm"
  connect(spec: ConnectionSpec, token: TurnToken): ConnectResult
  disconnect(connectionId: String): Unit
  query(connectionId: String, sql: String, params: Array<JsonValue>,
        opts: QueryOptions, token: TurnToken): QueryResult
  cursorFetch(cursorId: String, offset: Int64, limit: Int64, token: TurnToken): QueryResult
  cursorClose(cursorId: String): Unit
  objects(connectionId: String, token: TurnToken): ObjectTree
  begin(connectionId: String, token: TurnToken): TxState
  commit(connectionId: String, token: TurnToken): TxResult
  rollback(connectionId: String, token: TurnToken): TxResult
  exportResult(cursorId: String, format: String, token: TurnToken): ExportResult
}
```

- 实现为 `ExtjsDatabaseConnector`：每个方法把参数序列化成 JSON-RPC 帧，经 `extension/host/call` 发到 extjs 的 `db-driver` 模块，按 deadline + TurnToken 等回复（复用 `mcp_client.cj` 的"独立线程喂队列 + 主线程 deadline 轮询"模式，取消和超时都能在有限时间内被看见）。
- `ConnectionSpec`：`{engine, host, port, database, user, credentialRef, tlsMode, tlsCaRef, connectTimeoutMs, statementTimeoutMs, readonly}`。**不内联口令**——`credentialRef` 指向凭据存储引用（与模型凭据同款机制，不写日志、不回显）。
- `ConnectResult`：`{ok, connectionId, serverVersion, serverInfo, warnings, failureKind}`，`failureKind ∈ {auth, network, tls, server-refused, driver-load, timeout, cancelled, bad-spec}`。

### 2.2 驱动加载（extjs 侧）

- extjs `db-driver` 模块按 `engine` 选择 require：postgresql→`pg`，mysql→`mysql2`，dm→`dmdb`。
- 驱动缺失（require 失败）→ `driver-load` 失败，core 返回结构化错误，不崩溃。UI 明确提示"引擎 X 驱动未安装"。
- 驱动版本与平台矩阵在实施前冻结（见 §6）。

### 2.3 连接池（extjs 侧）

- pg: `Pool`（内置）；mysql2: `createPool`；dm: 按 dmdb 文档（若有池；无则单连接 + 队列）。
- 每个 `connectionId` 对应池中一条连接；`disconnect` 释放回池（不真关池）；进程退出时池统一关闭。
- 连接生命周期绑定 SaCode 会话/项目归属（PRD：多实例独立、切任务不污染）。

### 2.4 查询执行与结果序列化

- `QueryOptions`：`{maxRows(默认10000), maxBytes(默认 4MB), statementTimeoutMs, readonly(覆盖连接级), cursorBatch(默认 500)}`。
- `QueryResult`：`{columns: Array<{name,type}>, rows: Array<JsonValue>, affectedRows, notices, cursorId?, truncated, ddlFlags, elapsedMs, failureKind?}`。
- **无界查询限制**：硬上限 `maxRows`/`maxBytes`；超限**截断 + 标 `truncated:true`**，不一次性拉全表；首批返回 `cursorId`，后续 `cursorFetch` 翻页；`cursorClose` 释放服务端 cursor。
- **DDL 不可靠回滚标注**：执行时检测语句语义（`CREATE/DROP/ALTER/TRUNCATE` 等在 extjs 侧按引擎方言识别），结果 `ddlFlags.notRollbackSafe=true`；事务内执行 DDL 时 UI 提前提示"此 DDL 不可靠回滚"，提交/回滚结果如实回驱动返回。

### 2.5 事务控制

- 显式 `begin/commit/rollback`；core 持 `TxState ∈ {idle, active, rolled-back, unknown}`。
- **断连不假报提交**：commit/rollback 调用若在传输层失败（extjs↔driver 断连、超时），TxState 置 `unknown`，返回 `TxResult{ok:false, state:"unknown", reason:"transport-disconnected"}`；UI 明确标注"事务状态未知，需人工核库"，**不报提交成功**。
- DDL 在事务内：`ddlFlags` 透传，回滚结果若驱动报"DDL 已生效不可回滚"，如实返回。

### 2.6 取消

- core `TurnToken` 传入每个方法；extjs 侧调 driver 取消：pg 用 `AbortSignal`（`Client.query` 支持），mysql2 用 `connection.kill` 或 abort，dm 按 dmdb 能力。
- 取消真实反馈：`failureKind:"cancelled"`，不假报完成；`elapsedMs` 真实。

## 3. Host 层 `database/*` 分派设计

新增 `database/*` 命名空间（写入 `docs/plans/host-capabilities.json` 与 `apps/host/src/main.cj` 分派——本设计只列方法，不实现）：

| RPC | 作用 | 走审批？ |
|---|---|---|
| `database/connect` | 按 ConnectionSpec 连接（含 TLS、超时） | 否（连接不等于授权，PRD:321） |
| `database/disconnect` | 断开连接 | 否 |
| `database/test` | 测试连接（不改业务数据，PRD:321） | 否（只读探测） |
| `database/list-connections` | 列当前会话/项目连接与状态 | 否 |
| `database/objects` | 对象树（schema/表/视图/列/主键/索引/约束，按引擎） | 否（只读元数据） |
| `database/objects/refresh` | 刷新元数据（DDL 后旧失效） | 否 |
| `database/query` | 执行只读查询（SELECT/EXPLAIN/SHOW 等），首批+cursorId | 否（只读） |
| `database/cursor/fetch` | 翻页取后续 | 否 |
| `database/cursor/close` | 关 cursor | 否 |
| `database/export` | 导出结果（CSV/JSON/SQL） | 否（读已授权结果） |
| `database/write` | 执行写 SQL（INSERT/UPDATE/DELETE）或 DDL | **是**（见 §4/§5） |
| `database/begin` | 开事务 | 否（状态变更） |
| `database/commit` | 提交事务 | **是**（提交即副作用落库） |
| `database/rollback` | 回滚事务 | 否（撤回，无新增副作用） |
| `database/edit/apply` | 可视化编辑应用（生成 UPDATE/DDL） | **是**（等同 write） |

约束：
- `database/connect` 只接受 `credentialRef`，不接受明文口令；TLS 错误（证书校验失败）**不绕过**，fail-closed 返回 `tls` 错误（PRD:321）。
- `database/query` 在 core 侧按 `readonly` 标志拦截：若连接为只读且语句非只读（按引擎方言识别），拒绝并提示走 `database/write` 审批通道。
- `database/write`/`commit`/`edit/apply` 只收 `approvalId`（与 `toolCall`/`extension/call` 一致），渲染层传自报审批字符串无通路。

## 4. 安全边界（对齐 PRD F16）

1. **默认只读**：`ConnectionSpec.readonly` 默认 `true`；只读连接下 `database/write`/`commit`/`edit/apply` 被拒（即便有授权也要求连接显式开写）。PRD:333"只读是默认模式，不是永久禁止写入"——开写需独立授权。
2. **写入单独授权**：写 SQL/DDL/可视化编辑 apply/commit 走 §5 审批通路；连接建立与对象浏览不等于写授权（PRD:86,96,321）。
3. **无界查询限制**：`maxRows`(10000)/`maxBytes`(4MB) 硬截断 + `truncated` 标记；大结果用 cursor 翻页，不一次性拉全表；`statementTimeoutMs` 防慢查询挂死。
4. **DDL 不可靠回滚提前说明**：DDL 语句在结果 `ddlFlags.notRollbackSafe` 标注；事务内执行 DDL 时 UI 提前提示；回滚结果如实回驱动返回，不伪装可回滚（PRD:202,505）。
5. **断连不假报提交**：commit/rollback 传输失败 → TxState=`unknown`，UI 标"未知"，不报成功（PRD:505,583）。
6. **TLS/证书错误不绕过**：`tlsMode` 默认校验；证书错误 fail-closed，不允许"关闭验证"开关（PRD:321）。
7. **凭据独立保存引用**：`credentialRef` 指向独立凭据存储，不写日志、不回显、不进会话日志正文；凭据与连接目标绑定。
8. **SSH 隧道身份与 DB TLS 分别核验**（PRD:333）：若经 SSH 隧道，隧道身份认证与数据库 TLS/认证是两步，不因 SSH 已信任自动信任数据库。
9. **测试连接不改业务数据**：`database/test` 只发只读探测语句（如 `SELECT 1`/`SELECT version()`），不发写语句（PRD:321）。
10. **权限不足如实显示**：对象树遇驱动报权限不足，如实标"权限不足"，不误报"对象不存在"（PRD:322）。

## 5. 与现有执行审阅通路的关系

**数据库写入走 `execution/review-apply`（现有审阅 apply 通路），不另建审批通道。**

- 把写 SQL/DDL/可视化编辑 apply 当作"待审变更"：
  1. `database/write` 请求 → core 调 `execution/review-prepare` 生成审阅预览（SQL 文本 + 影响对象 + 预估影响行数 + DDL 标志），UI 在审阅面板展示。
  2. 用户授权 → `approval/answer{decision:"allowed-once"}` → core 调 `execution/review-apply` 执行 SQL 落库，返回真实 `affectedRows` 与服务端事务结果。
  3. 撤销 → `execution/review-apply-stop` 或 `denied`，不执行。
- **commit 走审批**：事务提交即副作用落库，等同写入；`database/commit` 收 `approvalId`，未授权不提交。
- **只读查询不走审批**：`database/query`/`objects`/`export` 默认放行（连接已建立即视为只读授权）。
- **与 Trae 的计划批准持久化关口协调**：Trae 在修"批准记录与权限恢复持久化成功后才允许继续"。数据库写入的 `approval/answer` → `execution/review-apply` 链同样必须满足该关口：批准持久化失败 → 不执行 SQL、冻结、返回错误。本设计复用该关口，不绕过。
- **替代方案（否决）**：独立 `approval/ask` 给数据库——会割裂执行审阅语义，且 `execution/review-apply` 已有 diff 预览/取消/结算能力，复用更一致。

## 6. 依赖清单与平台兼容

| 引擎 | 驱动（npm） | 类型 | 平台兼容 | FFI | 备注 |
|---|---|---|---|---|---|
| PostgreSQL | `pg` | 纯 JS（协议层）+ 可选原生 bcrypt（不用） | Windows/Linux/macOS，Node ≥8 | 无（pg-native 不用） | 成熟；TLS 内置 `ssl:`；池 `Pool` 内置 |
| MySQL | `mysql2` | 纯 JS | Windows/Linux/macOS，Node ≥10 | 无 | 成熟；TLS 内置 `ssl:`；池 `createPool` |
| 达梦 | `dmdb`（达梦官方） | **待确认**（纯 JS？原生绑定？） | **待确认** | **待确认**（若走 ODBC 则需 unixODBC/MDAC/iODBC） | 官方维护与版本矩阵须冻结；TLS/认证方言待核 |

- **extjs node_modules 装载**：`pg`/`mysql2`/`dmdb` 须装入 extjs 的依赖（或打包进 vendor，桌面运行时零 npm 依赖原则下需在构建期折叠——见 AGENTS 桌面渲染层约束；extjs 侧可单独装，extjs 是 Node 入口不受桌面 CSP 限制）。
- **原生绑定风险**：若 `dmdb` 含原生绑定（.node），需三平台预编译；若走 ODBC（`odbc` npm，含原生），Linux 需 unixODBC、macOS 需 iODBC/unixODBC、Windows 用系统 MDAC。**优先选纯 JS 的 dmdb 版本**；无纯 JS 则 ODBC 路径单列待确认。
- **TLS 根证书**：三引擎各自 TLS；CA 证书来源（系统信任库 vs 随包）按引擎处理，证书错误不绕过。
- **凭据存储**：复用 SaCode 现有凭据机制（待确认是 `model/registry/save-credential` 同款还是独立 `database/credential`）。
- **Node 版本**：extjs 已用 Node ≥18（本机 v22），驱动兼容性满足。

## 7. 待确认项

1. **达梦驱动**：`dmdb` npm 是否官方、版本、纯 JS/原生、三平台矩阵、TLS/认证方言——实施前冻结（DB01–DB12 要求逐引擎真实环境，达梦环境获取可能 BLOCKED，不借其他引擎或 mock 顶替）。
2. **三引擎驱动版本冻结**：`pg`/`mysql2`/`dmdb` 各自锁定版本，写入平台矩阵。
3. **凭据存储复用点**：确认用哪个现有凭据机制存数据库口令。
4. **写 SQL 走 `execution/review-apply` 的接入点**：与 Trae 计划批准持久化关口协调——批准持久化未成功不执行 SQL；需 Trae 关口就绪后接入。
5. **extjs 装 npm 驱动**：确认 extjs 的 `package.json`/依赖管理与打包方式（extjs 是 Node 入口，可独立 npm install；是否随桌面打包需对齐 AGENTS 桌面零运行时依赖原则）。
6. **可视化编辑 apply 路径**：生成 UPDATE/DDL 后走 `database/write`→`execution/review-apply`，确认 diff 预览格式（SQL 文本 + 影响行预览）。
7. **大对象（BLOB/CLOB）**：结果集与导出如何处理（截断占位 vs 流式下载）；首版建议截断 + 标 `truncated`，流式下载二期。
8. **导出格式与上限**：CSV/JSON/SQL/Excel 选型与 `maxExportRows` 上限。
9. **SSH 隧道连接**：首版是否做（PRD 提及但属独立配置）；若做，隧道身份与 DB TLS 分别核验。
10. **statementTimeoutMs 引擎支持差异**：pg `statement_timeout`、mysql2 `connect_timeout`/`SET max_execution_time`、dm 待确认；按引擎实现。
11. **取消的引擎能力差异**：pg AbortSignal 成熟、mysql2 kill、dm 待确认；dm 取消能力待核，无真取消则如实标"取消未生效"。
12. **桌面 database 页与 IPC**：`apps/desktop/preload.cjs` 新增 `sacode.database*` IPC（门禁扩充），`renderer/pages/database.ts` 新建——本设计只列接入点，不实现 UI。

## 8. 不在范围

- 不写产品代码（core/Host/桌面）。
- 不提交、不推送。
- 不冻结驱动版本/平台矩阵（待确认项，实施前另冻结）。
- 不实现 UI、不建夹具、不跑真实 DB。
- DBA 运维（备份恢复/复制/集群/迁移执行）PRD:335 明确不自动包含，本设计不覆盖。
