# 全库生产源码语法与编译检查报告（2026-10-13）

## 1. 结论

本轮检查的是**当前工作区的第一方生产源码**，不是干净检出的 HEAD，也不是业务功能验收。

- 仓颉四个生产模块 `core`、`apps/host`、`apps/cli`、`apps/daemon` 均 `cjpm build` 成功，退出码均为 0；没有阻断构建的语法、类型或链接错误。
- 92 个 JS/CJS/MJS 文件全部 `node --check` 通过；50 个 TS 文件全部 esbuild 语法解析通过。
- 使用本仓页面构建的 `globalThis.Vue` 映射后，50 个 TS 入口的导入解析和内存打包通过，无警告。
- 2 个生产 PowerShell 脚本仅做 AST 解析，均无语法错误；16 个 CSS 与 5 个生产 JSON 均解析通过。
- 当前编译仍有警告，具体位置见 §5。**警告不能直接等同于运行故障，编译通过也不能等同于业务正确。**
- 本轮没有修改生产源码，没有修改或运行旧测试，没有提交、推送、安装依赖、重建安装包或操作用户数据。

> **修正阶段最新状态（§8–§19）**：用户批准后已做十一批生产源码局部修正并完成最终全库复核，四模块全部编译成功，模块本体警告合计 **227→34**；未使用 import 与局部不可达资源诊断均为 0。最终构建期间 206 个生产仓颉源码哈希均未变化。上方“没有修改生产源码”只描述初次只读检查阶段，不代表后续修正阶段。全过程没有修改或运行旧测试，没有提交或推送。

## 2. 技能与环境核验

使用用户指定的 **Cangjie-SIG/CangjieSkills → `cangjie-coding`**，先读取实际仓库 `README.md`，再读取 `.agents/skills/cangjie-coding/SKILL.md`，通过该技能目录的 `scripts/search_docs.py` 检索。

| 项目 | 本次实测 |
| --- | --- |
| 技能来源 | `https://gitcode.com/Cangjie-SIG/CangjieSkills.git` |
| 本地目录 | `C:/Users/jingg/AppData/Local/Temp/opencode/CangjieSkills-1.1.3` |
| 技能分支 | `cangjie-1.1.3` |
| 技能提交 | `4b844f29e82b32ecf2171c36659b9e8ea9e2f595` |
| 仓颉编译器 | `Cangjie Compiler: 1.1.3 (cjnative)` |
| 目标 | `x86_64-w64-mingw32` |
| Node | `v22.23.2` |
| TS/CSS 解析器 | esbuild `0.28.2` |

已核技能契约包括：

- `tools.cjpm.3-常用命令选项表.3-1-build-选项`：`--target-dir` 指定独立输出目录，`--verbose` 输出真实编译命令。
- `std.core.struct.array`、`std.collection.class.arraylist.add`：Array 固定长度，追加应使用 ArrayList 的活动成员；旧 `accepted.add` 错误在当前 `session.cj` 已不存在，本轮不重复修正已移除的代码。
- `std.core.func.acquirearrayrawdata-t-array-t-where-t-ctype`：推荐裸数组句柄通过 `acquireArrayRawData` 获取，并按生命周期配对释放。
- `language.error_handle.2-抛出与处理异常.2-3-try-with-resources-表达式`：Resource 自动关闭可作为资源清理重构的候选，但不能只凭警告删除 finally。
- `std.env.func.getworkingdirectory`：只确认了读取工作目录的契约；技能查询未找到 `chdir` 的替代 API，因此本轮不编造替代方法。

esbuild 的 `transform`、`write:false` 及不做 TypeScript 类型检查的边界另经 Context7 文档核对。

## 3. 检查范围和排除范围

通过 `git ls-files --cached --others --exclude-standard -z` 收集当前存在的源码，包含第一方未提交生产文件；不是只检查 Git diff 或某一处错误。

| 生产源码 | 文件数 | 方法 |
| --- | ---: | --- |
| `core/src/*.cj` | 174 | 全包生产构建 |
| `apps/host/src/*.cj` | 10 | 全包构建及链接 |
| `apps/cli/src/*.cj` | 8 | 全包构建及链接 |
| `apps/daemon/src/*.cj` | 14 | 全包构建及链接 |
| `.js` / `.cjs` / `.mjs` | 92（26 / 40 / 26） | `node --check`，不执行源码 |
| `.ts` | 50 | 逐文件 transform + 全入口内存打包 |
| 生产 `.ps1` | 2 | PowerShell `Parser.ParseFile` |
| 生产 `.css` | 16 | esbuild CSS 解析 |
| 生产 `.json` | 5 | `JSON.parse` |

代码主体共 **350 个文件**；另补 CSS/JSON **21 个文件**。未发现位于四个源码模块之外的第一方生产 `.cj` 文件。

明确排除：

- `_test.cj`、`.test.*`、`.spec.*`、测试辅助文件、test/tests/test-support/fixtures 目录、冒烟和探针脚本。
- `node_modules`、vendor、第三方参考库、临时快照、`target`、`dist`、运行数据和用户凭据。
- 旧测试不运行、不修正、不删除；没有执行 `cjpm test`、`npm test` 或 Electron 冒烟。

**范围限制**：HTML 和 CMD 没有专用严格语法验证，本轮不算通过；文档中的代码片段不检查。仅验证 Windows x64 活动编译分支，非 Windows 条件分支没有跨平台编译证据。TS 只证明语法和导入解析，不是 `tsc --noEmit` 类型检查。JS 未做变量未定义/完整依赖解析或运行验证。

## 4. 实际编译结果

命令在各模块目录串行执行：

```text
cjpm build --verbose --target-dir <本次私有输出目录>/<模块>
```

私有输出统一在 `apps/desktop/.tmp-test/takeover-20261011/syntax-audit-20261013/target/`，避免占用其他会话的生产 target。`--verbose` 日志确认不是测试构建，没有 `--test-only` / `--export-for-test`。

最终四模块复验：

| 模块 | 退出码 | 本模块警告 | 依赖 core 的重复警告 | 耗时 |
| --- | ---: | ---: | ---: | ---: |
| core | 0 | 169 | — | 40.731 秒 |
| host | 0 | 33 | 169 | 42.975 秒 |
| cli | 0 | 8 | 169 | 38.247 秒 |
| daemon | 0 | 17 | 169 | 39.621 秒 |

不能把依赖 core 的三次重复编译警告相加成三份不同问题。

### JS/TS/脚本结果

- 92/92 JS 文件语法检查通过；50/50 TS 文件语法检查通过；上述逐文件解析未产生警告。
- TS 全入口按实际 Vue 全局映射规则打包：50 个入口、51 个输入、退出码 0、警告 0，`write:false`，没有生成或覆盖 renderer/vendor。
- 两个 PowerShell 文件是 `scripts/check-desktop-metadata.ps1` 与 `scripts/pack-brand.ps1`，仅解析，错误数均为 0。
- 16/16 CSS、5/5 JSON 解析通过。

### 环境限制，而非源码语法错误

