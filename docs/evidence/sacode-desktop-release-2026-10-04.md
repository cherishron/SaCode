# SaCode 桌面本地验收构建（2026-10-04）

## 源码与构建

最终产物源码提交为 `bc71f97`，由 `git archive` 导出到 `dualtest/ui-bc71f97/source`。不包含工作区并行中的 SSE、Next SDK、provider 测试或上游核验文档改动。重新构建仓颉 Host、组装 89 个 exe/DLL 文件并生成 Vue/TinyVue/TinyRobot vendor，使用本地官方 Electron 33.4.11 dist 完成 NSIS 与 portable 构建，退出码 0。

相较 `fa265a4`，唯一运行代码增量为 UI 冒烟落盘报告：便携启动器未转发子程序 stdout，原启动器退出码不足以证明全部 UI 断言通过。`--ui-smoke --session-dir=<新的绝对目录>` 现在生成 `ui-smoke-report.json`，包含每条断言、总体通过标记、失败数、版本和发布态标记。报告不进入核心日志。

## 最终产物

目录：`dualtest/ui-bc71f97/source/apps/desktop/dist/electron/`。均为 Windows x64、版本 0.1.0、未签名的本地验收包。

| 文件 | 字节数 | SHA256 |
| --- | ---: | --- |
| SaCode Setup 0.1.0.exe | 80652191 | 479C6E01A4CD589E14ACEED368142C6439106D0836EEC9384E2890855CDDED8B |
| sacode-portable.exe | 80500178 | F33380990BBB816BE139AF64F30F1FE98DF845F959C73681E588F31D7AF2182B |

哈希、时间戳与签名状态记录在 `dualtest/ui-bc71f97/artifacts.json`，构建日志为 `build-installers.log`。

## 验收证据

| 范围 | 结果 | 证据 |
| --- | --- | --- |
| 干净源码桌面 Node 测试 | 84/84，退出码 0 | `dualtest/ui-bc71f97/desktop-tests.log` |
| 核心测试 | 138/138；在 fa265a4 导出源码运行，bc71f97 未改核心 | `dualtest/ui-fa265a4/core-tests.log` 与两提交差异仅 main.cjs |
| asar 与 Host/DLL 一致性 | 109 个文件逐字节匹配，包含完整 renderer、SaCode 图标和 MIT 授权文件 | `dualtest/ui-bc71f97/package-source-audit.json` |
| win-unpacked UI | 170 项通过、失败 0、发布态 true、退出码 0 | `unpacked-ui-session/ui-smoke-report.json`、`packaged-ui.log` |
| win-unpacked 布局 | 136 组/1016 项、失败 0、退出码 0 | `packaged-layout/layout-report.json`、`packaged-layout.log` |
| portable 启动器 UI | 170 项通过、失败 0、发布态 true、退出码 0 | `portable-ui-session/ui-smoke-report.json` |
| portable 启动器布局 | 136 组/1016 项、失败 0、退出码 0 | `portable-layout/layout-report.json` |

表内未带前缀的路径均位于 `dualtest/ui-bc71f97/`。portable 两套验收以及最终 win-unpacked 布局均将 PATH 限制为 Windows System32，移除 SDK 和项目工具路径；以真实启动器生成的结构报告核验，不能用空 stdout 或启动器退出码代替断言证据。

实际打开了最小窗口暗色流式 Markdown 截图，标题、列表与代码区保持会话内布局。另使用 Windows `ExtractAssociatedIcon` 提取 `win-unpacked/SaCode.exe` 的图标并打开 `executable-icon.png`，确认可执行文件使用原 SA 图标。产品名与文件描述均为 SaCode，版本为 0.1.0。

## 待完成范围

本机已有旧版 DSH Desktop 安装，本批未覆盖它；NSIS 实际安装与卸载尚待独立验收。Windows 公司元数据仍继承 Electron 的 `GitHub, Inc.`，发布配置需补齐该字段；不能据产品名已更正推断全部文件元数据已更正。

本批未重验 npm CLI，也未集成并行 SSE/Next SDK 改动。模型/凭证配置、自动化、完整 composer、上下文节点、代码高亮、附件、全页面基线及完整 DSH 复刻验收仍未完成。安装包包含当前已实现 UI，不代表完整桌面目标已经达成。
