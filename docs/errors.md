# 项目错题本（Error Book）

> 目的：把**踩过的坑**沉淀成项目内、可检索的**先验知识**，下次同类任务直接命中，跳过"探索→试错→修复"的多轮往返——**越用越准、越省 token**。
> 用法：任务开始前**按关键词检索**本文件（不自动注入）；修完一个 bug / 踩完一个坑，**收尾同批追加**一条。范式见 `repo-conventions` skill 的 `references/error-book.md`。

## 模板

```md
## E0xx 一句话现象
- 日期：
- 领域：
- 触发场景：
- 现象：
- 根因：
- 正确做法：
- 适用范围：
- 状态：有效 | 已失效
- 关键词：
- 证据：
```

---

## E001 core 全量单测因同名 @Test 无法编译
- 日期：2026-10-24
- 领域：测试 / 仓颉
- 触发场景：新增 `core` 的 `@Test` 函数
- 现象：**整个 core 测试包编译失败**（所有单测都跑不了，而不只是那两条）
- 根因：仓颉同包内**函数名必须唯一**；两个 `*_test.cj` 各自定义了同名且都标 `@Test` 的 `func`（`delegateToolRegistrationApprovalResultAndCancellation`）
- 正确做法：测试函数名带**场景/对象前缀**保持唯一；新增前先 `grep` 同名；命名重叠时重命名为贴切语义的名
- 适用范围：任何新增/合并 core 测试
- 状态：有效（2026-10-24 已去重）
- 关键词：同名, @Test, 编译失败, core 单测, cjpm test
- 证据：登记缺陷 D27；`docs/evidence/2026-10-24-p0-cross-end-gates.md`

## E002 台账"读数基线"不更新 → 口径漂移
- 日期：2026-10-24
- 领域：文档 / 台账
- 触发场景：长时间开发后未回填台账顶部基线行
- 现象：台账自述基线与当前 HEAD/分支不符（如仍写数天前的 `dev` 旧提交），读数不可信，判"是否已验"失去锚点
- 根因：基线只在**建立时**写一次，后续提交未同批回填
- 正确做法：每次较大提交后，**同批**更新读数基线（分支 / HEAD / 日期）
- 适用范围：任何带"读数基线"的活文档
- 状态：有效
- 关键词：基线, 台账, HEAD, 口径漂移, 过期
- 证据：登记缺陷 D28；`docs/product/PRD-tracking.md` 基线行

## E003 `cjpm build` 后跑 exe 报 0xC0000135（缺 DLL）
- 日期：2026-10-24
- 领域：构建 / 仓颉
- 触发场景：构建后运行 CLI/Host/daemon 入口
- 现象：入口处 `0xC0000135`（找不到 DLL），或构建后 bin 里 0 个 DLL 且无报错
- 根因：cjpm **不复制** `bin-dependencies` 的 DLL（上游 issue #725）；且 `build-script.exe` 自身要 runtime，**不前置 DLL 到 PATH 钩子会静默不跑**
- 正确做法：`build.cj` 的 `stagePostBuild` 复制完整运行期 DLL 集；构建前把 `SACODE_STDX_DLL_DIR` / `SACODE_RUNTIME_DLL_DIR` 前置到 PATH
- 适用范围：所有仓颉入口构建
- 状态：有效（已内化为 build.cj 绕过）
- 关键词：0xC0000135, DLL, cjpm, stdx, issue 725, PATH
- 证据：`docs/evidence/2026-10-17-cjpm-build-cj-stage-post-build-hook.md`；根 `AGENTS.md`「运行期 DLL 路径约定」

## E004 仓内 Electron / 宿主 spawn 失败（0x80000003 / EPERM -4048）
- 日期：2026-10-24
- 领域：测试环境 / 桌面
- 触发场景：在**仓库内**直接跑 Electron 或用宿主 spawn node 子进程
- 现象：Electron `exit 0x80000003`；node 子进程对 `D:\` 根 `lstat` 被拒 `EPERM -4048`；dev 布局宿主用例必红
- 根因：仓库根 **Low Mandatory Level** 完整性标签被子进程继承 → MIC no-write-up 拦截（**非代码缺陷**）
- 正确做法：把运行物**导出到中性目录**（Medium）执行；交互用例走 `scripts/run-electron-tests-interactive.cmd`；**不改 ACL / 不削弱沙箱**
- 适用范围：凡"仓内失败、中性目录成功"的对照
- 状态：有效
- 关键词：0x80000003, EPERM, 完整性标签, 中性目录, Electron, spawn
- 证据：`docs/evidence/2026-10-24-extension-host-env-root-cause.md`

## E005 提交前 `git add -A` 会把游离产物带进提交
- 日期：2026-10-24
- 领域：提交安全
- 触发场景：批量提交
- 现象：临时夹具 / 私有副本 / 日志被误提交
- 根因：`git add -A` / `git add .` 无差别暂存
- 正确做法：**只按文件路径精确 add**；提交前 `git status` 必须无"未跟踪、未忽略"的顶层项
- 适用范围：任何提交
- 状态：有效
- 关键词：git add -A, 产物, 精确 add, .gitignore, 仓库根
- 证据：根 `AGENTS.md`「不要提交构建产物」

## E006 PowerShell `-replace` 大小写不敏感 → 批量改写误伤
- 日期：2026-10-24
- 领域：批量改写 / 脚本
- 触发场景：用 PowerShell `-replace` 全库批量替换词
- 现象：误伤同名子串（如把 `readShellBounded`、`.dsh/skills` 一并替换）
- 根因：PowerShell `-replace` **默认大小写不敏感、无词边界**
- 正确做法：用 `-creplace`（区分大小写）或加**词边界**正则；**先 dry-run 看 diff 再落盘**；出错即整体回滚重做
- 适用范围：任何脚本化批量文本改写
- 状态：有效
- 关键词：-replace, -creplace, 词边界, 误伤, 批量替换
- 证据：本项目"去历史参考缩写"批次实际踩坑与回退

## E007 渲染层引第三方库被 CSP 拦
- 日期：2026-10-24
- 领域：桌面前端
- 触发场景：渲染层引入第三方组件库 / 用模板编译器
- 现象：ESM / 模板编译在 `file://` 下被 CSP / CORS 拦
- 根因：CSP `script-src 'self'` 禁 `unsafe-eval`；渲染层运行时**无模块加载器、无模板编译器**
- 正确做法：用 Vue **runtime** + `h()`；第三方库在**构建期**折叠成经典脚本进 `renderer/vendor/`，且 `vue` 别名到已 vendor 的同一份 runtime
- 适用范围：改 `apps/desktop/renderer`
- 状态：有效
- 关键词：CSP, unsafe-eval, ESM, 构建期折叠, vendor, runtime
- 证据：根 `AGENTS.md`；`scripts/pack-tinyvue.mjs` / `pack-tinyrobot.mjs`

## E008 会话日志 `append` 不跨进程可见
- 日期：2026-10-24
- 领域：core 会话
- 触发场景：写会话事件后别的进程/会话读不到
- 现象：新事件只在当前实例内可见
- 根因：`append` 只实例内可见；**`flush` 才跨进程持久**
- 正确做法：需要跨进程/跨重启可见时，必须 `flush`
- 适用范围：一切会话日志写入
- 状态：有效
- 关键词：append, flush, 会话日志, 持久, 投影
- 证据：根 `AGENTS.md`「必须知道的约束」