当前 `apps/desktop/node_modules/esbuild` 和 `vue` 不存在。为不安装或改动依赖，仅借用已有私有目录中的 esbuild 0.28.2 **工具本体**解析当前源码，没有借用旧源码或 Vue 依赖。

不设置 Vue 映射的裸打包产生 37 条 `Could not resolve "vue"`；这说明当前依赖环境不完整，并非 37 个 TS 语法错误。真实 `scripts/pack-pages.mjs:11–14` 本来就把 Vue 映射到 `globalThis.Vue`，按该规则复验已通过。没有据此声称 `npm run vendor`、完整桌面打包或应用启动已通过。

## 5. 具体问题清单与处理建议

### A. 可明确修正的低风险问题

| 编号 | 位置 | 编译诊断 / 源码事实 | 建议及影响 |
| --- | --- | --- | --- |
| A1 | `apps/cli/src/remote.cj:3–4` | `import std.collection.ArrayList` 连续重复两次，编译器报导入冲突警告 | 删除其中一条。无需改任何逻辑，是可直接处理的低风险清理 |
| A2 | `core/src/todo.cj:18` | 空白字符表使用不可见 Unicode 字面量；编译器针对 U+1680 报 `unsecure character` | 采用等价 Unicode 转义表示，保留原空白集合，不删除字符或改变 trim 语义 |
| A3 | `core/src/appcontainer_win.cj:166` | `CPointerHandle<UIntNative>()` 默认构造已废弃 | 改为不需要默认构造的可选句柄状态，并在真实 acquire 后发布；保持 `attributePinned` 与 finally 配对释放。不能只换一个构造调用就算完成 |

### B. 需要审查资源路径，不能机械删除的警告

共有 9 个 `unreachable block in 'if' expression` 位置：

| 位置 | 内容 | 本轮判定 |
| --- | --- | --- |
| `core/src/web_http.cj:116` | finally 中 HTTP client 关闭 | 有警告，但源码保留异常清理意图；尚不能据此认定真实漏关 |
| `core/src/session.cj:160` | finally 归还临时写租约 | 涉及持久化写权，禁止直接删除；需确认返回和异常两条路径 |
| `core/src/hook_executor.cj:275–276` | finally 关闭响应与 client | 涉及 HTTP 资源；需要生命周期分析，而非只消警告 |
| `core/src/agent.cj:1294` | 新建文件发布 finally 中补关文件 | 与写失败路径有关；清理应保持异常安全 |
| `core/src/agent.cj:1313` | 原子替换 finally 中补关文件 | 同上，不能破坏临时文件回收或原子替换 |
| `apps/host/src/worktree_rpc.cj:192` | 可选 request 已确定赋值后的执行块 | 可简化局部可选状态，但需保留参数错误与执行错误的不同错误码 |
| `apps/host/src/main.cj:2515–2516` | 会话切换 finally 归还目标/索引租约 | 涉及跨会话写权；不做大块删除或改控制流来消警告 |

**这些不是本轮已经证实的运行故障**，也不应宣称清理代码真的不会执行。当前证据只有编译警告和生产源码上下文，未运行资源失败路径。

### C. 非阻断维护项

- `apps/cli/src/worktree_command.cj:712` 使用废弃的 `std.posix.chdir`。当前能编译，源码已记录兼容目的。技能库未给出可确认的替代设置 cwd API，本轮不改；后续应通过本机 SDK 核实替代或继续有理由地保留。
- 多处 `possibly confusing line terminator`，例如 `core/src/prompt_enhance.cj:8–12`、`core/src/attempt_log.cj:28` 的跨行表达式。建议按文件小批次增加分组或调整续行格式，不全库格式化并发改动。
- 多处未使用导入、变量、函数。例如 `core/src/accel_relay.cj:3–5` 的未用导入，`core/src/session.cj:256` 的旧 `mayOverwriteDurable`，以及 `apps/host/src/mode_rpc.cj:6,14` 两个未被调用的局部处理函数。后两项需要确认是否为待接线代码，不擅自删除。
- 警告聚合器对四份日志按文件、行列、消息去重得到 234 条记录，其中续行 119、unused 102、unreachable 9、Unicode 1、废弃 API 2、重复导入 1。**并发修改可造成同一问题位置漂移，此值仅为本次日志记录去重值，不是固定源码的稳定问题分母。**最终可靠统计以各模块的编译器原始计数为准。

## 6. 并发与证据边界

- 检查期间其他会话推进 HEAD；四模块复验开始和结束均记录 `4d89a133556b16f69fcf978e48a77ca1e7693ecc`，但工作区并非干净状态。
- 文件哈希显示 `core/src/acp_delegation.cj` 在编译期间发生变化；JS/TS 检查区间的生产文件哈希未变化。
- 为避免混合快照冒称固定验收，对最新 core 另做一次编译，记录前后源码哈希。最终 **exit=0，174 个生产源码文件前后哈希均未变化**，见本次 `core-final.json`；这证明该区间的最新 core 构建成功，仍不是整个仓库干净提交态验收。
- 没有停止其他会话进程；所有本轮构建使用独立输出目录。
- 早先关于 HEAD 缺失接口和昨日 `session.cj` 错误的结论是当时快照事实，不能继续沿用为今天的错误清单；今天四个模块均已编译成功。

## 7. 证据位置与下一步

本次检查工具和证据位于以下忽略目录，它是**输出位置，不是被检查的旧测试**：

```text
apps/desktop/.tmp-test/takeover-20261011/syntax-audit-20261013/
  inventory.json / inventory-build.json
  build-results.json
  build-core.log / build-host.log / build-cli.log / build-daemon.log
  script-results.json
  powershell-results.json
  assets-results.json
  warning-summary.json
  build-core-final.log / core-final.json
```

建议下一批先处理 A1、A2，A3 单独核对 CFFI 句柄状态；B 类保留原资源语义再做小范围调整。用户已要求先看报告，本轮不先行修改源码或提交这些清理。

## 8. 用户批准后的首批警告修正

用户阅读报告并批准后，仅修改以下三个生产文件，不处理旧测试或无关资源警告：

1. `apps/cli/src/remote.cj`：删除一条重复 `ArrayList` 导入，不改变远程请求逻辑。
2. `core/src/todo.cj`：19 个空白字符全部改为 `\u{...}` 显式表示。修正前保存码点序列，修正后按转义解码与序列逐项核对，完全相同；不调整 trim 算法或清单。
3. `core/src/appcontainer_win.cj`：默认 `CPointerHandle<UIntNative>()` 与独立 `attributePinned` 标志改为 `?CPointerHandle<UIntNative> = None`。只有 acquire 成功后保存 `Some(acquired)`；finally 在 Some 分支中先删除已初始化属性列表，再 release 对应数组句柄。保留原数组类型、大小、对齐和所有原生调用；不执行探针，不更改 token、ACL、环境或进程权限。

