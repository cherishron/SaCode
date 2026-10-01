# Desktop 迭代计划（交互完整性 → 特色外显 → 硬化）

> 状态：v1.0（2026-10-12）· 基于四组首轮进度与 Local Mode 定稿
> 原则：三列验收（已实现 / 已通过测试 / 已通过原生桌面验收），构建成功 ≠ 操作验收

---

## 总览

| 轮次 | 主题 | 出口条件 |
| --- | --- | --- |
| **R1** 收尾 | 交互完整性（首轮四组） | Agent1/4 收工 + 集成 + 真机冒烟 |
| **R2** | Local Mode 落地 + 灵枢外显 + 真 API 接通 | 干净机器无登录跑通；灵枢卡可见 |
| **R3** | 硬化与性能 | 子代理扩展、终端仿真完善、包体拆分、MonkeyCode 对照验收 |

---

## R1 · 当前轮收尾（进行中）

### 已完成
- ✅ **Agent2** 会话与输入：卡片颗粒度、思考/技能/草稿/用量（25 测试）
- ✅ **Agent3** 侧栏与管理：会话管理、MCP headers/env、技能导入、知识库/自动化布局（15 测试 + Local Mode 文案）

### 进行中
- 🔄 **Agent1** 工作台：统一右侧标签栏、嵌套分屏、布局恢复（`SplitNode.vue` TS 报错待清）
- 🔄 **Agent4** 原生接口：契约字段、PTY 通道、`events[]` 落盘

### R1 收尾清单（集成时做）
| # | 项 | 负责 | 验收 |
| --- | --- | --- | --- |
| 1 | 清 `SplitNode.vue` TS 错误，全量 `vue-tsc` + `node --import tsx --test` 绿 | Agent1 | 构建/测试绿 |
| 2 | `client-core` `npm run build`，desktop 能 import 新类型 | Agent4 | 类型解析通过 |
| 3 | 鸭子类型探测 → 真 API 切换核对（会话搜索/归档/重命名/MCP/技能） | Agent3 复查 + Agent4 | 断网 mock 与真 API 双路径 |
| 4 | 原生桌面冒烟：启动 → 开会话 → 发消息 → 右侧四标签 → 终端 | 你 / 我协助 | 真机截图或步骤记录 |
| 5 | 三列验收表更新到各任务卡 | 全员 | 无「用构建冒充验收」 |

**出口**：无 TS 错误、测试绿、原生冒烟过，R1 关闭。

---

## R2 · Local Mode + 灵枢外显 + 真 API（下一轮派发）

### 2.1 Local Mode 落地（T6，`docs/plans/local-mode-plan.md`）
| # | 项 | 归属 | 优先 |
| --- | --- | --- | --- |
| B1/B2 | `/account/status` 返回 `mode`；云端点失败结构化降级 | Agent4 | P0 |
| C1/C2/C4 | 模式横幅、云能力置灰一行原因（文案 Agent3 已铺） | Agent3 | P0 |
| C5 | 「添加本地模型」向导 | Agent3 | P1 |
| D1–D3 | 零配置启动、引导到模型向导、env 缺省即 local | Agent4 | P1 |
| B3/B4 | 任务路径零账号依赖审计；Git 无 sa-idp 可用 token/SSH | Agent4 | P2 |

### 2.2 灵枢特色外显（契约 §2.2/§2.4 已就绪）
| # | 项 | 归属 | 说明 |
| --- | --- | --- | --- |
| L1 | `role_assignment` / `conflict` / `model_route` / `summary` 四类事件落盘 | Agent4 | 自 `ExecutionReport` 投影 |
| L2 | 四类灵枢卡片（对照契约 §2.3） | Agent2 | 复用折叠卡管道 |
| L3 | 冲突未决红 / 已解绿状态 | Agent2 | 自防护故事外显 |

