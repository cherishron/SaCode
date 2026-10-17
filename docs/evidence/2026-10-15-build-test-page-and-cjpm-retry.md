# F09 构建测试页面接线与 Cangjie 1.1.3 重试记录

日期：2026-10-15
仓库：D:/Project/sa/saai/sa-code
分支：refactor/dsh-learning
HEAD：4b42b5268635a1b30a910214c98dcb139d6a0ec9
本记录覆盖未提交的局部前端变更，不代表整个工作区干净或整仓验收通过。

## 构建测试页面接线

- apps/desktop/renderer/pages/workbench-tabs.ts 将 tests 资源开放。
- 新增 BuildTestPage，由 app.js 装配到独立右侧标签，并复用既有 ExecutionTask、任务审批、启动/取消、历史列表及分页输出 IPC。
- build-test-report.mjs 识别仓颉 TOTAL/PASSED/SKIPPED/ERROR/FAILED 与 Node TAP 摘要。报告只有在任务退出事实有效、退出码为 0、进程成功、摘要唯一且计数一致、有实际通过用例、outputComplete 为真、stdout/stderr 均观察到 EOF 且没有截断时才标记通过。
- 当前实现只证明页面和本地判定逻辑已接线；没有真实 Host 构建、命令执行或桌面端到端验收。

相关源码 SHA-256：

| 文件 | SHA-256 |
|---|---|
| apps/desktop/renderer/app.js | C1BAD738D80EA3F7B1F7689B9385A45A3F856F0029B883588A909597CC3C4E85 |
| apps/desktop/renderer/pages/client-slots.ts | D099C3721016E0BB593BEB4347B40472628F29732FBCF743B3620A3E8FF57607 |
| apps/desktop/renderer/pages/execution-task.ts | B1D1BEC41196D4C168D8DA9B6E5E9987B26CC657BFD2A7278419145393CD3817 |
| apps/desktop/renderer/pages/workbench-tabs.ts | 07A2347B865F3AD5B547D7D9770BF178F7725116F648E57A331DFB48B899FF64 |
| apps/desktop/renderer/pages/build-test-page.ts | DD8B40D4D9C843B114E3FFD877EFBF27F75119FD9097C00EA19A1BD94C8C82B8 |
| apps/desktop/renderer/pages/build-test-report.mjs | F65F3565264F3A216CF52B912DF09C39D4B6ED57C64EDD556933AD86E60172BF |
| apps/desktop/test/build-test-report.test.mjs | 4ABE7F9DE7269A129096C9B6779E2C8F17425552476A5D131CE98219C540FFC3 |
| apps/desktop/renderer/pages/review-page.ts | 910D25FCC7E7CD34046B77C437CA8332F09F126D7D4ABAB8F8E75EF426808FC8 |
| apps/desktop/test/review-page.test.mjs | 116556D8B3F395FE6CC10B740A5039368F085B804F1ABECE187C8FB2B34D9052 |
| apps/desktop/renderer/vendor/client-slots.iife.js (本地忽略产物) | 73890F2A1FBF18CE3ECE19500209AB674DFDEA4E009EAD6A9030A58B47AFDD10 |
## 验证

以下命令均在当前未提交源码上运行，位于 apps/desktop：

- node --check renderer/app.js：退出码 0。
- node --test test/build-test-report.test.mjs test/execution-history.test.mjs test/execution-history-ipc.test.mjs test/execution-ipc.test.mjs：退出码 0，17/17 通过。
- node ..\..\scripts\pack-pages.mjs：退出码 0；处理 client-slots.ts 及页面 bundle，无构建错误。

这些测试覆盖报告解析、退出事实与执行历史/IPC 的局部契约，不等价于真实 Host 执行。

## Cangjie 1.1.3 工具链复验

SDK 路径：D:/Program Files/HuaWei/Cangjie。使用其 envsetup.ps1 设置当前进程的 CANGJIE_HOME 与 PATH；没有改系统/用户环境变量。