通过 cangjie-coding 活动签名核对 acquire/release 与 if-let 语法，使用本机编译器验证；仅对修改行运行 cjfmt，未格式化整库。A3 源文件本身是其他工作线的未跟踪文件，本次仅做上述局部修正，不认领或提交其余内容。

### 首批修正的验证证据

证据目录：`apps/desktop/.tmp-test/takeover-20261011/syntax-warning-fixes-20261013/`。

- `baseline.json` 及 `before/`：修改前的三文件基线和原始 19 个字符码点。
- `verification.json`：码点等价核对、四模块构建结果、三文件构建前后哈希。
- `build-core.log`、`build-host.log`、`build-cli.log`、`build-daemon.log`：私有输出目录的串行生产构建，**没有运行测试、应用或身份探针**。
- 不把旧报告的警告计数覆盖成修正后结果；本节另行记录本批验证状态。

四模块生产构建均 **exit=0**，三类目标警告均未再出现：

| 模块 | 修正前本模块警告 | 修正后本模块警告 | 退出码 |
| --- | ---: | ---: | ---: |
| core | 169 | 167 | 0 |
| host | 33 | 33 | 0 |
| cli | 8 | 7 | 0 |
| daemon | 17 | 17 | 0 |

依赖 core 的重复计数从 169 降至 167，不重复相加。19 个空白字符的码点序列核对相同；三处修改文件在整个构建期间哈希未变化。`scope-check.json` 确认三个文件在上述局部修正之外与修改前基线一致，保留其他作者的原始内容。

验证仅含生产构建、字符集合与源码范围检查，没有运行旧测试或 AppContainer 探针；不把编译绿色宣称为权限隔离或异常清理路径运行验收。改动未暂存、未提交、未推送。

## 9. 第二批：未使用导入与续行警告

用户要求继续后，按最新生产构建的诊断逐条定位，不扫描旧测试正文。

- 32 条编译器明确报告未使用的导入已删除，分布于 27 个生产文件；不删除函数、变量或初始化调用。
- 首先调整 7 个生产文件中的 20 处续行：把 `+` / `||` / `&&` 放到前一行末尾。字符串内容、运算符顺序、参数、判断式和副作用调用均保持不变。
- 共涉及 32 个不同文件。未对全库格式化；CLI `main.cj` 内断言式自测的两处续行按用户要求排除，生产构建仍由编译器检查该入口。
- 续行调整文件：`core/src/prompt_enhance.cj`、`core/src/attempt_log.cj`、`apps/host/src/tips_surface.cj`、`apps/cli/src/remote.cj`、`apps/daemon/src/remote_schema.cj`、`apps/daemon/src/remote_gate.cj`、`apps/daemon/src/daemon.cj`。
- 删除导入的精确文件与计数见 `syntax-warning-round2-20261013/manifest.json`；逐文件修改前基线与候选均保留在本次忽略目录。

### 资源清理警告复核

已读取技能活动契约 `language.error_handle.2-抛出与处理异常.2-2-普通-try-表达式`：finally 即使异常未捕获也会执行。因此不能因为编译器局部不可达提示就断言资源真正漏关，或删除这些清理块。

当前仍保留 `SessionLog.flush` 的临时租约归还、HTTP response/client 关闭、文件关闭和会话切换双租约清理。它们涉及异常路径与写权，不在没有运行证据的条件下为凑警告零值改行为。

第二批证据位置：`apps/desktop/.tmp-test/takeover-20261011/syntax-warning-round2-20261013/`；其中 `before/` 是本批修改前基线，`candidate/` 是预先生成的局部候选，`verification.json` 记录候选一致性与四模块构建结果。所有工具均为检查输出，不是旧测试用例。

第二批生产构建实测：

| 模块 | 第二批前本模块警告 | 第二批后本模块警告 | 退出码 |
| --- | ---: | ---: | ---: |
| core | 167 | 129 | 0 |
| host | 33 | 30 | 0 |
| cli | 7 | 4 | 0 |
| daemon | 17 | 9 | 0 |

32 个修改文件均与预先核对的候选一致，构建期间前后哈希未变化。补丁工具补齐个别文件的末尾换行，不是业务内容差异。没有修改旧测试、CLI 断言式自测、函数体逻辑或调用参数。

## 10. 第三批：其余生产续行与 worktree 分派

按第二批日志继续处理其余 97 处生产表达式续行，覆盖 9 个核心文件：`custom_model_registry.cj`、`sha256.cj`、`attach.cj`、`migration_pack.cj`、`secret_bundle.cj`、`route_health.cj`、`provider_registry.cj`、`worktree.cj`、`ledger.cj`。只调整运算符相对于换行的位置，保留原字符串、逻辑条件、短路顺序、位移/或运算及求值顺序；不改变日志或迁移包的字段和值。

`apps/host/src/worktree_rpc.cj` 的请求解析由 `Option<WorktreeRpcRequest>` 临时状态改为 `let request = try { ... } catch { return ... }`。正常构造返回请求，异常直接返回原 `-32602` 参数错误；执行仍单独捕获为原 `-32003`。删除必然已取得请求后的冗余 Some 检查和不可能到达的 None 兜底；不改变任何实际输入路径的处理结果。

其余 8 个资源清理警告不作无证据的行为重写：保留 finally 中临时写租约、HTTP 对象、文件与会话切换租约的释放。未使用函数和变量不批量删除，以免去掉带副作用的计算或正在接线的生产接口；废弃 `chdir` 未找到已核实的替代，仍保留兼容行为。

第三批证据位置：`apps/desktop/.tmp-test/takeover-20261011/syntax-warning-round3-20261013/`。修改前基线、局部候选、清单与串行生产构建日志分别保留；旧测试不检查、不运行、不修改。

第三批验证已完成，四模块退出码均为 **0**：

| 模块 | 初次审查本模块警告 | 首批后 | 第二批后 | 第三批后 |
| --- | ---: | ---: | ---: | ---: |
| core | 169 | 167 | 129 | **32** |
| host | 33 | 33 | 30 | **29** |
| cli | 8 | 7 | 4 | **4** |
| daemon | 17 | 17 | 9 | **9** |

按模块本体计数，合计 **227 → 74**，消除 153 条警告；不重复计算三个入口构建时再次打印的 core 依赖警告。第三批 9 个表达式文件与预先生成的候选一致，非空白字符序列一致；它们与 worktree 分派文件在构建期间没有并发变化。

### 剩余警告的逐项分类

最新 `warning-summary.json` 按文件、行列、消息去重亦为 74 条：

| 分类 | 条数 | 处理结论 |
| --- | ---: | --- |
| unused 函数/变量/参数 | 63 | 已无未使用 import。保留待接线函数及当前接口参数，不以删除函数或跳过原表达式求值来消警告 |
| finally 的局部不可达提示 | 8 | 保留现有异常清理与写权释放逻辑，不据编译器局部提示断言发生实际泄漏 |
| CLI 断言式自测中的续行 | 2 | 按用户排除旧测试要求不修改；位置为 `apps/cli/src/main.cj:977,981` |
| `std.posix.chdir` 废弃 | 1 | 技能库 `std.env` 活动成员没有设置工作目录的替代函数，不编造替代、不扩成新的平台 FFI 设计 |

