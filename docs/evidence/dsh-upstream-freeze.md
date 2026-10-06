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

- `docs/subsystems?ref=master` 返回 **192 条目 = 64 `.md` + 64 `.zh.md` + 64 `.i18n.yaml`**。GitHub contents 单目录上限 1000，故判为完整清单而非分页截断。**2026-10-03 更正**：64 个 `.md` 里有一个是 `README.md`（子系统目录索引页），所以**模块真分母是 63**，本账本此前把索引页计成了一个能力；对 `ref=639ed01…`（冻结）与 `ref=master`（当日）各重取一次，两边同为 192 条目。
- `docs/` 顶层 75 条目，含站点未见的生成物与专章：`dependency-catalog.json`、`persistence-schema.json`、`glossary`、`defensive-patterns`、`event-producer-consumer`、`graph-atlas`、`module-graph`、`rescope`、`session-format-status`、`ui-radius`、`web-styling`、`deepseek-llm-api-wire-extensions`、`testing`、`development`，及目录 `cookbook`、`cordis-api`、`i18n`、`persistence-changes`、`postmortem`、`subsystems`、`upgrade-guide`、`user`。
- 站点 `/en/reference/subsystems/` 索引解析出 66 条 `subsystems/*.md` 链接，去后缀与 64 模块比对：**命中 64、未命中 0**。
- 64 模块逐篇的「上游已核」尚未完成，记在 `docs/plans/dsh-capability-matrix.md`（该列全为未勾选）。本账本声明的覆盖数 8 是冻结取证面，不是 64 模块阅读面。**矩阵的「已复刻」列已于 2026-10-03 按方案 §6.1.2 的 A/B/C 分档回填（✔ 9 / ◐ 4 / ☐ 50，README 不计数），但「上游已核」仍全 ☐——不因我方写了实现就反推读过原文。**
- 名称漂移（2026-10-03 逐名比对）：`invariants` **只在冻结快照** `639ed01` 存在、当日 `master` 已无；`master` 新增 `claude-code-mods`、冻结快照没有。两边各 64 个 `.md`、各 192 条目，所以这不是截断而是改名/增删。矩阵按 S0 冻结口径保留 `invariants`、不加 `claude-code-mods`。

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

## 8. stdx 落地实测（2026-10-02，B 段结论）

- 枚举通道：`https://gitcode.com/api/v5/repos/Cangjie/cangjie_stdx/releases` 200 可用（`releases.atom` 与 `api.github.com` 同路径均不可用；SPA 网页返回 200 但正文 5.8 KB、0 条链接，属「正文空」，不可据以判断没有发行版）。
- 标签共 15 个，与本机 `cjc 1.1.3` 对应的是 **`v1.1.3.1`**（同批还有 v1.2.0.1 等，未采用）。
- Windows 资产直链：`.../releases/download/v1.1.3.1/cangjie-stdx-windows-x64-1.1.3.1.zip`（6.7 MB，已下载解压到 `C:/Users/jingg/stdx-work/stdx-1.1.3.1/windows_x86_64_cjnative/{dynamic,static}/stdx`，仓库外，不入库）。
- **动态链接验证通过**：`cjpm.toml` 用 `[target.x86_64-w64-mingw32.bin-dependencies] path-option` 指向 `dynamic/stdx`，`cjpm build` 退出码 0；`stdx.encoding.json`、`stdx.net.http`、`stdx.net.tls`、`stdx.log`、`stdx.compress` 五个包全部解析并链接成功 —— 原「stdx 缺失是 P0 唯一硬阻塞」已解除。
- 分发约束实测：裸运行失败 `libstdx.compress.dll: cannot open shared object file`（退出码 127）；把 `dynamic/stdx`（**41 个 DLL**）加入 `PATH` 后运行成功。→ CLI 平台包与 Electron 安装包都必须携带这些 DLL。
- 静态路径未通过：`static/stdx` 配置后 `ld.lld` 链接失败（crypto/net 依赖系统符号；官方文档只给了 Linux 的 `compile-option = "-ldl"`，Windows 等价写法待补）。且该次链接命令仍包含 `-l:libcangjie-runtime.dll`，说明**静态 stdx 也不等于单文件交付**，仓颉运行时 DLL 仍需随包发布。
- cjpm 工程规范实测：`cjpm.toml` 的 `[package]` 必须写 `cjc-version`；目录名、`name`、源码 `package` 三者必须一致；`path-option` 用正斜杠路径可避开源码转义坑。

