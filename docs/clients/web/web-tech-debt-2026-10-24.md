# Web 工作台（apps/web）技术负债台账

> 类别：⑥ 工程治理（计划/治理类）｜上级索引：[docs/README.md](../../README.md)、[plans/README.md](../../plans/README.md)
> 核查时间：2026-10-24 23:50–（GMT+8）｜核查方式：**读当前源码与跑真实命令**，不沿用旧快照或旧日报结论
> 关联：[Web PoC 证据 §11](2026-10-23-web-w01-w02a-poc.md#11-w02-b-故障修复与真实-daemon-只读接入2026-10-24-2342-阶段回报)、[PRD 台账 W02/W03](../../product/PRD-tracking.md)

## 1. 背景

本轮由用户提问"web 端还有技术负债吗"触发。此前的阶段回报集中在**功能证据**（故障修复、真实 daemon 联调），
没有系统核对**工程治理面**（版本控制、静态检查、CI、机器绑定）。本台账补齐这一面。

核查命令基线（可复跑）：

| 检查 | 命令 | 结果 |
|---|---|---|
| 是否入库 | `git ls-files apps/web \| wc -l` | 修复前 **0** |
| 是否被忽略 | `git check-ignore -v apps/web/package.json` | 未命中（非忽略，是从未 add） |
| 依赖漏洞 | `npm audit --omit=dev` | **0 漏洞** |
| 静态检查 | `ls .eslintrc* eslint.config.* .prettierrc*` | 修复前全部不存在 |
| CI 覆盖 | `grep -rl "apps/web" .github/workflows/ scripts/*` | 修复前无命中 |

## 2. P0 · 工程治理（已完成）

| # | 负债 | 修复 | 验证 |
|---|---|---|---|
| 1 | 整个 `apps/web` 从未纳入版本控制：61 文件 / 4918 行源码、全部测试处于未跟踪状态 | `git add apps/web`（**仅暂存，未 push**） | `git ls-files apps/web` 由 0 变为 77，且无二进制/产物混入 |
| 2 | 一次性截图混入仓库：`screenshots/*.png`（4 张）未被忽略，违反"一次性产物进 `target/tmp/`"约定 | 根 `.gitignore` 新增 `apps/web/screenshots/` 与 Playwright 产物目录 | `git check-ignore` 命中截图；`public/sacode-logo.png`、`favicon.svg`、`real-daemon-readonly-fixture.mjs` 仍正常入库 |
| 3 | 无 ESLint / Prettier：61 文件零静态检查 | 新增 `eslint.config.js`、`.prettierrc.json`、`.prettierignore`；新增 `lint`/`lint:fix`/`format`/`format:check` 脚本 | `npm run lint` rc=0；`npm run format:check` rc=0 |
| 4 | CI 与仓级门禁完全不覆盖 Web | 新增 `.github/workflows/web.yml`（windows-2022 / Node 22.22） | js-yaml 解析通过，11 个 step 均含 `uses` 或 `run`；本机按同序列（lint→format→typecheck→test→build→e2e）跑通 |
| 5 | `apps/web` 源码从未入库之外的单点：一次性截图与 Playwright 产物（`test-results/`、`playwright-report/`）无忽略规则 | 根 `.gitignore` 一并加入 `blob-report/`、`.playwright/` | `git add -An` 复核对账：待入库 77 项，无任何二进制或产物 |

### 2.1 附带修复：两处机器绑定路径

`playwright.config.ts` 与 `playwright.deploy.config.ts` 曾把浏览器路径硬编码为
`C:/Users/jingg/AppData/Local/ms-playwright/chromium_headless_shell-1243/...`。
这在 CI 或任何第二台机器上必然失败。已改为：默认用 Playwright 自身解析的浏览器，
需要指定时才读 `PW_CHROMIUM_EXE`。

> 这条掩盖了一个真实问题：本机缓存浏览器版本与 `@playwright/test` 所需版本长期不匹配
> （本机缓存 **1243**，`@playwright/test` 1.64.1 需要 **1248**），此前靠硬编码绕开。
>
> **实测结论（2026-10-24）**：
> - `npx playwright install chromium` 在本机执行超过 11 分钟未生成 `chromium-1248` 目录，
>   判断为网络受限而非命令错误；本轮**未完成**该下载。
> - 以 `PW_CHROMIUM_EXE` 指向已有 1243 headless shell 后，**E2E 13/13 通过**（exit 0）。
>   即：配置改动本身正确，本机版本落后是环境问题，可通过环境变量显式解决。
> - CI 中已含 `npx playwright install chromium` 步骤，不受本机缓存影响。

## 2.2 P0 修复后的统一回归读数

| 项目 | 命令 | 结果 |
|---|---|---|
| 静态检查 | `npm run lint` | **rc=0**（自动修复 2 项：`import type` 一致性、`prefer-const` 例外） |
| 格式校验 | `npm run format:check` | **rc=0**（全库首次格式化，printWidth 110） |
| 类型检查 | `npm run typecheck` | **rc=0** |
| 单元与集成 | `npm test` | **123 通过 / 1 门控默认跳过**（16 文件通过 + 1 跳过文件） |
| 构建 | `npm run build` | **rc=0** |
| 浏览器 E2E | `npm run test:e2e`（配 `PW_CHROMIUM_EXE`） | **13/13 通过** |

## 3. P1 · 功能与可靠性

| # | 负债 | 状态与说明 | 依赖 |
|---|---|---|---|
| 5 | 上游 SSE 断线不可观测 | **已闭合（2026-10-25 01:5x）**，见 §3.1；残留限制见同节末尾 | — |
| 6 | 真实业务直播未验证 | 未闭合：真实链路只验证 `session/events` 持久补读；`session/subscribe` 直播授权与 fan-out 未跑 | 需受控直播负例 |
| 7 | 候选非同源 | 未闭合：联调用的 daemon `4AD3185F…`、Host `CC8299B6…` 非本轮源码构建；正式候选 `E9099849…` 更旧 | 需同源构建 + 该构建上复跑负例 |
| 8 | 任务执行/审批未开放 | 未闭合（属产品未完成，非代码缺陷）：输入框 `disabled` 标"待接入"，真实白名单仅三个 read 方法 | — |

### 3.1 #5 上游断线的处理：改「可观测」而非改「信号源」

桌面 `RemoteTransport` 的 SSE pump 静默结束、无 `onClose`，Web 拿不到断开信号。
按用户选择**不动桌面共享文件**，因此不在对端加回调，而是在 Web 侧换判据：

| 层 | 改动 | 效果 |
|---|---|---|
| 真实适配器 | 订阅后按 30s 轮询持久真源（`session/catalog` 发现会话 → 回 `session/events` 取增量），时钟与间隔可注入 | SSE pump 静默死亡时**仍能取到事件**，不再出现"已连接却永远无数据"；轮询同时充当活性探测 |
| 真实适配器 | 轮询失败即标记 `failure`（复用既有机制） | 后续读取**显式失败**，不回落合成空成功 |
| Broker | 新增 `onUpstreamLost` 钩子，`handleUpstreamLost()` 关闭上游并通知订阅者 | 失联向下传播 |
| Gateway | 失联时从缓存摘除 broker | **上游恢复后能自愈重建**，重新走身份与绑定校验，而不是沿用失效订阅 |
| SSE 路由 / 前端 | 新增 `upstream-lost` 控制帧（背压时直接断开），前端如实标为"已断开"并重连 | 浏览器不再显示假在线 |

**残留限制（未闭合）**：
- 新事件最坏延迟约等于轮询间隔（默认 30s）；SSE 正常时仍是即时通知。
- 轮询是"取得到数据"，不等于"链路真的健康"；判定的是"读不到"，不是"连接断了"。
- 失联后靠下次请求触发重建，**不是主动重连**；无后台守护线程持续重试。
- 未做真实 daemon 上的断线验证（合成环境不会失联），用例仅覆盖注入的假时钟。

## 4. P2 · 测试缝隙

| # | 负债 | 说明 |
|---|---|---|
| 9 | 真实链路测试默认跳过 | `real-daemon.spec.ts` 需外部真机配置，默认 1 项跳过，CI 中永不执行；缺默认可跑的合成驱动器 |
| 10 | 浏览器侧断线/撤销未端到端验证 | `auth-expired` 重连补读只有 Vitest 覆盖，浏览器 E2E 13 条不含"服务端撤销 → 浏览器流自动关闭"；新增的 `upstream-lost` 同样只有 Vitest 覆盖 |
| 11 | 时间边界 flaky（已修） | `session.test.ts` 的 `touch extends idle` 原为 idle 80ms + 两次 `wait(50)`，容错仅约 30ms，整套并发时偶发失败；已放宽为 idle 300ms + `wait(200)/wait(150)`，语义不变（不 touch 会过期，touch 后存活） |

## 5. 确认「不是负债」的部分（实测通过）

- `npm audit --omit=dev` → **0 漏洞**
- 安全面齐全：`@fastify/helmet`、`@fastify/rate-limit`、登录限速、CSRF、`__Host-` 前缀 cookie + Secure/HttpOnly/SameSite=Strict
- `test:e2e:deploy` 引用的 `playwright.deploy.config.ts` 实际存在（非悬空脚本）

## 6. 治理约定（本轮确立）

1. Web 端任何改动提交前必须通过：`npm run lint` → `npm run format:check` → `npm run typecheck` → `npm test` → `npm run build`。
2. 新增静态资源必须显式确认既不被忽略、也不是一次性证据。
3. 跨机器/CI 一律不写本机绝对路径；确需外部二进制时用环境变量注入。
4. 一次性视觉截图只作为对话交付物；长期结论以 `docs/evidence/` 文字记录为准。
