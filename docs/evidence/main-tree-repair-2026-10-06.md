# 主工作区构建与模型页问题收尾（2026-10-06）

## 现场与范围

主仓 `D:/Project/sa/saai/sa-code`，本轮起点 HEAD `a6536e4`。工作区有多个工作流的未提交改动；本轮没有整体暂存或覆盖那些改动。完整 DSH 复刻、双入口和安装交付范围保持不变。

上轮隔离快照通过不代表主树通过。本轮从主树重新跑 vendor 与核心测试，处理真实问题，随后用主树源码、独立输出目录构建，防止多进程争用 `core/target/release/unittest_bin/core.exe`。

## 前端实际修复

1. `custom-models.ts` 探测复选框的子节点数组缺闭合括号，导致完整 vendor 构建退出 1；补闭合后可构建。
2. `provider-settings.ts`、`custom-models.ts` 的列表行和绑定行把 h() 辅助函数的 children/props 参数传反。真实 Vue runtime + Chromium 验收修复前出现 `Cannot destructure property 'type' ... as it is null`；修复后列表呈现。
3. 编辑/删除/排序/添加等按钮的 aria-label、disabled 传到错误位置，部分第五参数被忽略。统一为既有四参数 helper 的正确形状，保证只读状态禁用。
4. 供应商新增先设 adding 再调用 closeEdit，立即清掉新增状态。实际点击用例单独红灯「供应商新增表单打开 false」；改为先清旧草稿再设 adding 后通过。

新 `model-pages-render.test.mjs` + `model-pages-smoke.cjs` 在真实 Vue/Chromium 中检查 17 项列表、可访问编辑/删除入口、可写/只读、新增和编辑表单、无渲染异常。使用组件适配器夹具，不冒充产品 Host 接通。

既有模型中心纯函数测试的五条失败还包含测试自身问题：跨 VM 数组原型、VM 缺 URL、名字用例同时撞重复 ID、重复绑定断言写反，以及源码注释误命中本地存储扫描。修正输入/运行环境/断言后，四组页面与适配器回归 **27/27，rc=0**；实际 vendor 重建 rc=0，经典脚本安全检查保留。

初次核查时四页未进入产品；随后按用户指示改为设置唯一“模型中心”入口。最新接入与验收见 model-center-replacement-2026-10-06.md。

## 核心红灯与处理

- 首轮主树 test 无 Summary：`migration_pack_test.cj` 将 ProviderRecord 放入 MigrationProviderEntry 数组。修正为真正修改名称的 MigrationProviderEntry，保留摘要篡改反证。
- 随后整树：**TOTAL 702 / PASSED 692 / SKIPPED 2 / ERROR 5 / FAILED 3，rc=1**。错误和失败全部在 migration/plugin-store。
- 迁移供应商 JSON 多出 `{`；本轮移除两个多余字符。包序列化把 entries 对象塞进 providers 数组位置，另一个在途工作流随后修正，本轮未覆盖其修法。无效 JSON 用例错误地期望成功，改为明确 None。
- PluginStore 的 `@local/x` 目录映射带了额外的前导 `-`，与既定目录规则及安装/重装/孤儿检查不符。本轮去掉前导 @，保留作用域分隔符映射为 -。
- PluginStore 日志读取只检查 load()，漏掉尾帧截断。核心 SessionLog 有意允许前缀恢复，配置安装清单应严格拒绝；reload 和 commit 均增加 isTruncatedTail 拒绝，防止把损坏清单视作空清单或覆盖。

本次复验使用主树全部源码，输出 `D:/Temp/sacode-main-repair-target-20261006`；Host 输出 `D:/Temp/sacode-main-host-target-20261006`。该次最终仍为 TOTAL 702 / PASSED 692 / SKIPPED 2 / ERROR 5 / FAILED 3，rc=1，修复不能记为已验收完成；与并发修改/构建缓存之间的关系待查。不能用前端回归替代核心验收。

## 交付边界

本批源代码仍处于混合工作区，未整体提交。已编译独立 Host/CLI，并重新构建桌面包；未真实运行安装器，CLI 离线 npm 产物尚未重打。桌面全套首跑 240/242（增强 timeout、系统身份断言失败）；改为正常询问助手名称后，两条真模型专跑 2/2；全套串行 241/242，剩增强 timeout，不能记为真模型验收全绿。最新装包态 frame-smoke 759 检查 / 0 失败；完整产品仍未达到完成标准。
