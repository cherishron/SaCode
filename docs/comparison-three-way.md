# SaCode vs Claude Code vs Gemini CLI 三方功能对比报告

> 生成时间：2026-04-03
> 分析对象：SaCode（当前项目）vs Claude Code（Anthropic）vs Gemini CLI（Google）

---

## 一、核心定位对比

| 维度 | Claude Code | Gemini CLI | SaCode |
|------|-------------|------------|--------|
| **产品形态** | CLI 终端工具 | CLI 终端工具 | Monorepo 多端框架 |
| **开源协议** | 闭源 | Apache 2.0（开源） | MulanPSL-2.0（开源） |
| **AI 后端** | 仅 Claude (Anthropic) | 仅 Gemini (Google) | 5 个 Provider（OpenAI/Anthropic/DeepSeek/Moonshot/智谱） |
| **上下文窗口** | 100 万 Token | 100 万 Token | 依赖 Provider |
| **单次输出** | 最高 128k Token | 依赖 Gemini | 依赖 Provider |
| **设计哲学** | "先推理，后执行" | "快速直接执行" | "多平台覆盖 + 企业级管控" |
| **目标用户** | 个人开发者（深度推理） | 个人开发者（快速迭代） | 企业/多平台场景 |
| **生态集成** | 跨开发环境通用 | Google Cloud + Google 开发者工具链 | 10 个 IM 平台 + 企业系统 |

---

## 二、三者核心差异化定位

### Claude Code — "分析型工程师"
- **优势**：复杂系统调试、大型仓库重构、架构设计评估、陌生代码库分析
- **特点**：推理透明度高，修改前提供详细逻辑说明
- **劣势**：重度推理场景下响应延迟略高；不支持多 IM 平台

### Gemini CLI — "终端执行助手"
- **优势**：响应速度快、快速原型开发、高频迭代、多模态能力（Veo/Imagen）
- **特点**：原生 CLI 设计，命令执行、日志检查更流畅
- **劣势**：深度架构推理弱于 Claude；修改前解释较少；不支持多 IM 平台

### SaCode — "企业级多平台智能体"
- **优势**：多 Provider 灵活性、10 个 IM 平台覆盖、Web UI、容器隔离、成本追踪
- **特点**：企业级管控能力（智能路由、权限管理、定时任务、长任务管理）
- **劣势**：Agentic 自主能力待加强；终端体验不如 Claude Code/Gemini CLI 成熟

---

## 三、功能对比详细表格

### 3.1 AI 核心能力

| 功能 | Claude Code | Gemini CLI | SaCode | 领先者 |
|------|:-----------:|:----------:|:------:|:------:|
| **多 Provider 支持** | ❌ | ❌ | ✅ 5 个 | 🏆 SaCode |
| **上下文窗口** | 100 万 | 100 万 | 依赖 Provider | Claude/Gemini |
| **单次输出上限** | 128k Token | 依赖 Gemini | 依赖 Provider | Claude Code |
| **自适应推理** | ✅ 自动评估 | ❌ | ❌ | 🏆 Claude Code |
| **流式输出** | ✅ | ✅ | ✅ | 平局 |
| **多模态能力** | ❌ | ✅ Veo/Imagen | ❌ | 🏆 Gemini CLI |
| **成本追踪** | ❌ | ❌ | ✅ | 🏆 SaCode |

### 3.2 代码理解与编辑

| 功能 | Claude Code | Gemini CLI | SaCode | 领先者 |
|------|:-----------:|:----------:|:------:|:------:|
| **仓库理解** | ⭐⭐⭐⭐⭐ 结构推理 | ⭐⭐⭐⭐ 快速扫描 | ⭐⭐⭐⭐ 文件搜索 | Claude Code |
| **多文件编辑** | ⭐⭐⭐⭐⭐ 影响分析 | ⭐⭐⭐⭐ 快速执行 | ⭐⭐⭐ Capabilities | Claude Code |
| **代码搜索 (Grep)** | ✅ ripgrep | ✅ | ✅ ripgrep | 平局 |
| **文件匹配 (Glob)** | ✅ | ✅ | ✅ | 平局 |
| **LSP 集成** | ❌ | ❌ | ✅ 7 种操作 | 🏆 SaCode |
| **调试能力** | ⭐⭐⭐⭐⭐ 根因分析 | ⭐⭐⭐⭐ 快速定位 | ⭐⭐⭐ 基础 | Claude Code |
| **测试生成** | ⭐⭐⭐⭐⭐ 边界覆盖 | ⭐⭐⭐⭐ 标准模板 | ⭐⭐⭐ 基础 | Claude Code |