剩余资源诊断位置仍为：`core/src/web_http.cj:116`、`core/src/session.cj:160`、`core/src/hook_executor.cj:275,276`、`core/src/agent.cj:1294,1313`、`apps/host/src/main.cj:2515,2516`。worktree 分派的冗余 Option 诊断已经消除。

本轮不承诺警告清零：剩余部分需要资源异常路径的实际运行或接口/功能设计决定；用户明确不运行旧测试，故将范围限定在已验证的生产语法/类型与不改业务行为的清理。

报告与改动均未暂存、未提交、未推送。完整 JS/TS 语法解析结果沿用 §4；本轮只修改仓颉生产源码，四模块生产构建为最终验证依据，不将 JS lint/typecheck 或旧测试伪报为已运行。

## 11. 第四批：保持调用副作用的未使用结果清理

用户要求继续后，逐项读取生产上下文，只改可以确定不删除校验、审计或接口的四个文件：

- `core/src/goal.cj`：`clear` 原先 `let current = cas(expected)` 改为直接调用 `cas(expected)`。**保留 CAS 校验、异常及调用顺序**，不丢弃校验调用。
- `core/src/batch.cj`：`clean` 原先 `let record = readTask(id)` 改为直接 `readTask(id)`。保留强制标志检查之前的任务存在/ID 验证以及租约内再次读取。
- `core/src/web_search_service.cj`：POST 复用已生成的 `body`，不再次调用相同的请求体生成函数。两种请求体生成函数均在生产源码核对，为局部 JSON 组装与参数检查；首次生成位置、参数与异常顺序不变，Tinyfish GET 仍不带请求体。
- `apps/daemon/src/remote_access.cj`：登记与 token 兑换的 try/catch 去掉未使用的 `ok` 结果及两支无用 Bool；保留 Some 槽位、原审计、401 失败、成功持久化和回执。

### 未使用参数揭示的生产缺口，不伪装成“已修好”

下列项目来自生产源码本身，未读取旧测试；不靠把参数改成 `_` 消警告来掩盖：

| 位置 | 当前源码事实 | 本轮处理 |
| --- | --- | --- |
| `core/src/acp_delegation.cj` 的 `onUpdate`、`onPermissionRequest`、`onElicitation` | 源码注释明确为待实现入口；分别空体、返回 -1、空体 | 保留其警告与功能缺口，不冒充 ACP 事件链已实现 |
| `core/src/acp_approval_bridge.cj` 的 `pendingFor` | 不按 delegationId 过滤，注释明确当前返回全局 pending 数 | 需业务定义和授权隔离设计，不做语法清理式修补 |
| `core/src/agent.cj` 的 `executeReview/executeCompress/executeInit` | 参数尚未消费，源码明确为 slash 执行骨架 | 保留接口，不宣称已有真实执行器 |
| `core/src/storage.cj` 的 `putFrom` | 只验证域已打开，不消费 key/value；log-only 结构的回放入口 | 不擅自增加第二存储真源 |
| `core/src/transport_failure.cj` 的 `parseRetryAfterSeconds` | nowEpoch 未用，HTTP-date 形态明确未实现 | 保留秒数行为；日期解析另属功能工作 |
| Host 的多条 `handleRpc*` | 统一签名中的 body 在只读/状态拒绝处理器里不需要 | 保留分派接口形状，不删参数或屏蔽告警 |

第四批证据位置：`apps/desktop/.tmp-test/takeover-20261011/syntax-warning-round4-20261013/`，包括四文件修改前基线、构建日志及 `verification.json`。不运行旧测试、真实网络或身份探针。

第四批四模块生产构建均退出码 **0**，修改文件与 worktree 分派文件在构建期间哈希未变化：

| 模块 | 初次审查本模块警告 | 第三批后 | 第四批后 |
| --- | ---: | ---: | ---: |
| core | 169 | 32 | **29** |
| host | 33 | 29 | **29** |
| cli | 8 | 4 | **4** |
| daemon | 17 | 9 | **7** |

按模块本体合计 **227 → 69**，累计消除 158 条编译警告；依赖 core 的重复输出不纳入合计。第四批新增改动仅四个生产文件，局部 cjfmt 另展开了一处相邻取消检查的单行块，条件与异常行为不变。

剩余 69 条：unused 函数/变量/参数 58、资源 finally 局部不可达提示 8、CLI 内旧断言式自测续行 2、废弃 chdir 1。上述参数/函数的功能缺口与异常清理需要另外的业务实现或运行证据，不能通过隐藏警告宣称全后端已完成。

## 12. 第五批：文件与临时租约生命周期

用户要求继续后，读取技能 `File.isClosed()`、`File.close()` 和普通 try/finally 的活动契约，做两文件的局部生命周期修正：

- `core/src/session.cj` 的 flush：既有 `localWriter` 分支直接借用发布，不归还；只有 takeover 成功后的临时租约进入内层 try/finally，发布返回或抛出异常均调用 release。仍在原 `synchronized(mtx)` 内，失败仍返回 false，不修改日志格式和原生持久屏障。
- `core/src/agent.cj` 的两个文件发布函数：去掉跨异常路径的 `closed` 布尔变量，使用 `tmp.isClosed()` 实际状态；内层 finally 保证 close 抛错时仍尝试 `removeIfExists(staging)`。新建仍 rename(overwrite:false)，替换仍 nativeReplaceFile，不增加覆盖放行。

这不是仅把警告隐藏：临时租约所有权由代码作用域表达；文件关闭失败不再直接跳过临时路径回收。cleanup 本身仍可能抛出异常，未作“所有资源失败路径实测通过”的声明。

证据目录 `apps/desktop/.tmp-test/takeover-20261011/syntax-warning-round5-20261013/`：保留两个文件修改前基线，串行生产构建结果与哈希记录。只改生产代码，不运行旧测试、应用或真实模型请求。

第五批验证：四模块均 exit=0，core 警告 **29→26**，host/cli/daemon 本模块仍为 29/4/7。临时租约归还和两处文件关闭的局部不可达提示消失；两个修改文件构建期间无并发变化。局部 cjfmt 展开了两个相邻的目录选择表达式，取值不变。

## 13. 第六批：HTTP 资源所有权

核对技能 `stdx.net.http.class.client.close` 与 `stdx.net.http.class.httpresponse.close` 活动契约后，将 `core/src/web_http.cj` 与 `core/src/hook_executor.cj` 请求中的 HTTP 对象所有权记录到其现有连接状态对象：

- 取得 client / response 后仍立即登记，构造或发送失败时仅释放实际取得的对象。
- 请求线程在 finally 中调用 `closeHttpResources()`：先关闭 response，再关闭 client，各自保持原来的异常吞并策略；随后清空对应持有字段。
- watchdog 仍只修改原有 done 状态并关闭受锁保护的 socket，不读写 client/response 字段，避免并发关闭 HTTP 对象。
- 原顺序保持：结束状态 → socket 关闭 → response 关闭 → client 关闭 → watchdog.get()。取消、超时、证书验证、DNS/地址策略、错误分类和请求字节均不修改。

