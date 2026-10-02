# DSH 上游冻结与工具链取证（S0）

抓取日 2026-10-02。账本 `docs/evidence/ledger.json` 跑 `coverage_ledger.cjs`：`GATE: PASS (9 checks)`，`--selftest` 为 `10/10 CAUGHT`（先反证门禁在执行，再采信绿灯）。

## 1. 冻结标识

| 项 | 值 | 证据通道 |
|---|---|---|
| 仓库 | `deepseek-ai/deepseek-harness`（用户原文提供） | `api.github.com/repos/...` 200 |
| 快照 commit | `639ed015397290b3745d163aafe02ffee4aa3f84` | `.../commits?sha=master&per_page=1` 200 |
| 提交时间 | 2026-09-29T09:21:31Z | 同上 |
| 默认分支 | `master`（不是 main） | repo 元数据 |
| 许可证 | SPDX `MIT` | repo 元数据 + `LICENSE` 原文 1065 B |
| 官方文档站 | `https://deepseek-harness.github.io/deepseek-harness/en/...` | 站点 200 |

## 2. 许可与依赖清单（一手来源）

- `LICENSE`（MIT）、`THIRD_PARTY_NOTICES.md`（23637 B，9 节；许可计数 162 MIT / 25 Apache-2.0 / 12 BSD / 6 MPL / 4 ISC / 2 GPL）。
- 依赖面：`package.json`、`pnpm-workspace.yaml`、`pnpm-lock.yaml`，生成物 `docs/dependency-catalog.json`。
- 逐字段对齐用生成物：`docs/persistence-schema.json`、`docs/config-catalog.md`（站点同名页约 210 KB，抓取会超时，须走仓库 contents 通道）。
- 对复刻的含义：上述第三方许可清单描述的是 **DSH 自己的 node 依赖**，不自动适用于本仓（仓颉 + Electron + OpenTiny）产物；每引入一个依赖要单独登记许可。若复制 DSH 的文档文本、图标或代码片段，须保留 MIT 归属声明。

## 3. 覆盖分母（可复核，非估算）

- `docs/subsystems?ref=master` 返回 **192 条目 = 64 模块 × (en.md + zh.md + i18n.yaml)**。GitHub contents 单目录上限 1000，故判为完整清单而非分页截断。
- `docs/` 顶层 75 条目，含站点未见的生成物与专章：`dependency-catalog.json`、`persistence-schema.json`、`glossary`、`defensive-patterns`、`event-producer-consumer`、`graph-atlas`、`module-graph`、`rescope`、`session-format-status`、`ui-radius`、`web-styling`、`deepseek-llm-api-wire-extensions`、`testing`、`development`，及目录 `cookbook`、`cordis-api`、`i18n`、`persistence-changes`、`postmortem`、`subsystems`、`upgrade-guide`、`user`。
- 站点 `/en/reference/subsystems/` 索引解析出 66 条 `subsystems/*.md` 链接，去后缀与 64 模块比对：**命中 64、未命中 0**。
- 64 模块逐篇的「上游已核」尚未完成，记在 `docs/plans/dsh-capability-matrix.md`（该列全为未勾选）。本账本声明的覆盖数 8 是冻结取证面，不是 64 模块阅读面。

## 4. 被推翻的先前结论（曾判 → 实测）

1. 曾据「站点 `/zh/` 路径 404」外推为「DSH 没有中文文档」→ **错**。站点无中文路径为真，但仓库 64 篇子系统文档**每篇都带 `.zh.md`**，另有 `README.zh.md` 与 `docs/i18n`。
2. 曾判「16 个长尾子系统只存在于仓库 docs，站点 404」→ **不成立**。站点导航覆盖全部 64 模块；当时 404 源于我按 `/reference/subsystems/<name>` 猜路径（身份来源属 `inferred`）。推断 URL 产生的 404 与「内容真的不存在」的 404 状态码完全相同，因此**不得**用 `inferred` 身份支撑否定断言。
3. `PTC` 缩写全称、live-fork 对 open-turn cut 的处理、`shell` 页正文与生成 API 命名不一致：本轮未复核，保持「矛盾或未覆盖」，不入硬规格。

## 5. 通道可用性（本环境实测）

| 通道 | 结果 | 处置 |
|---|---|---|
| `api.github.com/...`（含 `Accept: application/vnd.github.raw`） | 200 可用 | 仓库文件与目录清单主通道 |
| `raw.githubusercontent.com` | `curl` HTTP 000（连接层失败） | 整条换用 api contents，不重复重试同 URL |
| `github.com/...`（HTML） | 先前 WebFetch 全部 `fetch failed` | 不作为取证通道 |
| 文档站 `deepseek-harness.github.io` | 200 可用 | 导航与正文，超大页改走仓库 |

## 6. 仓颉工具链与 stdx 缺口（P0 前置）

- `cjc 1.1.3 (cjnative)`，`Target: x86_64-w64-mingw32`；`cjpm 1.1.3`；`node v22.23.2`；`npm 10.9.8`。
- SDK `modules/windows_x86_64_cjnative/` **只有 `std/`（46 包）**。std 含：`std.net`、`std.sync`、`std.time`、`std.io`、`std.env`、`std.fs`、`std.process`、`std.posix`、`std.interop`(CFFI)、`std.database.sql`、`std.crypto{,.cipher,.digest}`、`std.collection(.concurrent)`、`std.reflect`、`std.regex`、`std.unittest*` 等。std **不含** JSON 编解码、HTTP 客户端、TLS、WebSocket、压缩、日志。
- 编译探针：`import stdx.net.http.*` 退出码 1（找不到 `.cjo`）；`import std.convert.json.*` 退出码 1（JSON 不在 std）。
- 结论：**stdx 未安装是当前唯一硬阻塞**（模型请求需要 HTTPS + JSON + 流式）。官方规范解法：从 `gitcode.com/Cangjie/cangjie_stdx/releases` 取与 1.1.3 匹配的 `windows_x86_64_cjnative` 包，`dynamic/stdx` 与 `static/stdx` 二选一，工程 `cjpm.toml` 用 `[target.x86_64-w64-mingw32.bin-dependencies] path-option` 指向。
- 分发含义（直接影响 CLI 与桌面两个交付物）：动态形态需 stdx DLL 在 `PATH`/exe 同目录，故 CLI 平台包与 Electron 安装包都必须携带运行库，或改用静态产物；不得假定单文件自带一切。

## 7. 证据分级

- 直接证据（本次直读原文/实测）：§1、§2 许可计数、§3 全部计数、§5 通道结论、§6 工具链与探针结果。
- 二手已复核：无（本轮结论均来自一手抓取与本机执行）。
- 矛盾或未覆盖：§4.3 三项；另有 `docs/user`、`cookbook`、`cordis-api`、`postmortem` 等目录未逐篇阅读。
- 未读取或未核实：64 模块逐篇内容、`docs/architecture.md` 全文、各 package README、Agent Notes（`.agents/notes`）。