### 3.3 工具与扩展

| 功能 | Claude Code | Gemini CLI | SaCode | 领先者 |
|------|:-----------:|:----------:|:------:|:------:|
| **内置工具数量** | ~15 个 | ~10 个 | 33 个 | 🏆 SaCode |
| **MCP 协议** | Client | ✅ 支持 | Server + Client | 🏆 SaCode |
| **插件系统** | ✅ Skills/Plugins | ✅ Bundled Extensions | ✅ PluginManager | 平局 |
| **Shell 命令执行** | ✅ | ✅ 原生优势 | ✅ | 平局 |
| **浏览器控制** | ✅ Computer Use | ❌ | ✅ Puppeteer | Claude/SaCode |
| **Web 搜索** | ❌ | ✅ Google Search | ✅ DuckDuckGo | Gemini CLI |
| **Git 集成** | ✅ 完整工作流 | ⭐⭐⭐ 基础 | ⭐⭐ Worktree | Claude Code |

### 3.4 上下文与记忆

| 功能 | Claude Code | Gemini CLI | SaCode | 领先者 |
|------|:-----------:|:----------:|:------:|:------:|
| **双层记忆** | ✅ 全局 + 项目 | ❌ 仓库感知 | ⚠️ 单层 | 🏆 Claude Code |
| **配置文件** | ✅ CLAUDE.md 三层 | ✅ GEMINI.md | ⚠️ 基础配置 | Claude Code |
| **上下文查看** | ✅ `/context` | ❌ | ❌ | 🏆 Claude Code |
| **上下文分叉** | ✅ | ❌ | ❌ | 🏆 Claude Code |
| **自动记忆累积** | ✅ | ❌ | ⚠️ 基础 | Claude Code |
| **跨渠道会话** | ❌ | ❌ | ✅ SessionMapper | 🏆 SaCode |

### 3.5 安全与管控

| 功能 | Claude Code | Gemini CLI | SaCode | 领先者 |
|------|:-----------:|:----------:|:------:|:------:|
| **权限审批** | ✅ 内置机制 | ⭐⭐ 基础 | ✅ SecurityManager | Claude Code |
| **沙箱模式** | ✅ 默认启用 | ⭐⭐ 基础 | ✅ Docker/strict | Claude/SaCode |
| **容器隔离** | ❌ | ❌ | ✅ Docker | 🏆 SaCode |
| **命令黑名单** | ✅ | ⭐⭐ | ✅ 14 个危险命令 | Claude/SaCode |
| **网络域名白名单** | ❌ | ❌ | ✅ | 🏆 SaCode |
| **执行时间限制** | ❌ | ❌ | ✅ | 🏆 SaCode |

### 3.6 任务与自动化

| 功能 | Claude Code | Gemini CLI | SaCode | 领先者 |
|------|:-----------:|:----------:|:------:|:------:|
| **定时任务** | ✅ Scheduled | ❌ | ✅ Cron/Interval/Once | 🏆 SaCode |
| **长任务管理** | ❌ | ❌ | ✅ 进度跟踪+中断恢复 | 🏆 SaCode |
| **Auto Mode** | ✅ 自动/手动 | ❌ | ❌ | 🏆 Claude Code |
| **并行代理** | ✅ | ❌ | ⚠️ 框架存在 | Claude Code |
| **Computer Use** | ✅ 屏幕控制 | ❌ | ⚠️ 可集成 | 🏆 Claude Code |
| **Hook 系统** | ✅ 9 个事件 | ❌ | ✅ 插件钩子 | Claude Code |
| **云端执行** | ✅ | ❌ | ❌ | 🏆 Claude Code |