不是删除 HTTP 关闭调用，也未增加裸网络探针。证据目录 `syntax-warning-round6-20261013/` 保留两文件基线及生产构建输出。

第六批验证：四模块 exit=0；core 警告 **26→23**，三个 HTTP 清理局部不可达提示均消失，host/cli/daemon 本模块仍为 29/4/7。两文件构建区间无并发变化。当前局部不可达提示仅剩宿主会话切换的两处，第七批继续处理。

## 14. 第七批：会话切换租约所有权

`apps/host/src/main.cj` 用内部 `SessionSelectionLeases` 记录本次切换租约的所有权与保留策略，替代跨 try/finally 的两个局部标志：

- target takeover 成功后才设置 targetAcquired。
- 索引 flush 不确定时才设置 keepIndex，保留原 fail-loud/restart-required 策略。
- finally 无条件调用所有权对象的 release；release 内仍先归还本次取得的 target，再在 ownsIndex && !keepIndex 时归还 index。
- 不释放已有 active 租约、不重复接管或发布索引、不改变错误码和成功响应。

本轮不会因消警告降低会话写权要求；仍只做生产构建，不宣称跨进程异常释放已实测。证据目录 `syntax-warning-round7-20261013/` 保存宿主修改前基线和构建结果。

第七批验证完成：四模块 exit=0，宿主本模块警告 **29→27**，其余 core/cli/daemon 为 **23/4/7**。宿主修改文件在整个构建期间哈希未变化。

### 最新累计结果与验证边界

| 模块 | 初次审查本模块警告 | 第四批后 | 第五批后 | 第六批后 | 第七批后 |
| --- | ---: | ---: | ---: | ---: | ---: |
| core | 169 | 29 | 26 | 23 | **23** |
| host | 33 | 29 | 29 | 29 | **27** |
| cli | 8 | 4 | 4 | 4 | **4** |
| daemon | 17 | 7 | 7 | 7 | **7** |

模块本体合计 **227→61**，累计消除 **166** 条警告，没有通过禁用编译器告警达到该结果。最初 9 个局部不可达警告全部消失：worktree 冗余 Option 1、临时写租约 1、文件关闭 2、HTTP 清理 3、会话切换租约 2。

最新 `syntax-warning-round7-20261013/warning-summary.json` 去重后亦为 **61 条：unused 58、CLI 内旧断言式自测续行 2、废弃 chdir 1**。无 unused import，无本次清理目标的局部不可达诊断。未使用函数/参数仍按 §11 区分接口预留和功能缺口，不隐藏不实现。

额外仅做源码结构核对，`lifecycle-scope-check.json` 的 14 项均满足：目标/索引租约释放条件、takeover 后登记、索引失败保留策略、提前返回 finally 覆盖、HTTP 获取后登记、两种关闭分别捕获异常、response 先于 client、HTTP 清理先于 watchdog 等待。**这是静态结构证据，不是运行单测或故障注入证明。**

剩余功能骨架和异常路径是否符合最终产品契约，需要另批具体实现与验证；本轮没有运行、读取或修改旧测试，没有真实网络请求，没有启动应用/身份探针，没有提交或推送。

## 15. 第八批：生产不可达的私有辅助代码

用户要求继续后，对四个仓颉模块的生产源码（排除 `_test.cj` 与测试辅助文件）逐符号检索，结合编译器 unused 诊断及实际可见性，仅删除以下内容：

- `core/src/session.cj` 的 private `mayOverwriteDurable`：原整写方案的检查器，当前所有发布均经 `publishLocked` 的字节前缀核对和原生追加持久屏障；该 private 方法无调用。其 private `wholeLines` 仅被此旧检查器调用，一并清理。**没有删除现行发布路径的前缀检查、写权验证、坏尾处理或 durable 状态更新。**
- `core/src/permission_policy.cj` 的 private static `buildShellAllow`：没有调用方，不能视作现行 shell 放行依据。删除未使用的前缀表，并把误导性的注释改为真实行为：shell 仍返回 ask。`decide` 的全部条件和返回值保持不变。
- `core/src/worktree.cj` 的纯常量 `wtUnbindKeys`：只有定义没有生产引用，删除不会移除解绑验证逻辑；其余绑定/创建/agent 字段表保留。

没有删除 `goalMonotonicSeconds`、`webCooldownClear`、`sha256ToHex` 等非 private 辅助函数，也没有删除 daemon 的公开查询方法、Host 的公开模式处理器或队伍描述接口。它们是否保留、接入或弃用属于公共/包内契约决定，不能仅凭当前可执行程序没有调用就删除。

证据目录 `apps/desktop/.tmp-test/takeover-20261011/syntax-warning-round8-20261013/` 保存三文件修改前基线、生产符号引用位置（`production-symbols.json`）、四模块构建日志与哈希记录。该引用检索不声称覆盖外部源码使用者，但 private 方法无法由外部合法调用，且本批已核完其内部引用闭包。

第八批验证：四模块 exit=0，core 警告 **23→21**，host/cli/daemon 本模块为 27/4/7。三文件前后哈希稳定；`scope-check.json` 确认除了删除区域及权限说明注释，生产内容完全相同。

原 private 方法删除后，编译器新报告 `core/src/session.cj` 的 `std.env.getStdErr` 未使用，因此第九批继续删除该依赖。当前 21 包含这一条清理诱发的未用 import，不能把它当成新的功能故障。

## 16. 第九批：清理诱发导入与重复供应商分支

- 删除 `core/src/session.cj` 随旧覆写检查一起废弃的 `std.env.getStdErr` 导入。
- `core/src/web_search.cj` 中 Perplexity / DeepSeek-official 的同一条件连续出现两次，两个分支正文逐字一致。第二分支在第一个条件为假时条件也必为假，因此不可进入。删除第二分支，保留第一分支的所有请求字段、默认模型、max_tokens、工具数组、recency 校验与异常。
- 没有重新解释供应商协议或调用真实供应商；Tinyfish 当前工作区已有的 GET 空请求体改动是其他工作线内容，本次保留原样，没有夹带回退。
- 修改前保存两个生产文件的完整基线，脚本确认分支逐字相同；删除后核对除第二重复分支和一条 import 外所有内容不变。

证据目录 `apps/desktop/.tmp-test/takeover-20261011/syntax-warning-round9-20261013/`，含 `duplicate-check.json`、`scope-check.json`、基线和构建结果。本轮仍无旧测试、网络请求、应用启动、提交或推送。

第九批验证：四模块 exit=0，本模块警告 **core 20 / host 27 / cli 4 / daemon 7**，合计 **58**。修改文件构建期间无并发变化；除删除第二重复分支和一条 import 外的内容完全不变。最新去重诊断为 unused 55、CLI 内旧断言式自测续行 2、废弃 chdir 1，资源局部不可达与未使用 import 均为 0。

