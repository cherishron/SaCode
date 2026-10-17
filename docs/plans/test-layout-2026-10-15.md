# 测试目录整理（进行中）

用户要求：改功能前先整理测试，按所属模块和功能分类；测试源码可提交。此任务不自动提交，不触碰他人实现。

## 分类规则

- apps/desktop/test/<功能>：桌面组件、IPC、适配器测试；跨模块集成仍按驱动入口归属，不把借用HostBridge的Host协议测试误称桌面业务单测。
- apps/host/test/<功能>：Host协议集成；可借公共客户端测试工具，但不得复制生产实现。
- apps/cli/test/<功能>：CLI命令黑盒测试。
- apps/daemon/test/<功能>：服务接口黑盒测试。
- core：共享业务单测，仓颉包内测试布局需核cjpm发现和internal/protected可见性，未验证前不机械移动*_test.cj。
- 模块test/fixtures与test/support：可公开复现的合成夹具与测试工具。Electron打包内test-support目前由main与package清单引用，迁移必须同步核运行和打包，不只移动文件。
- scripts相关构建/分发测试归scripts的测试目录；extjs保持自身测试归属。
- 临时副本、研究仓库、二进制、日志、用户资料及探针输出统一留 `target/tmp/`（2026-10-16 起；旧 `apps/desktop/.tmp-test/` 已退役，见 [artifact-layout-and-retention-2026-10-16.md](artifact-layout-and-retention-2026-10-16.md)），禁止作为测试源码整体入库。纯净可复用探针后续抽取并加超时、脱敏、路径配置，再进入对应模块测试。

## 并发与现状

初盘将未提交修改误当成当前并发，判断不正确。用户于07:27明确当前只有本会话，按单会话继续整体整理；保留所有既有未提交实现，不因历史归属跳过整理。CLI原有test六份、Host两份。第一批六份适配器已完成，整体结构仍在整理。

## 第一批

apps/desktop/test/import：conversation-import、conversation-import-worker、import-handoff。
apps/desktop/test/scan：scan-report、scan-handoff。
apps/desktop/test/integration：adapter-integration。

仅改目录和require相对路径，不改断言或生产源码。迁移后六份测试定向运行60/60通过、0跳过、exit0。未运行完整桌面测试，不据此宣称所有递归发现和静态路径契约已通过。旧文档中的原路径是历史读数，不批量改写历史证据；当前运行命令以新路径为准。

## 第二批（已迁移）

13份ACP测试按实际归属迁移：desktop/test/acp六份（页面、IPC、诊断包），host/test/acp六份（Host协议与跨入口恢复），cli/test/acp一份（CLI配置命令）。保留现有HostBridge与合成夹具模块引用，不复制生产代码。桌面五份纯测试28/28通过；其余Host/CLI与诊断包测试TOTAL21，15通过、6个真实提供方用例显式跳过、0失败、exit0。本次用前阶段私有Host/CLI验证迁移，不是当前全部生产源码重建。未发送模型请求。

## 待续批次

1. 按模型、执行、会话、知识、工作树等功能继续批迁；修所有脚本和静态路径契约，核跨模块测试统一入口不漏掉新Host/CLI路径。
2. 知识与其余协议测试按被测入口判归属，不只凭文件名前缀机械分类。
3. 在私有最小仓颉项目确认tests/配置、包级可见性与cjpm发现后决定核心和原生入口测试实际布局，避免通过减少测试发现伪装整理成功。
4. 将长期可用假提供方/诊断工具从私有目录提炼为可提交测试支持源码，不提交历史运行输出和外部参考仓库。