## 9. 本次复刻时间点与上游增量跟踪（2026-10-06）

本节是本次检查时的记录，不表示持续监控，也不升级现有能力完成状态。

| 项 | 本次记录 |
|---|---|
| 检查时间 | 2026-10-06 19:04:52 +08:00（2026-10-06T11:04:52Z） |
| 本次复刻基线 S0 | `639ed015397290b3745d163aafe02ffee4aa3f84`，保持冻结，不自动改为 master |
| S0 上游提交时间 | 2026-09-29 17:21:31 +08:00；首次取证日 2026-10-02 |
| 上游仓库及分支 | `deepseek-ai/deepseek-harness` / `master`；GitHub repo API 再次确认默认分支 |
| 本次观察到的上游 HEAD | `5badb15009ae1756c3afe0ae0cef1faafc290ccc` |
| HEAD 上游提交时间 | 2026-10-03 11:48:13 +08:00（2026-10-03T03:48:13Z） |
| HEAD 内容 | 合并 PR #5648，准备 DSH `0.2.1-alpha.1` |
| 相对 S0 | GitHub compare：ahead 266 / behind 0 / total_commits 266（包括合并提交，不等于 266 项功能） |
| 相对此前检查 | 2026-10-04 阅读记录已有 `5badb150…`；本次未发现更新的 master HEAD |
| SaCode 写入记录前的 HEAD | `172c499c137aca51f18dab45ce3ba0957b6dc01f` / `refactor/dsh-learning`；工作区仍有在途改动，不是最终交付冻结版本 |

一手证据：
- [仓库元数据](https://api.github.com/repos/deepseek-ai/deepseek-harness)
- [master 提交列表](https://api.github.com/repos/deepseek-ai/deepseek-harness/commits?sha=master&per_page=5)
- [本次上游 HEAD](https://github.com/deepseek-ai/deepseek-harness/commit/5badb15009ae1756c3afe0ae0cef1faafc290ccc)
- [S0 至本次 HEAD 比较](https://github.com/deepseek-ai/deepseek-harness/compare/639ed015397290b3745d163aafe02ffee4aa3f84...5badb15009ae1756c3afe0ae0cef1faafc290ccc)

证据限制：默认 compare 响应只有 250 条 commits，而 total_commits 为 266；files 返回 300 条，已达该 API 文件列表上限。因此这不是完整提交/文件变更清单，不能据此宣称全部更新已分析。响应中可见实验 Claude Code mods、独立 npm 发布通道、vendor 预发布和 DSH 版本发布等提交，但本次没有逐文件核查或移植这些能力。浏览工具访问 API 失败；实际取证使用 PowerShell HTTPS GitHub API，成功返回结构化响应。

### 后续更新处理规则

1. 每次开始新的上游核查，获取默认分支完整 HEAD、提交时间和检查时间。与本节最后观察到的完整 SHA 比较；未变化则记录“无新增提交”，不重复复刻。
2. HEAD 变化时，先分析“上次观察 HEAD → 新 HEAD”的新增更新；同时维护“S0 → 候选新基线”的累计差异。通过分页提交查询和本地 Git diff 等补齐 API 截断，不把 300 个文件当完整范围。
3. 按新增功能、行为变化、缺陷修复、持久格式/协议、安全与授权、依赖许可、纯文档/发布变更分类；落实到现有 63 子系统、54 前端包及自有增量，注明是否涉及既定裁剪项。
4. 每项写清上游 SHA/路径、SaCode 现有实现、影响与兼容/迁移要求、责任人、定向正反验收，再决定直接承接、扩展或不适用。不能把上游提交标题等同于已实现功能。
5. 本轮 S0 保持不变；候选更新单独登记，完成影响分析和范围决定后才实施。需要升级复刻基线时另记新 SHA、理由、范围差集和验收，不能覆盖历史冻结记录。
6. 每次核查后追加新的检查记录与实际移植状态；“最后观察到的 HEAD”和“已复刻基线”分开维护。最终产物另记录源码 SHA、构建时间和摘要，不能用本节的观察时间代替产物验收。

后续继续在 `refactor/dsh-learning` 工作，按文件所有权串行集成公共入口，不为每次核查创建本地任务分支。