从初次模块本体合计 227 到当前 58，累计消除 **169 条警告**；重复供应商分支删除不算新的警告消除，只登记生产死代码清理。没有编造新的供应商能力或删除实际执行路径。

### 改动归属交接

九批合计涉及 **53 个不同生产源码路径**，但多数字节改动只是局部 import/续行；该路径计数不是 53 个文件全部归本会话。部分文件有其他作者的既有修改，`appcontainer_win.cj` 等仍是其他工作线的未跟踪生产文件。

本轮按批保存修改前基线和具体改动范围，清单位于 `syntax-warning-round9-20261013/owned-change-paths.json`。后续若用户要求提交，必须逐 hunk 比对当前 HEAD 与每批基线，不得按该清单整文件暂存，更不得夹带测试、用户数据或其他工作线实现。

下一步的边界明确：已确认的 private 死代码清理可以继续；公开/包内未调用接口要有明确弃用决定，生产骨架要有具体需求，不能只为警告零值删除或伪造实现。HTTP、租约和原子文件异常路径虽已编译及静态核对，仍不声称运行故障验证通过。

## 17. 第十批：移除宿主内部冗余参数

用户继续授权清理后，先核对编译器诊断、处理器正文和全部生产调用方，再仅调整 `apps/host/src/main.cj` 内部函数签名和直接调用：

- 22 个 `handleRpc*` 确实不读取 body，且每个均只有当前文件内的一处直接调用，没有函数值表或其他生产文件引用。
- 删除其声明中的位置参数 `body: String`，同步将调用改为 `(method, idText)`。两实参都是既有局部值，不删任何有副作用的实参求值。
- 处理器编号为 6、7、8、11、12、16、19、22、29、30、34、36、37、39、40、42、48、49、51、54、57、60；需要解析 body 的其他处理器保持三参数。
- 宿主入口从 `main(args: Array<String>)` 改为 `main()`，仍只返回 `HostRuntime().run()`；原入口未消费参数，没有新增或删除参数解释逻辑。
- 对外 JSON-RPC 方法名、帧格式、错误码、响应、处理器函数正文与分派顺序均不改变；公开 core/daemon API 参数未动。

静态范围核对 `scope-check.json`：22 组声明与调用全部同步，候选之外内容逐字一致，分派顺序一致。此证据只证明源码改动范围，不冒充真实 IPC 往返或运行验收。

证据目录：`apps/desktop/.tmp-test/takeover-20261011/syntax-warning-round10-20261013/`，保存基线、候选、处理器清单、调用核对与生产构建输出。未运行或修改旧测试，未提交或推送。

第十批验证完成：四模块 exit=0，宿主文件构建区间无并发变化，22 组声明与调用同步，候选之外源码与分派顺序完全相同。

| 模块 | 初次模块本体警告 | 第九批后 | 第十批后 |
| --- | ---: | ---: | ---: |
| core | 169 | 20 | **20** |
| host | 33 | 27 | **4** |
| cli | 8 | 4 | **4** |
| daemon | 17 | 7 | **7** |

按模块本体合计 **227→35**，累计消除 **192 条**警告。剩余分类（`remaining-classification.json`）如下：

| 分类 | 条数 | 后续边界 |
| --- | ---: | --- |
| 公开/包内查询或辅助接口未调用 | 14 | 要明确接入或弃用决定，不删除外部/包内接口来凑零值 |
| 生产骨架或预留功能契约 | 15 | 需要实际实现或产品范围裁决，不靠 `_` 参数掩盖缺口 |
| 模型摘要接口刻意不消费凭据 | 1 | 保留调用兼容和脱敏语义 |
| 自定义模型先建结构的导入接口 | 1 | 不擅自改变先建后补能力的策略 |
| 策略回调第二实参未消费 | 1 | 回调签名兼容保留 |
| CLI 内旧断言式自测续行 | 2 | 用户明确排除，继续不改 |
| 废弃 chdir | 1 | 需 SDK 平台兼容迁移方案，不编造替代 |

本批到此完成“纯内部冗余参数”的清理。剩余 35 条已经不是未使用导入或资源所有权写法问题，不能继续按同一种方式机械清理；后续需要对具体业务接口/平台迁移给出单项方案。

## 18. 第十一批：幂等准入判据接回唯一实现

逐个核对剩余生产入口及调用链后，确认 daemon 已有 `IdempotencyLedger.acceptsKey(operationId!: String)`，其实现只是 `operationId.size > Int64(0)`，没有 I/O、锁或其他副作用；而生产分派入口重复写了等价的非空判断。

仅修改 `apps/daemon/src/daemon.cj` 一处：把 `operationId.size == 0` 的拒绝条件改为 `!idempotencyLedger.acceptsKey(operationId: operationId)`。仍在认证和槽位准入之后、建键与摘要之前检查；错误码 `LEDGER_ERR_OPERATION_ID_REQUIRED`、错误文本和 finally 槽位归还均不变。未给账本新增字段或暴露管理接口，也没有改变 sanitize 规则。

证据目录：`apps/desktop/.tmp-test/takeover-20261011/syntax-warning-round11-20261013/`，含修改前基线、候选、`production-links.json` 的生产引用清单和串行构建记录。

### 最后公开接口的实际路径核对

| 项目 | 当前生产实现 / 调用路径 | 决定 |
| --- | --- | --- |
| `handleApprovalSetMode` / `handleApprovalGetMode` | `mode_rpc.cj` 的旧辅助函数；当前 main 实际调用 `approval_mode_rpc.cj`，写侧先取租约并 `setDurable`，严格校参数 | 不接旧 `ModeController.set` 辅助路径；否则会绕过已有持久化与参数闭集。该警告不是“审批模式入口未接” |
| `HostTeamRuntime.describe` | `team/describe` 经 request → TeamTools.execute → handle 的身份绑定检查 → panel | 不为消警告增加旁路或重复取得 team state；描述功能已有生产通路，公开便利接口仅未调用 |
| `rpcHeldBy` / `sseHeldBy` / `sseTotalHeld` | 限额查询；实际 acquire/release 已在认证后运行并按设备/实例阈值放行 | 不新增对外计数接口或泄露设备信息。查询未用不代表限额不工作 |
| `persistedFailureCount` / `size` | 幂等账内部持久失败与规模的公开查询 | 当前尚未被生产观测面消费，不编造诊断协议。需另定本地告警接入以及失败后响应策略 |
| `FileAuditSink.writtenCount` | 审计写入数量查询，append/flush 原生产路径仍工作 | 不改变审计返回值和失败门控，仅保留观测接口 |
| `webCooldownClear` | 当前 Web failover 通过 MonoTime 到期清除冷却；没有手工清除调用 | 不自动清零供应商冷却，以免改变现有重试/限流语义 |
| `goalMonotonicSeconds` | 未被采用的默认时钟工厂；GoalScheduler 现行构造要求调用方注入 clock | 不新增默认参数或改时钟来源，保留现有调度契约 |
| `sha256ToHex` | 包内旧转换助手；现行迁移摘要直接使用 `sha256Hex` | 不接回旧字符串字节索引实现。是否弃用包内助手需明确决定，本轮不动其外部/子包契约 |

