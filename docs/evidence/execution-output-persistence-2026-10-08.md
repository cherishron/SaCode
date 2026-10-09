# 执行输出持久回放专项

日期 2026-10-08，基线 35a69ca9e0f8b7b6ac51271ec76eff3515eaa820，refactor/dsh-learning。对象为未提交工作区。新增 execution_output.cj、execution_output_test.cj，主责 E/W40 已登记；改动既有执行服务与监督适配器，未改 Host/CLI。

## 实际实现

输出使用 SessionLog 的 execution/output version=1，不建立另一份任务数据库。两流分别连续编号，512 字节块采用 base64，累计字节受提案限制；结束、EOF、截断独立记录。每次追加必须通过租约及持久屏障；失败取消本任务并冻结服务。读取按全局日志序号游标分页，初始 -1，页限 1–16，返回身份、状态修订和分页事实。坏序号、未知版本、坏编码、结束后追加及身份不符拒绝。

监督适配器在捕获完成后逐块持久化，再结算；不是实时输出。存在输出记录时，完整结算需要两流结束及真实 EOF；结算记录包含保留字节数与截断事实。缺 EOF 不允许冒充 outputComplete=true。旧无输出记录路径保留兼容，不据其布尔值推定新输出链成立。

## 证据

- 完整生产源码加选定测试隔离目录：apps/desktop/.tmp-test/execution-admission-source。133 份对应源码 SHA256 差集 0；清单 execution-output-source-manifest.json 的 SHA256 为 86972DA03DABE4767AF3942EC3B4DC260C5C887A9D932EB30C6F4A3438B9CCA6。
- 构建命令：隔离目录 cjpm test --no-run -i，退出码 0。首次编译发现 base64 解码返回 Option 及测试导入写法问题，均修复后重新编译；失败命令不计为通过。
- 测试命令：配置 stdx DLL 路径，在 target/release/unittest_bin 执行 core.exe --no-color --parallel=1 --no-progress，退出码 0。
- TOTAL 81 / PASSED 80 / SKIPPED 1 / ERROR 0 / FAILED 0。新增输出测试 4/4；1 条真实模型缺凭据仍跳过。
- 真实 cmd 双流输出使用默认 Windows durableCheckpoint，加载新 SessionLog 后逐页读回正文和两路 EOF；重载任务保持 exited，恢复不重跑。
- 其余测试覆盖坏序号、结束后追加、错误通道、持久失败冻结及取消、错误游标/执行身份、中文跨 512 字节边界还原、不完整捕获拒绝成功结算。单测中的注入 checkpoint 仅用于状态和故障探针；真实持久回放用默认屏障。
- 二进制 SHA256：8A64723CFFBA38555F3B3631E7C7E0C5B8452350E71A030DCAA0BE55BA783E77。
- 日志与退出码：apps/desktop/.tmp-test/execution-output-{build,test}.{log,exit.txt}。指定改动路径 git diff --check 通过。

## 尚未完成

这不是全核心、Host/CLI、页面、安装态或断电验收。真实监督探针仍显式注入 providerReady=true，默认门禁关闭；真实沙箱、完整进程树和跨重启进程身份验证尚未通过。下一步将共享服务接到有限 Host/IPC 和 CLI；先开放提案及观察，执行启动继续遵守能力门禁。实时输出和结构化测试报告分别实现，截断正文不能证明完整测试分母。本轮未提交、推送、安装或发布。
