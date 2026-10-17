# SaCode 前三阶段稳定快照复验

日期：2026-10-08。提交基线：35a69ca9e0f8b7b6ac51271ec76eff3515eaa820，分支 refactor/dsh-learning。对象是未提交工作区的独立复制快照，不是该提交的完整产品。

## 本轮变更

- 新需求表和接口表各保留 F01–F20 共 20 行（合计 40 行）；这只证明需求覆盖，不能替代逐域业务验收。
- 纠正 P4 的“未开始”状态为“实施中”：GoalClaim、ExecutionService、durableCheckpoint 已有工作区实现，但 Host/CLI 尚未接线。
- 接口表明确 execution/state version=1 已实现与拟议 RPC/CLI 的区别；不沿用旧拟议事件表描述实际日志。

## 原型取证

将 prototype 顶层文件、package.json 与 slot-core.ts 复制到 apps/desktop/.tmp-test/phase123-20261008/desktop。构建依赖通过 node_modules 目录联接读取现有开发依赖；不复制或替换产品入口。构建后的页面在快照内运行，证据写入同一私有目录的 evidence。

- 命令：node apps/desktop/.tmp-test/phase123-20261008/desktop/prototype/build.mjs。
- 结果：PROTOTYPE_BUILD_PASS，退出码 0；构建脚本包含 eval/new Function/import() 反证。
- 验证：设置 SACODE_ELECTRON_TEST_EXE=D:/Temp/SaCode-window-test-runtime-20261006/SaCode.exe，SACODE_PROTOTYPE_EVIDENCE 指向快照 evidence，再执行快照 prototype/verify.mjs。
- 结果：PROTOTYPE_PASS 602 checks / 0 failed；evidence/exit-code.txt 为 0。包含亮暗、窄窗、键盘与竞态检查；截图、checks.json 和 smoke.log 均位于快照 evidence。
- 快照顶层文件在构建前记录 SHA256，复验后重算差集为 0；清单 source-manifest.json 的 SHA256 为 C9CC7A0B439F6480C18226876F89B91D1807E61884ED86E37EACC8C2E026DFEA。依赖版本未独立冻结，不能宣称跨机器可复现。
- git diff --check 未发现空白错误；出现现有文件的行尾提示，没有执行格式化或行尾迁移。

## 判定与下一步

原型在本次稳定复制快照上通过行为复验，解决此前直接验证移动源码的证据边界；本轮没有新的截图目视审查，不宣称既有视觉待修项全部关闭。仍非真实 Host、CLI、模型或安装态证据。

下一步实施真实执行监督层，补 starting 停止竞态、退出和输出事实，再接 ExecutionService 的 Host/CLI 与有限桌面 IPC。沙箱及监督探针通过前不开放可执行页面入口。GoalRunner 产品跨轮接线和统一产物重建仍未完成。本轮未提交、推送、安装或发布。
