# 设置模型入口替换为模型中心（2026-10-06）

用户决定：用模型中心的功能替代设置中的模型。目标仓库为 D:/Project/sa/saai/sa-code，未修改当前 Rust 工作树。

## 实现

- 移除设置中旧“模型”分类，只留“模型中心”。修正不存在的 SaCodeClientSlots 全局引用，使用实际构建出的 SaCodeSlots。
- 四页通过独立 SlotCore 插件贡献注册，按供应商、自定义模型、费用统计、迁移切换；不把四页全部同时渲染，也不共享不兼容的同一适配器。
- 供应商页承接现有完整编辑组件，保留目录、自定义 API、手工模型、凭据配置和连接检查；模型选择继续使用同一核心注册表。
- 新 model-center-adapter.ts 把核心 custom/describe 的 models 映射成页面 customs；配置和修订号仍以 Host 为准。提交 Vue 草稿前转为纯数据，修复真实 IPC 的 “An object could not be cloned”。
- 费用页使用 usage/status 实际用量及核心模型限额/绑定费率；不补造分类历史金额。迁移导入调用既有 Host 动词，摘要导出明确不能恢复配置。
- 修正费用/迁移表格及删除对话框的 h() 参数顺序；保持唯一 Vue runtime 和静态 CSP 产物。
- 主进程 require 的 customs-guard.cjs 原先漏在安装包文件清单之外，已补入，并增加启动依赖清单回归。

## 验收

- 页面、模型中心槽位、模型及自定义模型有限 IPC 回归：18/18，rc=0；启动依赖清单回归 1/1，rc=0。
- 开发态真实 Host 整页：262 组 / 759 检查 / 0 失败，rc=0。目录：D:/Temp/sacode-main-frame-20261006-1791248383457。
- 装包态 win-unpacked 整页：同为 262 组 / 759 检查 / 0 失败，rc=0。目录：D:/Temp/sacode-model-center-packaged-1791248511052。没有设置 SACODE_HOST，PATH 剔除仓颉 SDK/stdx，从包内 resources/host/bin 启动宿主；SSE 测试夹具仍用本机 Node/OpenSSL，不把这项当作无辅助软件的真实安装验收。
- 新增产品断言：唯一设置入口、四页切换、真实 UI 创建自定义模型并从 Host 回读、费用页真实限额、迁移页真实模型与摘要说明。原供应商 UI 写入/密钥不回显断言继续通过。
- app.asar：126 条目，node_modules 0；含模型中心装配、适配器和新入口，旧并列入口不存在。
- 独立打包 Host 与 win-unpacked Host SHA256 均为 8a6c4ee88ee033ae8c4204b9b32a4b44ca8359c4f61c52763716603309411169。

## 保留的红灯和边界

- 本轮开发态首次保存失败（Vue 代理跨 IPC），修复后通过；此前包清单漏校验模块导致装包启动异常，补齐后通过。失败日志保留，不记为抖动。
- 分类历史费用、完整可恢复配置迁移包、全部 DSH 前端与插件市场仍未验收完成。
- 整树核心仍为 702 / 692 通过 / 2 跳过 / 5 ERROR / 3 FAILED；桌面整套串行 241/242，真模型增强 timeout。相关问题不因本页验收转绿而关闭。
- 未实际安装/卸载 NSIS，未签名、发布 npm。现有用户安装目录仍可能运行旧版本。
- 本批混合工作区不整体暂存；没有把并发会话改动打包成一个提交。

## 最终桌面产物

electron-builder 最终 rc=0，输出 D:/Temp/SaCode-main-package-20261006，未启动安装器：

| 文件 | 字节 | SHA256 |
| --- | ---: | --- |
| SaCode Setup 0.1.0.exe | 146646635 | 5e843a07784b145c03157d66a82e5c41e65cfa24019962cca1f9b430e374ed82 |
| sacode-portable.exe | 146494603 | 30c5a2a83fe88e44aaaa7c9d796e8686c3c4a9f6f45a8c3418849bacf45e0e70 |

从 NSIS 中解出 app-64.7z 后再解出内容，Installer 内 Host 与独立打包 Host、win-unpacked Host 的三份 SHA256 一致（8a6c4ee8…）。Installer 内 app.asar 与已跑 759/0 的 win-unpacked app.asar 均为 ddf797600430fbe8c9d7b338ea3d66a33521fd0c751a9a41d8078d9416112451。提取目录 D:/Temp/SaCode-model-center-installer-check-20261006；不是实际安装证明。

main/preload/customs-guard、app.js、styles/index 和 client-slots 产物共七个关键文件在当前源码与 app.asar 中逐一同哈希，明细 D:/Temp/sacode-model-center-artifact-hashes.json。包与用户现有安装目录分开，不自动更新已安装版本。