### 2.3 真 API 接通（R1 遗留的正向闭环）
| # | 项 | 归属 |
| --- | --- | --- |
| A1 | 会话 `GET ?q=` / archive / restore / rename 落盘 | Agent4 + Agent3 |
| A2 | MCP `headers/env` 类型对齐 + transport 词表统一 | Agent4 + Agent3 |
| A3 | 技能 `POST /api/skills/import` + `enabled` 落盘 | Agent4 + Agent3 |
| A4 | `ConversationSettings.draft` 替换 localStorage 兜底 | Agent4 + Agent2 |
| A5 | `context_window` 真值回填，去掉 200k 兜底 | Agent4 + Agent2 |

**R2 出口**：干净机器无登录跑任务；灵枢四卡可见；R1 鸭子类型全部换成真 API。

---

## R2.5 · 多 ACP 后端与额度调度（OpenCode / CodeBuddy / 其它）

> 诉求（用户定案）：可开关地把 ACP 编码代理当子代理用；缺了就检查/安装；完成回传我方续跑；
> **当日额度尽则熔断，次日自动继续**。OpenCode 已有骨架，CodeBuddy 及其它开放 ACP 的同类产品一并接入。

### 架构（复用已有 `agent_backends`，不另起炉灶）

```
Desktop / CLI
   └─ daemon BackendRegistry
        ├─ native（SaCode 自己）
        ├─ acp:opencode     ← 已有实验骨架
        ├─ acp:codebuddy    ← 若其开放 ACP
        └─ acp:<其他>       ← 可插拔
```

| # | 项 | 归属 | 说明 |
| --- | --- | --- | --- |
| O1 | 后端注册表泛化：`AcpBackendConfig` 支持任意 id/display/command（不只 `opencode()`） | Agent4 | 现 `opencode_map` 抽象为 `acp_map` + 每后端映射器 |
| O2 | **探测/安装引导**：探测可执行文件与 `--acp` 能力；缺失时 UI 给安装指引（不静默下载） | Agent4 + Agent3 | |
| O3 | **设置开关**：每个 ACP 后端独立 enable/disable + 路径/参数配置 | Agent3 | |
| O4 | **子代理派发**：开关开时任务可路由到该 backend（`backend_id`）；完成/失败回传统一 TurnEvent | Agent4 + Agent2 | ACP 事件 → `events[]` |
| O5 | **额度状态机**：`quota: { date, used, limit?, exhausted, reason? }`；识别限流/429/额度文案即 `exhausted` | Agent4 | 按日（UTC+8）重置 |
| O6 | **队列挂起与日切恢复**：`exhausted` 时不派发、任务排队不丢；次日自动放行 + 可选提示 | Agent4 | |
| O7 | CodeBuddy / 其它：先**核实是否公开 ACP**（命令、版本、握手）；有则加映射器，无则文档记「待其开放」 | Agent4 | 不许臆造协议 |

#### O7 核实结论（2026-09-30）：CodeBuddy Code **已公开支持 ACP**

已核实腾讯 CodeBuddy Code（CLI，`@tencent-ai/codebuddy-code`）官方文档明示「CodeBuddy Code 原生支持 ACP 协议，可以作为智能体服务端与支持 ACP 的编辑器无缝集成」。核实要点：

- **命令**：`codebuddy --acp` —— 是 **flag 不是 `acp` 子命令**。默认 stdio NDJSON 传输；`--acp-transport stdio|streamable-http` 可选（仅在带 `--acp` 时生效）。另：`--serve` 模式下未叠加 `--acp` 时 ACP 走 HTTP `/api/v1/acp`，不往进程 stdout 吐 `session/update` JSON-RPC。`--acp` 与 `--a2a` 互斥。
- **版本**：npm 包 `@tencent-ai/codebuddy-code`，核实时最新版 `2.160.0`（2026-09）。官方文档库：`cnb.cool/codebuddy/codebuddy-code` `docs/acp.md` + `docs/cli-reference.md`（含 `--acp` / `--acp-transport` 参数表）。文档未标注 `--acp` 的最低引入版本。
- **握手示例**（官方 Zed 集成配置，`~/.config/zed/settings.json`）：

  ```json
  {
    "agent_servers": {
      "CodeBuddy Code": {
        "command": "codebuddy",
        "args": ["--acp"],
        "env": {
          "CODEBUDDY_API_KEY": "your-api-key",
          "CODEBUDDY_INTERNET_ENVIRONMENT": "internal"
        }
      }
    }
  }
  ```

  （`CODEBUDDY_INTERNET_ENVIRONMENT`：海外版不设置 / 中国版 `internal` / iOA 版 `ioa`。）协议侧为标准 ACP JSON-RPC（initialize → session/new → session/prompt …），扩展走 `_meta` 命名空间（如 `codebuddy.ai/conversationRequestId`、`codebuddy.ai/userinfo`、`codebuddy.ai/teamUpdate`）；`initialize` 响应带 `agentCapabilities.multitaskSupport`。Multitask 是会话级 overlay，走 `session/set_config_option`（`configId=multitask`，JSON boolean），**不要** `--acp --agent multitask`（入口守卫直接拒、进程非 0）。