### 3.7 多平台与部署

| 功能 | Claude Code | Gemini CLI | SaCode | 领先者 |
|------|:-----------:|:----------:|:------:|:------:|
| **IM 平台支持** | ❌ | ❌ | ✅ 10 个平台 | 🏆 SaCode |
| **Web UI** | ❌ | ❌ | ✅ Vue 3 | 🏆 SaCode |
| **CLI 终端体验** | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ | Claude/Gemini |
| **远程控制** | ✅ | ❌ | ⚠️ 基础 Gateway | 🏆 Claude Code |
| **API 服务** | ❌ | ❌ | ✅ REST + WebSocket | 🏆 SaCode |
| **智能路由** | ❌ | ❌ | ✅ 规则引擎 | 🏆 SaCode |

### 3.8 定价与可用性

| 维度 | Claude Code | Gemini CLI | SaCode | 领先者 |
|------|:-----------:|:----------:|:------:|:------:|
| **开源** | ❌ | ✅ Apache 2.0 | ✅ MulanPSL-2.0 | Gemini/SaCode |
| **免费额度** | Pro $20/月 | 60 次/分, 1000 次/天 | 自托管免费 | Gemini CLI |
| **企业版** | Team/Enterprise | Enterprise | 自部署 | 视场景而定 |
| **自托管** | ❌ | ❌ | ✅ 完全支持 | 🏆 SaCode |

---

## 四、SaCode vs Claude Code 差距（复用）

详见 `docs/comparison-vs-claude-code.md`

**核心差距 TOP 5：**
1. Computer Use（计算机操作）
2. Auto Mode（自动模式）
3. 并行代理
4. 上下文查看 (`/context`)
5. 双层记忆机制

---

## 五、SaCode vs Gemini CLI 差距

### 5.1 核心差距

| 功能 | Gemini CLI | SaCode | 差距说明 | 优先级 |
|------|:----------:|:------:|----------|:------:|
| **CLI 终端体验** | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ | Gemini 原生终端交互更成熟 | 🔴 高 |
| **响应速度** | 快（执行优先） | 中等 | Gemini 优化了响应延迟 | 🟡 中 |
| **多模态能力** | ✅ Veo/Imagen | ❌ | 图片/视频生成能力 | 🟡 中 |
| **Google Search** | ✅ 内置接地 | ❌ | 实时网页上下文 | 🟡 中 |
| **仓库快速扫描** | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ | 快速定位与代码生成 | 🟡 中 |
| **原型开发速度** | 快 | 中等 | 高频迭代循环 | 🟡 中 |
| **开源协议** | Apache 2.0 | MulanPSL-2.0 | Apache 更国际化 | 🟢 低 |

### 5.2 SaCode 领先 Gemini CLI 的功能

| 功能 | SaCode | Gemini CLI | 说明 |
|------|:------:|:----------:|------|
| **多 Provider 支持** | ✅ 5 个 | ❌ 仅 Gemini | 避免厂商锁定 |
| **10 个 IM 平台** | ✅ | ❌ | 企业级多平台集成 |
| **Web UI** | ✅ Vue 3 | ❌ | 非终端用户体验 |
| **容器隔离** | ✅ Docker | ❌ | 企业级安全 |
| **智能路由** | ✅ 规则引擎 | ❌ | 灵活消息路由 |
| **长任务管理** | ✅ 进度跟踪 | ❌ | 复杂任务管控 |
| **成本追踪** | ✅ | ❌ | 多 Provider 定价 |
| **定时任务** | ✅ Cron/Interval/Once | ❌ | 自动化运维 |
| **跨渠道会话** | ✅ SessionMapper | ❌ | 全渠道体验 |
| **混合认证** | ✅ 本地 + OAuth | ❌ | 企业级认证 |
| **统一网关** | ✅ WebSocket | ❌ | 集中管控 |
| **LSP 集成** | ✅ 7 种操作 | ❌ | 代码智能感知 |
| **安全管理** | ✅ 完整管控 | ⭐⭐ 基础 | 企业级安全策略 |