以上核对仅基于生产源码，没有读取测试来推断能力。未调用的公开便利接口、观测查询和旧辅助路径与“实际功能缺失”分开记录；不一概删除或一概标完成。

仍需业务设计的真实缺口是 §11 的 ACP update/permission/elicitation 空入口、按 delegation 筛工单、slash 执行骨架、storage 回放消费以及 HTTP-date Retry-After。将这些补成实现会超出纯语法清理，特别是授权身份、持久化与回调关联不能靠给参数赋个用途解决。

第十一批实测四模块 exit=0，daemon 本模块警告 **7→6**，core/host/cli 本模块仍为 **20/4/4**。`acceptsKey` 未调用警告消除，候选之外内容相同，检查位置、错误响应和调用次序不变，修改文件构建期间无并发变化。

## 19. 最终全库生产复核与逐条处置

### 19.1 最终验证

在不继续扩大业务改动的前提下，重新枚举生产文件并执行完整生产构建和脚本解析，输出全部放到 `apps/desktop/.tmp-test/takeover-20261011/syntax-final-20261013/`。

| 范围 | 文件数 | 最终结果 |
| --- | ---: | --- |
| core | 174 | 生产构建 exit=0，20 warnings |
| host | 10 | 生产构建及链接 exit=0，本模块 4 warnings |
| CLI | 8 | 生产构建及链接 exit=0，本模块 4 warnings |
| daemon | 14 | 生产构建及链接 exit=0，本模块 6 warnings |
| JS/CJS/MJS | 92 | node --check 全部通过 |
| TS | 50 | 语法解析与真实 Vue 全局映射下的内存打包全部通过，warnings=0 |
| PowerShell | 2 | AST 解析无错误，不执行脚本 |
| CSS | 16 | 解析通过，warnings=0 |
| JSON | 5 | 解析通过 |

最终构建的开始/结束 HEAD 均为 `4d89a133556b16f69fcf978e48a77ca1e7693ecc`；**206 个生产仓颉文件构建前后哈希均相同**，脚本语法检查区间生产文件哈希亦无变化。这仍是混有未提交实现的当前工作区证据，不等于仅检出 HEAD 构建成功。

四模块本体警告合计 **34**，从原 227 累计消除 **193** 条。core 在三个入口构建时打印的依赖警告不重复纳入合计。最终日志再次确认无本次已消除的重复导入、Unicode 字面量、废弃默认 CPointerHandle、未用 import、生产续行或局部不可达资源诊断。

主目录未安装 Vue/esbuild 的环境限制保持不变；解析器仍只借已有 esbuild 0.28.2 工具，裸 Vue 打包仍报 37 个依赖解析错误。按项目实际 globalThis.Vue 映射的 50 入口打包正常，未把裸依赖失败混记为源码语法错误，也不声称完整 vendor/安装包构建通过。

### 19.2 chdir 兼容结论

再次按技能脚本查询 `chdir`、`LibC chdir`、`setWorkingDirectory`、`setCurrentDirectory`，没有取得受支持的替代签名；读取 `std.env` 活动成员表，只确认 `getWorkingDirectory`，没有设置 cwd 方法。本机 1.1.3 SDK 包含 std.posix 编译模块和库，但没有可用于本轮核验的替代源码资料。

因此不以“没有检索结果”断言语言永远没有替代实现，也不引入未经平台契约和运行核验的 Windows FFI，继续保留现行 `chdir`。迁移必须另定 Unicode 路径、失败归因、进程全局 cwd、启动目录冻结和非 Windows 拒绝/适配策略，不能只为消一条废弃警告增加平台副作用。

### 19.3 最终 34 条的处置清单

下列均为最终生产编译诊断位置；旧 CLI 内自测仅依据编译诊断登记，不读取或修改正文。没有关闭告警或用 `_` 隐藏功能缺口。

| # | 位置 | 诊断对象 | 处置与理由 |
| ---: | --- | --- | --- |
| 1 | `core/src/web_search_service.cj:35` | webCooldownClear | 保留冷却控制接口；生产按到期释放，不改重试语义 |
| 2 | `core/src/goal_scheduler.cj:40` | goalMonotonicSeconds | 保留时钟工厂；生产 clock 由调用方注入 |
| 3–4 | `core/src/storage.cj:68` | key、value | 回放接口未消费载荷；需明确存储契约，不新增第二真源 |
| 5 | `core/src/model_catalog.cj:94` | apiKey | 摘要刻意不消费凭据；保留公开签名与脱敏 |
| 6 | `core/src/acp_approval_bridge.cj:105` | delegationId | 工单计数尚未按委派过滤；身份/状态关联需要业务修正 |
| 7 | `core/src/schedule.cj:109` | deliveryId | 尚未进入 ScheduleFire 载荷；需事件/去重规格 |
| 8 | `core/src/transport_failure.cj:143` | nowEpoch | HTTP-date Retry-After 未实现，当前保留秒数处理 |
| 9 | `core/src/agent.cj:286` | executeReview 的 args | 真实 review 执行骨架待实现 |
| 10 | `core/src/agent.cj:292` | executeCompress 的 args | 真实压缩执行骨架待实现 |
| 11 | `core/src/agent.cj:297` | executeInit 的 args | 真实初始化执行骨架待实现 |
| 12–13 | `core/src/acp_delegation.cj:317` | onUpdate 的 id、block | 委派更新回调为空；需绑定日志与内容路由 |
| 14–15 | `core/src/acp_delegation.cj:322` | onPermissionRequest 的 id、request | 当前默认拒绝；需请求身份与工单往返设计，不能伪放行 |
| 16–18 | `core/src/acp_delegation.cj:328` | onElicitation 的 id、requestId、fields | 回调为空；需关联请求、载荷与回复 |
| 19 | `core/src/custom_model_registry.cj:443` | providers | 保留先建结构后补能力策略，不增加新的导入拒绝 |
| 20 | `core/src/migration_pack.cj:911` | sha256ToHex | 旧包内助手待弃用决定；现行摘要用 sha256Hex，不误接旧实现 |
| 21 | `apps/host/src/mode_rpc.cj:6` | handleApprovalSetMode | 保留旧公开助手；禁止接回未持久化 set 路径 |
| 22–23 | `apps/host/src/mode_rpc.cj:14` | handleApprovalGetMode、_payload | 实际协议走 approval_mode_rpc；不新增旁路 |
| 24 | `apps/host/src/team_runtime.cj:333` | describe | 生产描述通过 TeamTools 身份管线已接通；保留便利接口 |
| 25–26 | `apps/cli/src/main.cj:977,981` | 旧自测续行 | 用户明确排除，不修改 |
| 27 | `apps/cli/src/worktree_command.cj:712` | chdir 废弃 | 保留兼容；需要独立平台迁移方案 |
| 28 | `apps/cli/src/goal_runtime.cj:56` | policyGuard 的 args | 保留工具 guard 两实参签名，不改管线 |
| 29 | `apps/daemon/src/remote_limits.cj:106` | rpcHeldBy | 保留观测查询；限额 acquire/release 已在生产调用 |
| 30 | `apps/daemon/src/remote_limits.cj:113` | sseHeldBy | 保留观测查询，不新增设备信息公开面 |
| 31 | `apps/daemon/src/idempotency.cj:120` | persistedFailureCount | 持久失败尚未接观测；另定告警与响应策略 |
| 32 | `apps/daemon/src/remote_limits.cj:120` | sseTotalHeld | 保留实例观测查询，不擅改管理协议 |
| 33 | `apps/daemon/src/remote_access.cj:166` | writtenCount | 保留审计计数查询，append 失败门控不变 |
| 34 | `apps/daemon/src/idempotency.cj:291` | size | 保留幂等账规模观测，不删公共接口 |

