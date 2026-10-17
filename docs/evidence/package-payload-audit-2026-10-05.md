# 安装包载荷与双入口复核（2026-10-05）

本轮以用户提供的验收记录为起点。完整产品仍未达到；历史装包态两次失败不能用本轮成功重写为从未失败。

## 产物定位与对账

- 用户记录的 86,969,799 字节、0ab472bd 前缀对应 apps/desktop/dist/electron-att/SaCode Setup 0.1.0.exe，而不是 electron 或 electron-queue 下的同名包。
- 安装器 SHA-256：0ab472bd29a9d279efe1e497476aabc95c85b56a8b317b417e81549187c72561。
- 源 dist/host/bin、electron-att/win-unpacked、安装器解出资源内宿主同为 bec9f0e8d8d3ba383552958c45da44233584e6b0cb75066e72d7c19fae5532c7，三方宿主对账完成。
- 安装器内 app.asar 为 c43e7f1f52ab75363fbfbc3080a5bb3a0e36d07f528a1e22efdf6e27a83bb464。验收期间当前 win-unpacked 的 app.asar 变为 65f9579c980904befd723b55a0555b1fffc0e9c2eaf7a4f587510ffdc06f05df，不能再宣称二者整包字节相同。
- 对两个 asar 的全部 5544 个文件项比对，差异仅 frame-smoke.cjs 与新增 test-support/frame-diagnostics.cjs；业务文件一致。此结果只针对该次读取快照。

## 装包态复验及诊断改进

- 原 electron-att/win-unpacked 首轮：247 组 / 710 检查 / 0 失败，真实进程退出码 0。未增加超时或放宽断言；设置 SACODE_SSE_FIXTURE 指向原仓库夹具，以及本机 SSE_OPENSSL。
- 从原安装器完整解出应用载荷、直接运行 SaCode.exe：247 组 / 710 检查 / 0 失败，真实进程退出码 0，installer.stdout.log。没有运行安装器，没有替换其载荷中的脚本。
- 独立诊断副本：247 组 / 710 检查 / 0 失败，真实进程退出码 0。宿主与业务代码不变，仅加入诊断脚本；这不能替代安装器原载荷结论。
- 新增等待超时取证：保存探针、宿主 PID/退出码/在途请求数、发送忙状态、消息数、滚动几何、折叠状态及截图；每个已完成检查立即保存 reports.json，异常中断仍有部分报告。
- 诊断工具测试 2/2，通过 renderer/capture 同时失败时仍保留 JSON 报告。原有整页等待时限和业务断言保持原值。
- stderr 的 model-not-configured 属测试故意验证缺配置拒绝；没有将它算成通过的真实模型配置。
- 前两次发送/滚动失败在上述复跑中未重现，根因仍未确定，尚不能关为已修复或归因于机器忙。增加诊断是为了后续失败能定位。

## CLI 最新核心离线包

- 重新 cjpm build 与 pack-cli，初次缺 MinGW DLL 而失败；把本机 Git mingw64/bin 加入构建 PATH 后打包成功。
- 离线 tarball：主包 @stand-alone/sacode 0.2.0，1375 字节；Windows 平台包 0.1.0，11237198 字节。尚未发布，版本与旧内部 bin dsh 命名仍未收口。
- 离线安装到 D:/Temp/SaCode-package-audit-20261005/cli-install，移除 SDK 与 Git PATH，只保留 Node 与 Windows；cjc 不可见。
- 八个入口均 rc=0、无以 FAIL 开头的失败断言：all 100、stream 21、tool 11、ext 8、cancel 9、extjs 12、headless 36、att 23。ALL PASS 汇总行不计入断言数；fail-closed 文案不是 FAIL。
- 构建 CLI 与离线安装的 dsh.exe SHA-256 同为 9ae5b9177ddde6498435cdbf6564af766dd84fc795ea5f32d7f17855aca28b97。

## 仍未完成

安装器尚未真实安装/卸载；从安装器解出并运行应用不等同安装验收。未改签名设置或签名。前端空壳、上下文投影、排队附件卡片与历史附件展示、vision 能力门控、统一 Todo 工具注册及命名收口仍按原矩阵待办，不因局部验收改为完整交付。

原始报告与日志：D:/Temp/SaCode-package-audit-20261005（hashes.json、asar-diff.json、original/diagnostic/installer 日志、CLI 每入口日志）。该证据引用当前工作树及原安装器载荷，没有断言仅提交版本的全量新构建已验证。
