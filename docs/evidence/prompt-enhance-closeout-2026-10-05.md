# 提示词增强与回退：复审收尾（2026-10-05）

本记录只验收用户草稿增强与回退，不代表持续目标、插件架构或整个 SaCode 产品完成。原实现与历史证据见 [首次记录](prompt-enhance-2026-10-05.md)。

## 审核结论与修复

原功能已真实接通，但不能直接按旧证据收口。本轮修复：

- 程序直接修改 textarea.value 未把增强作为原生可撤销编辑。改为 Chromium 编辑事务；用户继续输入后，真实 Ctrl+Z 先撤销新输入，再撤销增强；按钮回退也消费原生撤销记录。旧测试仅判断合成 keydown 是否被接管，本轮补充真实输入和键盘结果断言。
- 用量仅在 prompt/poll 结算，下一次增强、切会话或退出可能丢掉已完成回执。新增仓颉 EnhanceCharge：起跑时绑定原会话日志、计量器与租约，在后续协议请求和正常退出时结算，重复结算不重复入账；切换后不记入新会话。旧宿主上新增“不轮询切会话”用例红灯，实际 0 !== 22；修复后通过。
- 截断、工具违规、空结果、取消等路径原先会丢掉已收到的用量。核心在 finally 保存已知用量；拒绝采用文本与结算费用分别处理。不推测提供商未返回的费用。
- 发送或入队成功后的草稿清空现在推进编辑修订并作废增强状态，迟到结果不能把已发送的草稿重新填回来。
- 真模型测试改为登记凭据、注册供应商、设置所选模型；环境兜底故意指向不可用地址及错误模型，成功才能证明实际使用注册表选项。

## 实测

构建基点为 `d54a967`，在 `D:/Temp/SaCode-enhance-closeout-20261005` 隔离源码叠加本功能补丁。未编入主工作树未完成的 model_tool_runtime/agent/model_agent 改动或本轮目标栏。增强错误文案及其界面断言一并保留。凭据未写入报告或源码。

| 验证 | 结果 | 本机日志 |
| --- | --- | --- |
| 隔离 core cjpm test | TOTAL 512 / PASSED 511 / SKIPPED 1 / FAILED 0 / ERROR 0，rc=0 | D:/Temp/sacode-enhance-core-closeout-green.log |
| 隔离 Host cjpm build | success，rc=0 | D:/Temp/sacode-enhance-host-closeout.log |
| 增强协议、IPC、任务入口专项 | 10/10，通过 | D:/Temp/sacode-enhance-protocol-green.log |
| Chromium 独立真实撤销顺序 | 4 checks PASS | D:/Temp/sacode-native-undo-20261005.log |
| 完整开发态窗口 | 246/246，0 失败 | D:/Temp/sacode-enhance-closeout-ui/ui-smoke-report.json |
| 新包 win-unpacked 完整窗口 | 246/246，0 失败，实际子进程 rc=0 | D:/Temp/sacode-enhance-packaged-ui-final/ui-smoke-report.json；D:/Temp/sacode-enhance-packaged-ui-final.exit.json |
| 新包宿主 + 注册表所选 StepFun step-5-preview | 1/1 PASS，0 skipped，rc=0 | D:/Temp/sacode-enhance-selected-model-real.log |
| electron-builder 本地官方 Electron | rc=0 | D:/Temp/sacode-enhance-package.log |

打包态第一次测试缺少外置 SSE 夹具路径，实际 rc=1、未生成汇总，不能记作通过；补齐 SACODE_SSE_FIXTURE 后在全新会话运行上表最终结果。

## 交付

新产物位于 `apps/desktop/dist/electron-enhance-closeout-20261005/`，没有覆盖旧 `dist/electron/` 中的同名安装包。

| 文件 | 大小 | SHA256 |
| --- | --- | --- |
| SaCode Setup 0.1.0.exe | 83014363 B | 9a8cce66539820217b02457b1814bdf7f70fb3a534e180e4ab78da079bd38310 |
| sacode-portable.exe | 82862333 B | 34a7fc9097a958ed2ad4d6f3f8b7a34cadc2bb4220e4041e75f108d01f982dc3 |

源打包宿主、win-unpacked 宿主、NSIS `$PLUGINSDIR/app-64.7z` 抽出的宿主，完整 SHA256 均为 `f57a4c53221dd60a0f55174397d5ad9b274ccbd1e7b42c3867a76a7c1e47353c`。NSIS 内的 app.asar 已实读：包含 composer-edit.js、对应脚本引用、增强应用与回退调用、真实 Ctrl+Z 断言。开发目录 dist/host/bin 也已同步这份验证后的宿主。

界面验证使用完整 Electron 页面 → preload → 主进程 → 仓颉 Host，覆盖直接应用、按钮回退、真实 Ctrl+Z 顺序、编辑后恢复增强入口、失败、取消、编辑再改回、切会话、无工具请求、不新增消息、用量。没有以纯前端桩代替后端接通。

**边界**：已验证安装包载荷及包内解包程序；未执行真实安装/卸载，也未执行 portable 自解压入口。原签名配置保持未签名。源码补丁在独立收尾分支保存，主工作树保留并发改动；未将整个并发工作区记作通过。
