# DSH 能力矩阵（S0 冻结快照）

快照：`deepseek-ai/deepseek-harness` @ `639ed015397290b3745d163aafe02ffee4aa3f84`（提交时间 2026-09-29T09:21:31Z，默认分支 `master`，SPDX `MIT`），抓取日 2026-10-02。

分母来源：`api.github.com/repos/.../contents/docs/subsystems?ref=master` 返回 **192 条目 = 64 个 `*.md` + 64 个 `*.zh.md` + 64 个 `*.i18n.yaml`**，按 GitHub contents 单目录上限 1000 判为完整清单（非分页截断）。站点侧分母来自 `/en/reference/subsystems/` 索引页解析出的 66 条 `subsystems/*.md` 链接，去 `.md` 后与仓库 64 个模块**逐一对上（命中 64／未命中 0）**。

列义：`zh`=仓库是否含中文文档；`站点参考页`=站点导航是否有同模块页；`建议阶段`=按下方关键词规则的粗分，**需人工复核，不作为承诺**；`上游已核`=我们是否已直读过该模块的 en/zh 原文与生成物；`本方已复刻`=本仓实现并通过其验收用例。

阶段关键词规则：M0 基座（cordis/core/scope/invariants/boot/typert/gateway）、M1 会话与存储、M2 模型与上下文、M3 loop 与目标、M4 工具与执行世界、M5/M6 客户端与前端装配、M7 委托与编排、M8 外部集成。

| 模块 | zh | 站点 | 阶段 | 上游已核 | 已复刻 | 备注 |
|---|:-:|:-:|---|:-:|:-:|---|
| agent-team | ✔ | ✔ | M3 | ☐ | ☐ | 待填 |
| approval | ✔ | ✔ | M4 | ☐ | ☐ | 待填 |
| attachment | ✔ | ✔ | M5/M6 | ☐ | ☐ | 待填 |
| boot | ✔ | ✔ | M0 | ☐ | ☐ | 待填 |
| browser-use | ✔ | ✔ | M8 | ☐ | ☐ | 待填 |
| client-modules | ✔ | ✔ | M5/M6 | ☐ | ☐ | 待填 |
| client-resources | ✔ | ✔ | M5/M6 | ☐ | ☐ | 待填 |
| commands | ✔ | ✔ | M7 | ☐ | ☐ | 待填 |
| compaction | ✔ | ✔ | M2 | ☐ | ☐ | 待填 |
| computer-use | ✔ | ✔ | M8 | ☐ | ☐ | 待填 |
| conversation | ✔ | ✔ | M5/M6 | ☐ | ☐ | 待填 |
| core | ✔ | ✔ | M0 | ☐ | ☐ | 待填 |
| credentials | ✔ | ✔ | M5/M6 | ☐ | ☐ | 待填 |
| deliverables | ✔ | ✔ | M5/M6 | ☐ | ☐ | 待填 |
| extensions | ✔ | ✔ | M8 | ☐ | ☐ | 待填 |
| feedback | ✔ | ✔ | M5/M6 | ☐ | ☐ | 待填 |
| filesystem | ✔ | ✔ | M4 | ☐ | ☐ | 待填 |
| goal | ✔ | ✔ | M3 | ☐ | ☐ | 待填 |
| invariants | ✔ | ✔ | M0 | ☐ | ☐ | 待填 |
| jobs | ✔ | ✔ | M4 | ☐ | ☐ | 待填 |
| llm-streaming | ✔ | ✔ | M2 | ☐ | ☐ | 待填 |
| lsp | ✔ | ✔ | M4 | ☐ | ☐ | 待填 |
| mcp | ✔ | ✔ | M7 | ☐ | ☐ | 待填 |
| office-to-pdf | ✔ | ✔ | M8 | ☐ | ☐ | 待填 |
| otel | ✔ | ✔ | M8 | ☐ | ☐ | 待填 |
| permission-presets | ✔ | ✔ | M4 | ☐ | ☐ | 待填 |
| persistence | ✔ | ✔ | M1 | ☐ | ☐ | 待填 |
| plan | ✔ | ✔ | M4 | ☐ | ☐ | 待填 |
| product-telemetry | ✔ | ✔ | M1 | ☐ | ☐ | 待填 |
| ptc-runtime | ✔ | ✔ | M4 | ☐ | ☐ | 待填 |
| sandbox | ✔ | ✔ | M4 | ☐ | ☐ | 待填 |
| schedule | ✔ | ✔ | M3 | ☐ | ☐ | 待填 |
| scope | ✔ | ✔ | M0 | ☐ | ☐ | 待填 |
| session | ✔ | ✔ | M1 | ☐ | ☐ | 待填 |
| session-projection | ✔ | ✔ | M1 | ☐ | ☐ | 待填 |
| session-query | ✔ | ✔ | M1 | ☐ | ☐ | 待填 |
| session-reference | ✔ | ✔ | M1 | ☐ | ☐ | 待填 |
| session-telemetry | ✔ | ✔ | M1 | ☐ | ☐ | 待填 |
| session-title | ✔ | ✔ | M1 | ☐ | ☐ | 待填 |
| settings | ✔ | ✔ | M5/M6 | ☐ | ☐ | 待填 |
| shell | ✔ | ✔ | M4 | ☐ | ☐ | 待填 |
| sidebar-right | ✔ | ✔ | M5/M6 | ☐ | ☐ | 待填 |
| skills | ✔ | ✔ | M4 | ☐ | ☐ | 待填 |
| slots | ✔ | ✔ | M5/M6 | ☐ | ☐ | 待填 |
| spill | ✔ | ✔ | M1 | ☐ | ☐ | 待填 |
| ssh | ✔ | ✔ | M8 | ☐ | ☐ | 待填 |
| storage | ✔ | ✔ | M1 | ☐ | ☐ | 待填 |
| subagent | ✔ | ✔ | M7 | ☐ | ☐ | 待填 |
| subprocess | ✔ | ✔ | M4 | ☐ | ☐ | 待填 |
| system-prompt | ✔ | ✔ | M2 | ☐ | ☐ | 待填 |
| terminal | ✔ | ✔ | M4 | ☐ | ☐ | 待填 |
| todo | ✔ | ✔ | M7 | ☐ | ☐ | 待填 |
| token-meter | ✔ | ✔ | M2 | ☐ | ☐ | 待填 |
| tools | ✔ | ✔ | M4 | ☐ | ☐ | 待填 |
| typert | ✔ | ✔ | M0 | ☐ | ☐ | 待填 |
| user-questions | ✔ | ✔ | 待定 | ☐ | ☐ | 待填 |
| voice-input | ✔ | ✔ | M8 | ☐ | ☐ | 待填 |
| web | ✔ | ✔ | M4 | ☐ | ☐ | 待填 |
| web-client | ✔ | ✔ | M5/M6 | ☐ | ☐ | 待填 |
| web-server | ✔ | ✔ | 待定 | ☐ | ☐ | 待填 |
| webhook | ✔ | ✔ | M8 | ☐ | ☐ | 待填 |
| workflow | ✔ | ✔ | M7 | ☐ | ☐ | 待填 |
| workspace | ✔ | ✔ | M5/M6 | ☐ | ☐ | 待填 |
| README | ✔ | — | 待定 | ☐ | ☐ | 子系统目录索引页 |