- **接入含义**：`AcpBackendConfig` 映射器可直接加 `codebuddy`（executable=`codebuddy`, args=`["--acp"]`），与 `opencode` 同构；探测用 `codebuddy --version` + ACP initialize 握手。
- **备注**：截至核实日 CodeBuddy 尚未出现在 ACP 官方 agents 列表（agentclientprotocol.com），但腾讯官方文档已公开声明原生支持，按「支持」处理；映射器落地时以官方 `docs/acp.md` 为准，勿扩写未记载的协议行为。

**证据链接**：
- https://cnb.cool/codebuddy/codebuddy-code/-/blob/main/docs/acp.md （官方 ACP 集成文档）
- https://cnb.cool/codebuddy/codebuddy-code/-/blob/main/docs/cli-reference.md （`--acp` / `--acp-transport` 参数）
- https://www.npmjs.com/package/@tencent-ai/codebuddy-code （安装与版本）
- https://agentclientprotocol.com/get-started/agents.md （ACP 官方 agent 列表，未收录 CodeBuddy）

**R2.5 出口**：设置里开 OpenCode → 派任务 → 完成续跑；人为耗尽额度 → 当日停调、次日恢复；切换/关闭后端不影响 native。

---

## R3 · 硬化与性能（再下一轮）

| # | 项 | 归属 | 备注 |
| --- | --- | --- | --- |
| P1 | 子代理扩展：`task.spawn` 加 `review`/`test`；角色加 `doc-writer` | Agent4 | 参考上轮讨论，克制加型 |
| P2 | 终端 xterm.js 真仿真 + 多 tab + resize 同步 | Agent1 + Agent4 | 若 R1 未做完 |
| P3 | 主 JS 包拆分（当前 ~5.96MB） | Agent1 | route 级 lazy + 高亮按需 |
| P4 | 预览开发服务发现（探测 3000/5173/8080） | Agent1 | 契约已标「后续」 |
| P5 | 历史帧 / 审批 / 提问重启恢复硬化 | Agent4 | |
| P6 | **MonkeyCode 同尺寸对照验收** | 你 + 我协助 | 形态不抄视觉资产 |
| P7 | 记忆沉淀管理页（mistakes / preferences） | Agent3 | 不进消息流 |
| P8 | Tauri 打包与发布门禁 | Agent4 | 对齐 `check-release.js` |

**R3 出口**：性能/终端/对照验收达标，可打可发版本。

---

## 风险与依赖

| 风险 | 缓解 |
| --- | --- |
| 共享文件冲突（4 组同改） | 文件归属表 + 先协调；R2 按 A/B/L 切分更细 |
| `SplitNode.vue` 阻塞全量构建 | R1 第一项硬清 |
| 鸭子类型静默失效 | R2 A1–A5 显式「真 API 切换」验收，不允许只测 mock |
| 原生验收缺口积累 | 每轮 R 出口都有真机冒烟，不留到最后一轮 |
| 范围膨胀（云端/子代理爆炸） | 排除清单 + 加型克制 |

---

## 派发节奏建议

1. **R1 收工后立刻集成**（不等所有项完美）
2. **R2 派发按 2.1 → 2.2 → 2.3**：Local Mode 先（用户价值最直接），灵枢外显次之，真 API 收尾
3. **R3 等 R2 出口**再开，避免三线并行摊薄
