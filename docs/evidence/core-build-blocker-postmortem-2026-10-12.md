# Git 写操作接入的前置阻断：core 编译失败（2026-10-12）

> **2026-10-12 更新：阻断已解除。** 本文第二节记录的核心编译失败已修复，`cd core && cjpm build`
> 现为 `cjpm build success`。根因归因在第三节更正：不是「仓颉的 `if` 不能当表达式」
> （仓内 `agent.cj` 等处有大量 `let x = if … else …` 正常编译），而是 **`else { None }`
> 的 `None` 缺类型实参、在 if 表达式上下文里无法推断**。修复写法见第三节末。
> 下文保留原记录，不删改，以留痕当时的判断过程；引用时请以本段为准。

## 结论先行

Git 写操作接入**未开始实施**。第一步需要新增共享核心模块并验证，但 `core` 当前编译不过，
没有可用构建基线。此时写新核心代码只会产出未验证产物，故本轮改为定位并取证阻断原因。

本轮未修改任何产品源码，仅新增本记录；未执行任何 Git 写操作。

## 一、提交态核实

三笔提交确已落地，暂存区为空：

```
1dea2da feat(core,host,desktop): 由用户直接选择项目目录并回放最近项目
514609b feat(core,host,desktop): 数据目录落到项目内并修正会话写锁判活
14aa71f fix(core,host,desktop): 打通模型连接与能力配置链路
d3dd02c （原起点）
```

`git diff --cached --stat` 为空。交接文档已入库。此前会话报告的「昵称真保存未提交」
属实：`core/src/user_profile.cj`、`apps/host/src/profile_surface.cj` 仍为未跟踪。

### HEAD 不是可独立构建的快照（独立复核确认）

| 缺失符号 | HEAD 中的调用方 | 缺失定义 |
| --- | --- | --- |
| `queryWorkspaceGit` | `apps/host/src/main.cj:2062` | `core/src/git_workbench.cj` 未入库 |
| `ExecutionApi` | `apps/host/src/main.cj:292,904,1028` | `core/src/execution_api.cj` 未入库 |
| `SessionWorkspace.revision()` | `apps/host/src/main.cj:2089` | HEAD 的 `core/src/workspace.cj` 只有 directory/effectiveDirectory/available/setDirectory |

交接方已如实声明此项，本轮用 `git cat-file` 与 `git show HEAD:core/src/workspace.cj`
独立复核，结论一致。这不影响三笔提交作为工作区增量的事实，但不能当作「干净检出即可构建」的证据。

## 二、工作区基线同样编译不过（此前未登记的新事实）

`cd core && cjpm build` → **10 errors / 136 warnings，rc=1**。

全部 10 个错误来自**同一个文件、同一个语句**：`core/src/ptc_exec.cj:36-43`。
其余 `prompt_enhance.cj`、`attempt_log.cj` 等位置的输出是**告警**，不是错误——
先前按 `.cj:行:列` 粗筛会把这 136 条告警混进错误清单，本记录按 `^error` 块重新提取后才得到真实范围。

该文件是其他会话在飞改动（`git status` 为 ` M`，最近入库提交 `235fb59`），本轮未触碰。

## 三、根因（已用独立探针证实，非推测）

### 原归因（已更正）

原文写「仓颉的 `if` 不能当表达式赋给 `let`」，**此说不成立**：仓内大量使用该形状且正常编译，
例如 `core/src/agent.cj` 的 `let rawArgs = if …`、`let grant = if exactApproval { … } else { … }`、
`core/src/global_appearance.cj` 的 `let theme = if …`，以及本文自己引用的 `let parsed = if …` 改写史。

### 更正后的根因

真正无法推断的是 **`else { None }` 里的 `None`**：它在 if 表达式中没有任何上下文能定出
泛型实参，编译器报 `generic type should be used with type argument`，`==>` 正好指向该 `None`。

类型推断随后塌陷并产生连锁报错：`wd` 类型不定 → `runOwnedProcess(..., wd, ...)` 实参塌陷 →
返回值类型不可靠 → `if (let Some(r) <- owned)` 报 enum pattern 不匹配 → 绑定名 `r` 不可见
→ `r.stdout` / `r.stderr` / `r.exitCode` 等 7 处 `undeclared identifier 'r'`。

即 **1 个根因 + 1 级类型推断塌陷 + 7 处连带报错**，不是 10 个独立缺陷。

### 修复写法（已应用）

把 if 表达式改回语句式，类型由变量声明给出：

```cj
var wd: Option<Path> = None
if (cwd.size > 0) { wd = Some(Path(cwd)) }
```

同一文件里的 `if (cwd.size > 0) { cwd } else { workingDirectory }` **不需要改**：两支都是
`String`，类型可推断，实测编译通过。

## 四、本轮自身失误（如实留痕）

第一次取构建日志时用了相对路径，在 `core/` 下误建嵌套目录
`core/apps/desktop/.tmp-test/core-build-probe.log`，违反「临时产物只落 `apps/desktop/.tmp-test/`」。
发现后立即 `Remove-Item -Recurse -Force core/apps`，`git status -- core` 未见残留游离文件。
探针目录 `apps/desktop/.tmp-test/ifexpr-probe/` 同轮用完即删。

## 五、对 Git 接入计划的影响

[Git 写操作接入方案](../plans/2026-10-12-git-write-integration.md) 的范围与安全决策不变，
第 1 步（独立核心 + 专属测试）**暂不可执行**：core 编译失败时无法验证新模块，
不得以「未编译的源码」充当第一步交付。

同理，本轮也没有先做渲染层：只做页面而核心缺动作，会造成仓库既有文档反复警告的
「页面存在但无后端」假接通。

未受影响的部分：已落地的权限菜单、插件清单恢复、文件编辑器回执三批修复均不依赖 core 编译，
其 41 条桌面侧测试与入口内存构建证据保持有效。

## 六、建议顺序

1. ~~由 `ptc_exec.cj` 属主会话（或明确授权）应用上述两行修复，使 `cd core && cjpm build` 转绿。~~
   **已完成**：`core` 现编译通过。
2. 绿后先跑一次 core 全量测试取基线计数，再进入 Git 接入第 1 步。
3. HEAD 与工作区的符号断裂（第一节）需单独裁决是否入库，本计划不代为提交他人模块。