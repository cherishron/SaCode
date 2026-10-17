# Windows 执行内部组件提交候选复验（2026-10-17）

## 范围与快照

基线 HEAD：21e35299fd0a115c6b94000aa0da9e737e9dcd0a。用户本轮授权整理已完成工作、提交并推送。
通过精确 blob 暂存，导出 target/tmp/commit-candidate-20261017 独立候选。候选不含 windows_tree、windows_workspace_snapshot 与其六项新测试，也不包含其他会话的模型中心、构建钩子、Host 能力表和 daemon 改动。保留工作区原文件，不回滚或清理他方内容。

## 当前候选实测

- 在导出候选 core 下加载本机修复后的仓颉 1.1.3，执行 cjpm build --target-dir D:/Project/sa/saai/sa-code/target/tmp/commit-candidate-build-20261017：rc=0，24 条警告。第一次缺少候选 .deps/stdx 的构建 rc=1；复制既有编译依赖后再次构建成功，未安装或改系统配置。
- node scripts/build-windows-process.mjs --verify：rc=0，35 checks、failed=0、cleanup=confirmed。
- node scripts/verify-windows-workspace.mjs：rc=0，47 checks、failed=0、cleanup=confirmed。
- scripts/verify-windows-process-adapter.ps1 使用该候选冷编译 release 与该候选 DLL：实际退出 0，最后 Summary TOTAL=16/PASSED=16/SKIPPED=0/ERROR=0/FAILED=0。
- git diff --cached --check 与候选 JS 语法检查通过；暂存差异私钥标记和常见凭据模式扫描均为零命中，不代替人工审阅。

日志：target/tmp/commit-candidate-build-20261017.log；候选 target/tmp/commit-native-process.log、commit-native-workspace.log、commit-adapter.log。完整指纹见候选 target/tmp/windows-adapter-20261017-4dcfcd653900413682d6dadf2d2ee02c/verification.json。
运行库 SHA256：8B1D0783E10EC18191AF900AC3DA632006037D0A61E0518C4AB005C3F5F8C9C2，为本机修正运行库，不宣称官方修复或其他平台通过。

## 未提交与失败边界

工作区最新 22 项测试为 21 通过、1 失败（windowsCollectorPreservesCallbacksExitAndBoundedOutput），另有监督线程 execution-provider-failed 异常诊断；不是候选 16 项结果。快照新增及其依赖保留未提交，后续继续定位，不把该次运行称为全绿。
工作区产物守卫实际 rc=1，13 checks / fail=6：outputs/、core/core/、apps/cli、apps/daemon、apps/host、apps/desktop 一级落点失败。未提交这些目录、未删除或移动未知归属内容。
本批仅收口内部进程提供接口、结果转换、共享监督与私有目录生命周期。Host/CLI 默认执行门禁仍关闭，快照、F08 合入、网络/逃逸反向验证、安装及完整产品任务均未完成。