逐条 JSON/Markdown 证据为 `remaining-disposition.json` / `remaining-disposition.md`；最终构建与全体哈希在 `final-build-verification.json`，脚本解析在 `script-results.json`，资源与配置解析在 `powershell-results.json`、`assets-results.json`。

### 19.4 收口边界

当前没有证实的阻断语法/类型/链接错误，且可保持原行为的清理已完成。**“有 34 个编译警告”不等于“有 34 个功能故障”；预留观测方法与实际生产骨架也不能混为一类。**

继续修改必须选择具体业务缺口、公共接口弃用或平台迁移目标；“全库语法修正”本身不授权把所有骨架补成产品，也不授权删 API 达成零警告。下一批建议针对 ACP 工单归属计数单独设计，先确定工单终态、超时、撤销及委派生命周期，再在唯一审批真源上实现。

此次最终复核没有新增生产改动，没有安装依赖、触发真实请求、运行旧测试、操作用户数据或停止其他会话进程。已有十一批改动与报告仍未暂存、未提交、未推送；共享文件不应整文件提交。

## 20. 用户授权提交时的归属拆分与 Linux 配置补充

用户随后明确要求提交并推送本批修复。提交候选从每个文件的最早修正基线提取本会话增量，三方合并到当前 HEAD；工作区源码不覆盖，真实暂存区先保持为空，用私有索引审阅差异。

### 20.1 不夹带其他工作线

- `core/src/appcontainer_win.cj` 整文件尚未入库，不能为了本会话句柄修正代提交其他作者的完整 AppContainer 实现。该局部修正仍保留工作区，待原作者提交后再取差异。
- `core/src/ptc_exec.cj` 的 import 清理依赖其他作者的未提交新执行器；HEAD 旧执行器仍调用 ArrayList。该 import 清理暂不提交，未回退工作区。
- `apps/host/src/main.cj` 的 22 个 handleRpc 参数精简依赖其他作者未提交的 HostRuntime 重构。提交候选保留 HEAD 单体主循环，只纳入租约所有权帮助对象和无参 main 的局部修正；22 个参数修正留在工作区。
- `core/src/agent.cj` 与其他作者切换 nativeReplaceFile 的同点改动冲突。提交候选只修文件实际关闭状态和临时路径回收，保留 HEAD 现有 rename 路径，不代提交原生替换切换。这意味着工作区原生替换的验收不能当成提交候选的运行验收。
- 其余 49 个生产文件的候选无合并冲突；加上宿主与 agent 局部适配，共 **51 个生产源码候选**。测试、构建产物、用户数据、其他文档和 Git 写功能均不纳入。

原“34 warnings”是完整工作区结果；归属拆分后候选可能包含更多旧接口/旧实现警告，必须单独核验，不把工作区计数冒称提交态计数。

### 20.2 Linux stdx 依赖

用户补充 Linux `cjpm build` 找不到 `stdx.crypto.common`。官方 CJPM 文档明确 `target.*.bin-dependencies.path-option` 支持 `${ENV}`；本机 **1.1.3** 私有生产模块使用 `path-option = ["${SACODE_STDX_LIB_DIR}"]` 并导入 `stdx.crypto.common`，环境变量实际被展开，编译及链接成功。

在 core、host、cli、daemon 的配置中新增 `x86_64-unknown-linux-gnu` 与 `aarch64-unknown-linux-gnu` 目标，读取 `SACODE_STDX_LIB_DIR`，指向匹配 SDK 1.1.3 的 stdx 1.1.3.1 Linux 对应架构 `dynamic/stdx` 目录。无需只孤立添加 crypto.common；同目录其他扩展库共同解析。用法见 [`../build-linux.md`](../build-linux.md)。

提交配置只从 HEAD 追加 Linux 目标，不夹带其他作者正在做的 Windows `.deps` 路径迁移；工作区现有 Windows 路径不改。环境变量插值已在 Windows 本机 1.1.3 实测，但当前没有 Linux SDK/编译产物，不能宣称 Linux 四模块通过。该修改仅补缺失的依赖路径，Linux 的原生平台分支仍需单独验收。

候选验证目录：`apps/desktop/.tmp-test/takeover-20261011/syntax-commit-20261013/`，包括最早基线、HEAD、副本候选、私有索引差异，以及不导出旧测试的生产源码快照和候选构建记录。

### 20.3 归属拆分后的候选构建（不可借工作区绿色）

生产快照从私有索引导出，不读取或导出旧测试；四份配置使用 HEAD Windows 路径加本次 Linux 目标。`compiled-input-check.json` 核对 **51 份源码 + 4 份配置**均与审阅候选字节一致。

| 模块 | 候选结果 | 与完整工作区结果的区别 |
| --- | --- | --- |
| core | **exit=0**，21 warnings | 不含他人未入库 AppContainer/执行器源码，警告不与工作区 20 混报 |
| CLI | **exit=0**，core 依赖 21 + 本模块 4 warnings | 候选源码实际编译与链接成功 |
| host | **超时，exit=null / SIGTERM** | HEAD 仍是大体量单体 main；不纳入他人 HostRuntime 重构。不能宣称候选宿主通过，也未证实超时就是某一已知编译器问题 |
| daemon | **exit=1** | HEAD 既有 `apps/daemon/src/scheduler.cj:51` 写成 `TaskDefinition?`，编译报 expected ';' or '<NL>', found '?'；该文件在工作区被其他会话删除，候选未包含删除，所以完整工作区绿色不能覆盖这个结果 |

宿主超时后仅结束本会话的私有 `syntax-commit-20261013/snapshot/apps/host/src` 编译子进程，未终止其他会话构建。daemon 的调度文件既有问题单独交接，不为收口本次修复擅自提交其他作者的源码删除，也不恢复或覆盖工作区删除状态。

**候选验证是部分通过，不是四模块全绿。**按用户明确“提交并推送修复”的授权提交已归属的增量，同时保留上述阻碍和暂缓项，不跳 Git hooks、不掩盖失败、不把旧工作区证据当提交态验收。Linux 环境依赖配置通过 TOML 与本机插值检查，但仍未实际在 Linux 编译。