- cjc -v：退出码 0；Cangjie Compiler: 1.1.3 (cjnative)，target x86_64-w64-mingw32。
- 复验前普通用户进程枚举没有可见 cjpm/cjc 进程。
- 通过 Node spawn 启动 tools/bin/cjpm.exe --version，stdio 为 ignore/pipe/pipe，运行于独立临时工作目录：退出码 3221225477（0xC0000005），stdout/stderr 为空；不是等待 stdin 的超时。
- 使用当前 core 源码执行 cjpm build --no-progress --target-dir <unique-temp>，并将 TEMP、TMP、target 均指向独立临时目录：退出码 3221225477（0xC0000005），stdout/stderr 为空，未产生源码编译诊断。
- cjpm --version 独立临时工作目录及 TEMP/TMP：C:/Users/jingg/AppData/Local/Temp/SaCode-cjpm-version-d907ed5407d445a9a1e2046883e1e036。
- 私有 core build target：C:/Users/jingg/AppData/Local/Temp/SaCode-core-build-2029b44846b4422d9b216335527a4216/target。
- 运行结束后没有残留 cjpm/cjc 进程。安装目录与用户配置未修改，没有提交或推送。

## 后续报告规则与复核边界

- 报告仅接受已审批提案中的标准命令名：`cjpm build` 以成功退出事实、完整双流 EOF、无截断作为构建通过条件，不虚构测试计数；`cjpm test` 要求有效 Cangjie TOTAL 摘要；`node --test` 要求 TAP 汇总。自定义命令、绝对路径同名可执行文件以及格式不匹配的摘要不通过。
- 空测试集、全跳过、失败/错误、取消、超时、未知终态、输出不完整或截断均不通过。分类绑定任务状态和输出完整性，但当前不校验可执行文件身份（路径、签名或哈希）；界面明确说明这一限制。
- `node --check renderer/pages/build-test-report.mjs` 退出码 0；`node ..\..\scripts\pack-pages.mjs` 退出码 0，生成忽略的本地 renderer/vendor/client-slots.iife.js；bundle 包含 `SaCodeBuildTestPage`、`cangjie-build` 与 `build-succeeded`。
- 上一节 2026-10-15 的 cjpm 崩溃读数是较早一轮。用户提示可能存在 SDK 占用后，本会话重新用独立临时工作目录运行 `cjpm --version`，无输出挂起约 35 秒后手动中断；会话中 PID 14644 属于本会话，PID 23216 的归属及命令行不可读取且进程检查 Access denied，因此未触碰。结束后没有可见 cjpm/cjc。重试没有自然退出码，也没有运行 core build；不能据此归因为占用或源码问题。
## 当前结论

此前一次隔离探针中 cjpm.exe 以 0xC0000005 退出；用户要求重试后，新的 cjpm --version 探针挂起约 35 秒并被中断，期间还有身份不可读取的 PID。现有证据不能确认 SDK 占用、cjpm 启动故障或源码编译问题。当前源码的 Host/CLI 构建及真实命令执行仍未验证；构建测试页保持待真实 Host 验收，产品目标保持未完成。

## 差异审查页接线

- 右侧“差异审查”页组合编辑器未保存草稿 diff 与当前会话/工作区下的 Git 索引、工作区只读 diff；Git 查询仍调用现有有限 Host 接口，没有新增写操作。
- 页面显式说明现阶段未将文件变化归属到 Agent 任务，不把任意工作区差异伪装成任务产物；文件任务归属、修订关联及测试报告关联仍是 REVIEW-01 缺口。
- `node --check apps/desktop/renderer/app.js`：退出码 0。
- 在 `apps/desktop` 执行 `node --test test/review-page.test.mjs test/build-test-report.test.mjs test/execution-history.test.mjs test/execution-history-ipc.test.mjs test/execution-ipc.test.mjs`：退出码 0，18/18 通过。
- 仓库根执行 `node scripts/pack-pages.mjs`：退出码 0，renderer 页面 bundle 包含 `SaCodeReviewPage`。
- `git diff --check` 对改动的 app.js、client-slots.ts、workbench-tabs.ts：退出码 0。当前仍未完成真实 Host/桌面端审查页验收。
## 编辑器与 Git 状态源复验

- 在 `apps/desktop` 运行 `node --test test/file-editor-recovery.test.mjs test/git-workbench.test.mjs`：退出码 1，16 项中 14 通过、2 失败。编辑器恢复及 Git 状态解析、迟到结果保护、有限 IPC 测试通过；两个真实 Host 场景均失败为 `host-gone: exit code 3221225477`。
- 两个失败场景默认调用 `apps/desktop/dist/host/bin/sacode-host.exe`。只读核对得到修改时间 `2026-10-11 18:27:06 +08:00`、大小 `11,183,104` 字节、SHA-256 `73131303DEF182F3F5728E09DE9D15265AA95137DD97CD0A25BEBF7A4B0519CC`。该载荷旧于当前基线，不能用于当前源码验收。
- 测试结束后的普通进程查询未列出 cjpm、cjc 或 sacode-host；未终止任何进程。Host 故障的根因仍未确定。