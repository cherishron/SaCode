# 子智能体设置前端复刻与验收

## 上游依据与实现

冻结上游 deepseek-ai/deepseek-harness 提交 639ed015397290b3745d163aafe02ffee4aa3f84。核对 ui-settings-subagent 中的 SubagentCard.tsx、SubagentLimitsFields.tsx、subagent-limits-card-controller.ts、SubagentModelSelectionFields.tsx、subagent-model-selection-card-controller.ts 与 locales.ts。本地参考源码位于 D:\Temp\SaCode-official-639ed015；未恢复完整官方原生桌面视觉基线，因此本批不宣称像素级一致或完整桌面复刻完成。

实现位于 apps/desktop/renderer/pages/subagent-settings.ts，以构建期 TypeScript、Vue runtime h() 和经典脚本接入插件配置页。委派限制与模型授权分别持有修订号，共用保存页脚。最大递归层级允许 0，子智能体并发上限至少 1；拒绝负零、小数、非安全整数。空值按覆盖状态恢复默认。授权关闭保留精确提供方/模型路由，开启时至少选一个模型。模型目录延迟读取、失败可重试、部分失败提示，失效的已有选择可移除及撤销。外部修订变化保留草稿并阻止覆盖；外部已保存同值时清除冗余草稿。两域部分保存成功时只重试失败域。卸载释放订阅和草稿。

未添加官方账号登录、额度及账号提供方入口；普通模型提供方与模型授权功能保留。产品入口在无仓颉适配器时显示未接入状态，不显示伪造配置值。

## 自动化证据

隔离 Electron 环境 D:\Temp\SaCode-ui-scroll-20261004 使用当前页面源码、classic vendor 脚本及此前已构建的自包含 Host。子智能体交互使用内存适配器，不能替代仓颉服务验收。

- 四个页面模块的 TypeScript 严格检查通过，pack-pages 构建及运行时脚本约束检查通过。
- subagent-frame-partial.log 对应整页冒烟退出码 0，subagent-captures-partial/reports.json 共 104 组、337 条检查，失败 0。包含两个配置域部分保存失败及只重试剩余域。
- subagent-ui.log 对应现有 UI 冒烟退出码 0，200 条 UI OK，0 条 UI FAIL，UI_SMOKE PASS。
- 已查看 subagent-captures-final/subagent-fixture.png；这是测试适配器界面截图，不是官方原生视觉对比证据。
- 新增冒烟模块 node --check 和工作区 git diff --check 通过。

## 尚未完成

真实仓颉配置存储、提供方目录、模型授权、子智能体递归与并发执行尚未连接本页。完整插件安装管理页面及其他官方页面仍需继续复刻。未运行真实外部大模型验收，未重新生成和安装最终安装包；独立 npm CLI 与安装即用产品仍在完整交付范围内。