---

## 六、三强雷达图

### 6.1 能力维度评分（1-5 分）

| 能力维度 | Claude Code | Gemini CLI | SaCode |
|:---------|:-----------:|:----------:|:------:|
| **代码理解深度** | 5 | 4 | 4 |
| **执行速度** | 3 | 5 | 3 |
| **多平台覆盖** | 1 | 1 | 5 |
| **企业级管控** | 2 | 1 | 5 |
| **Agentic 自主** | 5 | 3 | 3 |
| **工具扩展** | 4 | 3 | 5 |
| **上下文管理** | 5 | 3 | 3 |
| **安全隔离** | 4 | 3 | 5 |
| **成本透明** | 1 | 1 | 5 |
| **开源自由** | 1 | 5 | 5 |
| **多模态** | 1 | 5 | 1 |
| **Web 界面** | 1 | 1 | 5 |

### 6.2 适用场景矩阵

| 场景 | 推荐工具 | 原因 |
|------|:--------:|------|
| **个人日常开发** | Claude Code / Gemini CLI | 终端体验最佳 |
| **快速原型开发** | Gemini CLI | 响应速度快 |
| **复杂系统调试** | Claude Code | 深度推理分析 |
| **大型企业系统** | SaCode | 多平台+容器隔离 |
| **IM 客服系统** | SaCode | 10 个 IM 平台 |
| **多 AI 后端需求** | SaCode | 5 个 Provider |
| **成本敏感项目** | SaCode | 成本追踪+自托管 |
| **多模态内容创作** | Gemini CLI | Veo/Imagen 集成 |
| **团队协作开发** | Claude Code / SaCode | 双层记忆/智能路由 |
| **自动化运维** | SaCode | 定时任务+长任务管理 |

---

## 七、SaCode 功能完成度总览

| 模块 | 完成度 | 状态 | 关键待完善项 |
|------|:------:|:----:|-------------|
| Provider 抽象层 | 95% | ✅ | 高级流式控制 |
| 会话与路由 | 100% | ✅ | - |
| 缓存系统 | 100% | ✅ | - |
| MCP 协议 | 95% | ✅ | 权限审批集成 |
| 任务管理 | 95% | ✅ | 并行执行 |
| Capabilities | 95% | ✅ | - |
| IM 适配器 | 85% | ✅ | 消息收发细节 |
| 插件系统 | 85% | ✅ | 外部安装/热重载 |
| 安全管理 | 90% | ✅ | MCP 审批集成 |
| Web UI | 80% | ✅ | WebSocket 实时通信 |
| Gateway | 90% | ✅ | 远程控制 |
| 容器隔离 | 90% | ✅ | 默认沙箱 |
| CLI 工具 | 70% | ⚠️ | 终端体验优化 |
| 记忆系统 | 75% | ⚠️ | 双层记忆/SQLite 持久化 |
| Agentic 规划 | 80% | ⚠️ | 自动化任务分解 |
| Git 集成 | 70% | ⚠️ | 完整工作流 |
| Hook 系统 | 75% | ⚠️ | 事件类型扩展 |

---

## 八、优先级排序：SaCode 需弥补的功能差距

### 🔴 高优先级（核心体验差距）

| # | 功能 | 对标 | 工作量 | 收益 | 建议实现路径 |
|---|------|:----:|:------:|:----:|-------------|
| 1 | **Computer Use** | Claude | 大 | 极高 | 集成 Puppeteer 屏幕控制 |
| 2 | **Auto Mode** | Claude | 中 | 极高 | 安全操作分类器 |
| 3 | **CLI 终端体验优化** | 两者 | 中 | 高 | 改进 Commander.js 交互 |
| 4 | **并行代理** | Claude | 中 | 高 | 扩展 LongTaskManager |
| 5 | **上下文查看 (`/context`)** | Claude | 小 | 高 | Token 分布查看命令 |

