# SaCode 可行性评估报告（四维评估）

> 更新时间：2026-08-18
> 依据：本报告为《SaCode 改进规划方案》（`docs/report-plan.md`）的依据文件。
> 结论摘要：技术能力不输第二梯队，但界面覆盖（IDE 缺失）、首次体验门槛过高、定位模糊、部分过度设计是当前主要问题。

---

## 一、评估结论

一句话战略：**停止平台化能力的深度投入（ACP/LSP/Daemon 扩展），把所有资源集中到三个最高 ROI 的事上——IDE 插件、国内 provider 零配置接入、首次使用体验优化。先让用户能用起来，再谈差异化。**

核心叙事：**"Claude Code 的体验，国内模型原生适配，企业级可审计。"**

---

## 二、四维评估

### 维度一：界面覆盖与竞争差距

- **现状**：仅覆盖终端（CLI/TUI/REPL），无 IDE 插件（VSCode 缺失），与第二梯队（Claude Code、Codex CLI 等）存在界面覆盖差距。
- **结论**：界面覆盖严重不足，是用户基数扩张的最大瓶颈。
- **调整建议**：立即补齐 VSCode 扩展（最简调用 `sacode serve`，复用现有 HTTP/SSE 端点）。

### 维度二：规则与约束的必要性审查

- **保留并强化 3 项核心机制**：
  1. 三级执行模式（plan/build/yolo）—— 比 Claude Code 的 plan/execute 两级更细，是真差异化
  2. 沙箱审计（audit.log）—— 企业决策因子
  3. checkpoint 恢复 —— 长任务可暂停/恢复/取消
- **砍掉/降级 3 项过度设计**：
  1. Loop 四层自治架构 → 轻量 `/goal`
  2. 知识系统 9 文件分类 → 3 文件（project.md / experience.md / preferences.md）
  3. 五维冲突检测 → 审批 + 拦截（保留 `validation_conflict` 主路径）
- **其他调整**：AutoLearner 的 BM25/衰减延后；`yolo` 命名调整；media.vision/video 优先级降级（延后）。

### 维度三：整体方向是否跑偏

- **问题**：定位模糊（工具 vs 平台双线推进）、目标用户画像不清（国内定位未声明）、与竞品同质化。
- **调整**：
  1. 明确定位为"面向国内开发者的终端 AI 编程工具"
  2. 在 PRD 显式声明国内市场定位
  3. 平台化收敛：ACP/LSP/Daemon 维持现状不新增
  4. Loop 自治方向收敛，资源集中到 IDE 插件与体验优化

### 维度四：首次体验与使用场景

- **首次体验断裂**：首次配置需 4 步（/login→Base URL→API Key→/models→选择），门槛过高。
- **命令体系过载**：40+ 子命令 + 20+ TUI 命令，收敛为 5 个一级命令 + 按需发现的二级命令。
- **TUI 信息密度不足**：工具调用无状态/耗时/输出摘要，footer 无模式名，审批无弹窗。
- **场景覆盖不完整**：CI/CD 集成、代码审查、远程开发、测试编写 4 个空白场景。

---

## 三、目标量化

- 首次配置步骤：4 步 → 2 步（选择 provider → 输入 Key）
- 界面覆盖：1 类（终端）→ 2 类（+ VSCode 插件）
- 命令体系：40+ 子命令 → 5 个一级命令
- 内置 provider 预设：DeepSeek、通义千问、智谱 GLM、OpenAI、自定义

---

## 四、实施路径

详见 [`docs/report-plan.md`](./report-plan.md)（12 周 / 8 步骤）与 [`docs/plans/improvement-execution-plan.md`](./plans/improvement-execution-plan.md)（文件级细化）。
