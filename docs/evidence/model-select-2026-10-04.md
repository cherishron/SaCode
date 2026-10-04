# 会话模型选择首轮复刻

## 上游依据与实现

冻结上游 deepseek-ai/deepseek-harness 提交 639ed015397290b3745d163aafe02ffee4aa3f84。核对 ui-model-selection 的 ModelSelect.tsx、ModelSelect.module.css、directory.ts、catalog.ts 与 locales.ts，以及 ui-primitives/src/rank-by-name.ts；参考源码位于 D:\Temp\SaCode-official-639ed015。

发送区新增 Vue runtime h() 模型选择座位；TypeScript 在构建期编译为经典脚本。模型菜单与推理等级菜单分为两层。模型按目录提供方分组，超过四个模型显示搜索；有序子序列搜索直接移植冻结上游 MIT 排序，大小写不敏感、前缀优先并保留稳定排序。许可见 renderer/assets/dsh-ui-LICENSE.txt。

模型选择显示状态只派生自会话共享 Directory，两个入口可订阅同一目录；后端确认前保留原模型，不将界面点击视为已保存。推理等级与默认值来自精确模型的 reasoning 元数据，不写死等级。不支持推理等级的模型不提交编造的等级参数。已保存模型离开目录时保留模型标识与推理说明。目录失败可重新加载，部分提供方失败不隐藏其余模型。选择失败显示发送区临时提示；截图核对发现普通提示被原生顶层菜单遮挡，已改为顶层提示浮层。

搜索中方向键改变高亮并保留输入焦点，Enter/Tab 可提交高亮模型；输入法确认不提交。小目录及推理菜单可用方向键移动焦点。Escape/Shift+Tab 先返回根菜单，再关闭；返回根菜单聚焦进入子菜单的原入口。待确认期间禁用选项；卸载清理目录订阅、浮层、计时器、观察器与全局监听。官方账号目录入口不展示，产品文案使用 SaCode。

## 验证与限制

隔离 Electron 环境 D:\Temp\SaCode-ui-scroll-20261004 使用当前前端与此前已构建的 Host；模型选择使用测试共享目录，不证明真实仓颉模型选择持久化。

- 六个页面模块 pack-pages 构建与经典脚本约束通过。
- model-select.ts、rank-by-name.ts TypeScript 严格检查通过。首次检查发现只读数组类型与 NodeList 迭代库约束，已修正后复验通过。
- model-select-ui.log 退出码 0，200 条 UI OK，0 条 UI FAIL，UI_SMOKE PASS。该回归在最后的焦点与顶层提示修正前执行。
- model-select-captures-toast/reports.json 已生成，163 组、480 条断言，失败 0；model-select-frame-toast.log 包含全部交互通过记录。本记录写入时统一终端会话 1344 尚未返回最终退出码，不能将报告生成宣称为测试进程完整退出通过；后续须继续核对该会话。
- 已查看最终 model-select-captures-toast/model-select-fixture.png，选择失败提示可见；截图为测试目录，不是官方原生视觉一致证据。

本批是前端首轮实现。产品无 Directory 时禁用入口并明确接口未接入。真实仓颉目录、会话选型日志与投影、模型调用仍需接入；共享 /model 命令入口、完整待确认标记、提供方排序及粘性标题视觉细节需继续核对。完整前端、后端、真实 StepFun 测试、npm CLI 与安装即用产品仍未完成，未重新生成最终安装包。