### 🟡 中优先级（重要功能补充）

| # | 功能 | 对标 | 工作量 | 收益 | 建议实现路径 |
|---|------|:----:|:------:|:----:|-------------|
| 6 | **双层记忆机制** | Claude | 中 | 高 | 全局 + 项目级记忆 |
| 7 | **多层配置加载** | 两者 | 小 | 高 | 全局→项目→本地 |
| 8 | **多模态能力集成** | Gemini | 大 | 中 | 接入 Veo/Imagen API |
| 9 | **Web 搜索接地** | Gemini | 小 | 中 | 集成 Google Search API |
| 10 | **远程控制** | Claude | 中 | 高 | 扩展 Gateway |
| 11 | **上下文分叉** | Claude | 中 | 中 | 插件 fork 模式 |
| 12 | **Skills 热重载** | Claude | 小 | 中 | 文件监听 |
| 13 | **响应速度优化** | Gemini | 中 | 中 | 减少中间层延迟 |

### 🟢 低优先级（锦上添花）

| # | 功能 | 对标 | 工作量 | 收益 | 建议实现路径 |
|---|------|:----:|:------:|:----:|-------------|
| 14 | **云端执行** | Claude | 大 | 中 | 云基础设施 |
| 15 | **Cloud Auto-fix** | Claude | 中 | 中 | GitHub/GitLab API |
| 16 | **PR 审查功能** | Claude | 中 | 中 | MCP + Agent |
| 17 | **Bash 通配符权限** | Claude | 小 | 中 | SecurityManager 扩展 |
| 18 | **交互式可视化** | Claude | 小 | 低 | 前端图表库 |
| 19 | **自动记忆累积** | Claude | 小 | 中 | 会话结束提取 |

---

## 九、关键结论与战略定位

### 9.1 三者定位总结

```
Claude Code — "深度思考的架构师"
  └─ 适合：复杂系统、深度推理、架构设计

Gemini CLI — "快速行动的工程师"
  └─ 适合：快速迭代、原型开发、Google 生态

SaCode — "企业级多平台智能体"
  └─ 适合：企业集成、多 IM 平台、成本管控
```

### 9.2 SaCode 的战略优势

1. **不可替代性**：10 个 IM 平台 + 企业级管控是 Claude Code 和 Gemini CLI 都不具备的
2. **灵活性**：5 个 Provider 支持避免厂商锁定
3. **自主可控**：开源 + 自托管，数据安全有保障
4. **成本透明**：内置成本追踪，企业可精确核算 AI 使用成本

### 9.3 SaCode 需重点加强的方向

1. **Agentic 自主能力**（对标 Claude Code）
   - Computer Use、Auto Mode、并行代理

2. **终端体验**（对标两者）
   - CLI 交互优化、响应速度提升

3. **上下文与记忆管理**（对标 Claude Code）
   - 双层记忆、多层配置、上下文查看

4. **多模态能力**（对标 Gemini CLI）
   - 图片/视频生成能力集成

### 9.4 实施建议

**短期（1-2 周）**
- [ ] CLI 终端体验优化
- [ ] 上下文查看 (`/context`) 命令
- [ ] 多层配置加载器
- [ ] 双层记忆机制

**中期（1-2 月）**
- [ ] Auto Mode（自动/手动模式）
- [ ] 并行代理执行
- [ ] Web 搜索接地（Google Search API）
- [ ] Skills 热重载
- [ ] 远程控制（Gateway 扩展）

**长期（3-6 月）**
- [ ] Computer Use（屏幕控制）
- [ ] 多模态能力集成（Veo/Imagen）
- [ ] 云端执行基础设施
- [ ] 完整 Git 工作流自动化

---

## 十、一句话总结

> **Claude Code 擅长深度推理，Gemini CLI 擅长快速执行，SaCode 擅长企业级多平台集成——三者定位互补而非直接竞争。**

---

*报告生成完毕*
