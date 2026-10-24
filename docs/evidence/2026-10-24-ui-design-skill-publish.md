# 2026-10-24 ui-design Skill 创建与 SkillHub 发布

## 范围与身份

用户明确要求制作并发布 Skill，随后指定名称为 `ui-design`，不绑定 SaCode。源码目录 `.agents/skills/ui-design/`，版本 1.0.0，许可证 MulanPSL-2.0，沿用仓库许可。执行平台 Windows/PowerShell；仓库 HEAD `a0b16c38a1147708f2ef75302695092f3d3ed833`，大量既有未提交改动，本轮不提交、不推送，不改桌面候选及任何 F 域完成状态。

## 发布文件

仅四个文件：SKILL.md、LICENSE.txt、references/design-principles.md、references/verification.md。核心流程为读取项目规范与令牌、区分方案/实现/只读审查、最小改动、主题/组件状态/无障碍检查、分层验证与如实汇报。无运行脚本、凭据、项目源码、截图、日志或运行依赖。不默认联网读取参考集合，不附上游品牌正文或素材。

## 验证及边界

- `node --test scripts/test/skills/ui-design.test.mjs`：5/5 通过，0 失败/跳过。仅验证元数据、内部资源、关键约束文字和四文件白名单，不证明模型实际遵循或 GUI 验收。
- skill-authoring 的 `validate_skill.py --skill-path .agents/skills/ui-design`：PASS，0 warning/0 fail。
- 独立只读审查六类输入/边界：截图方案、只读、令牌复用、Web/ESM 区分、GUI 阻塞、表单提交失败。发现低严重度“先读资料”范围歧义，已增加用户授权与资料可用范围限定。主执行者定点复核关键条款及修正。
- 未执行真实模型行为测评、GUI、项目构建、安装态验收，不宣称视觉合规或产品交付。

## 官方发布过程

官方教程：https://skillhub.cn/tutorials#publish-via-cli ，Agent 发布说明：https://skillhub.cn/ai/release.md 。本机已有 CLI 2026.8.5 和登录态。`skillhub.ps1` 本身仅输出命令文本，故直接由 Python 调用其指向的 `skills_store_cli.py`，未改启动器或登录配置，未输出/接触完整 API Key。

1. 官方 `publish ... --dry-run --json` 通过。
2. 首次正式请求返回 HTTP 400：`不允许的文件类型: LICENSE`。未记成功；改文件名为 LICENSE.txt 并更新结构测试。
3. 重跑测试、静态校验和 dry-run 后，再次正式发布成功。

最终命令语义：`skillhub publish .agents/skills/ui-design --host https://api.skillhub.cn --changelog "首次发布：项目规范与令牌驱动的 UI 设计、实现和只读审查流程" --json`。

平台回执（不含凭据）：

- ok：true
- slug：ui-design
- version：1.0.0
- skillId：291748
- versionId：456941
- fileCount：4
- reviewStatus：pending
- contentAuditStatus：pending
- securityScanStatus：pending
- fingerprint：325a50a4b8ed0855843619e1b887f9f8eb381b7d3c744969ba4e0f919177a1be

**结论：提交成功、待平台审核；不是审核通过或已公开上架。**

详情入口：https://skillhub.cn/skills/ui-design 。抓取该地址仅返回通用页面壳，未取得公开详情正文，不能据此宣称已可公开访问或安装。用户可到 https://skillhub.cn/dashboard 查看“我的 Skill”中的审核结果。审核失败或 slug/详情路由有变化时以平台后台为准，不盲目重复发布。
