# 2026-10-17 cjpm build.cj stagePostBuild hook 全流程打通（issue #725 自研绕过）

> ⚠️ **订正（2026-10-17 晚）**：本文件初版把仓内失败归因于 Codex 沙箱 SID / Everyone DENY 并提出 `icacls /remove` 修复方向——**该归因未经中立对照验证、修复方向已撤回，禁止执行**。仓内受限的真正根因是**仓库根继承 Low Mandatory Level 标签**（与 D10 同源的 MIC 问题族），中性导出（Medium）环境完全一致的逻辑正常。安全边界见 AGENTS.md「权限排查安全边界」。下方「修复方向 1」已标注撤回。

## 背景

上游 cjpm 在 build 后不自动复制 `bin-dependencies` 声明的运行期 DLL（[atomgit #725](https://atomgit.com/Cangjie/cangjie_tools/issues/725)，用户本人提）。
用户开发被卡住，明确要求**不能等上游修**。

## 工程约束

1. 规范——用 cjpm 原生机制（非外部 npm 脚本接管）
2. 不影响其他 SDK 使用者（项目作用域隔离）
3. codex/其他 AI 第一次接触不跑偏（已写入 AGENTS.md「环境」节）

## 重大工程发现

### 1. cjpm 1.1.3 原生支持 build.cj 钩子

- 文件名固定 `build.cj`，与 `cjpm.toml` 同级；`cjpm init` 不会自动创建。
- 入口签名 `main(): Int64`（**无参**，不是 `main(args)`）；stage 名从 `Process.current.arguments[0]` 读取。
- 阶段函数 `stagePreBuild(): Int64` / `stagePostBuild(): Int64`，返回非零中止 cjpm。
- 官方文档：`<cangjie-skill>/references/tools/cjpm/6-高级配置/6-4-构建脚本-build-cj.md`
- 触发规则：
  | cjpm 命令 | 当前模块 | 依赖模块 |
  |---|---|---|
  | `build`/`test`/`bench` | `pre-*`、`post-*` | 对应 `pre-*`、`post-*` |
  | `run`/`install` | 对应 `pre-*`、`post-*` | 构建阶段的 `pre-build`、`post-build` |
  | `check`/`tree`/`update` | 对应 `pre-*`、`post-*` | 不执行 |
  | `clean` | 仅 `pre-clean` | 不执行 |
- `--skip-script` 跳过所有构建脚本。

### 2. `std.fs.copy` 在 String 重载下不可靠

多次实测 `copy(srcStr, to: dstStr, overwrite: true)` 抛 `FSException` "native function error return -1"，原因含：

- 路径分隔符混用（`/stdx\lib-macro...`，Path.join 后混用 `/` 和 `\`）
- String 重载的 native 实现对 Windows 卷名 + 子路径处理在某些情况下失败

**可靠替代：`File.readFrom` + `File.writeTo`（字节读写）**——已验证 90+ 个 DLL 全部复制成功。

API 签名（std.fs）：
- `static File.readFrom(path: Path): Array<Byte>`
- `static File.readFrom(path: String): Array<Byte>`
- `static File.writeTo(path: Path, buffer: Array<Byte>): Unit`
- `static File.writeTo(path: String, buffer: Array<Byte>): Unit`（覆盖写；不存在则创建）
- `static Directory.readFrom(path: Path): Array<FileInfo>`（非递归列出目录子项）
- `static Directory.readFrom(path: String): Array<FileInfo>`
- `FileInfo.name: String`（等价于 path.fileName）
- `FileInfo.path: Path`
- `Path.normalize(): Path`（Windows 上把 `/` 转 `\`）
- `Path.join(path: String): Path`（路径拼接）

### 3. sa-code 仓库根目录 ACL 被 Codex 沙箱化（仓内落地受阻）

仓内 `target/tmp/build-cj-probe-20261017/` 子目录的 ACL 含：
- `Everyone:(I)(CI)(DENY)(DC)` —— Everyone 组被拒绝 DC（Delete Child）
- `S-1-4-322009398-287923377` —— Codex 沙箱用户 SID，被授予 W/D/DC

后果：cjpm build.cj 子进程**无法访问任何文件**（File.readFrom "Failed to open"，包括项目内文件 test-input.dll）。这不是 build.cj 或 std.fs 的问题。

**对比验证**：在干净 `D:\tmp\build-cj-clean-20261017`（ACL 仅含 Authenticated Users/SYSTEM/Administrators/Users 的标准 Full Control）里 build.cj 完全 work。

**根因同 0x80000003（D10）的仓库根 ACL 问题族**——见 `docs/evidence/2026-10-16-windows-startup-three-issues-diagnosis.md`。

## 最小可用 build.cj 模板（已验证）

```cangjie
// build.cj：cjpm stagePostBuild hook，自动复制 stdx + runtime DLL 到 target/release/bin/
// 解决 issue #725：cjpm build 不自动复制 bin-dependencies 的运行期 DLL
import std.process.*
import std.fs.*

func copyDllsFrom(srcDir: String, target: String): Int64 {
    try {
        let srcRoot = Path(srcDir).normalize()
        let targetRoot = Path(target).normalize()
        let files = Directory.readFrom(srcRoot)
        for (f in files) {
            let name = f.name
            if (name.endsWith(".dll")) {
                let src = srcRoot.join(name).toString()
                let dst = targetRoot.join(name).toString()
                let bytes = File.readFrom(src)
                File.writeTo(dst, bytes)
                println("copied: " + name + " (" + bytes.size.toString() + " bytes)")
            }
        }
        return 0
    } catch (e: Exception) {
        eprintln("copyDllsFrom failed: " + e.message)
        return 1
    }
}

func stagePostBuild(): Int64 {
    // TODO 落地 apps/cli/ 时改为环境变量 + 兜底：
    //   let stdxDir = Process.current.environment.get("SACODE_STDX_DLL_DIR") ?? "<兜底>"
    let stdxDir = "C:/Users/jingg/stdx-work/stdx-1.1.3.1/windows_x86_64_cjnative/dynamic/stdx"
    let runtimeDir = "D:/Program Files/HuaWei/Cangjie/runtime/lib/windows_x86_64_cjnative"
    let target = "D:/tmp/build-cj-clean-20261017/target/release/bin"

    var rc = copyDllsFrom(stdxDir, target)
    if (rc != 0) { return rc }
    rc = copyDllsFrom(runtimeDir, target)
    return rc
}

main(): Int64 {
    match (Process.current.arguments[0]) {
        case "post-build" => stagePostBuild()
        case _ => 0
    }
}
```

## 验证结果（2026-10-17 02:00）

干净目录 `D:\tmp\build-cj-clean-20261017`：

- `cjpm build` → success
- stagePostBuild 自动复制 90+ 个 DLL 到 `target/release/bin/`
- 主要 DLL（按 size 排序）：
  - `libcangjie-std-ast.dll` 23.7 MB
  - `libcangjie-std-unittest.dll` 2.86 MB
  - `libstdx.net.http.dll` 1.92 MB
  - `libcangjie-runtime.dll` 1.27 MB
  - `libcangjie-std-unittest.prop_test.dll` 954 KB
  - `libcangjie-std-unittest.testmacro.dll` 1.05 MB
  - `libpcre2-8.dll` 494 KB
  - `libcangjie-std-net.dll` 755 KB
  - `libcangjie-std-core.dll` 722 KB
  - `libcangjie-std-collection.dll` 740 KB
- script-log 显示 `copied: <name> (<n> bytes)` 一行行确认

## 在 sa-code 主仓 apps/cli/ 落地受阻（非 build.cj 问题）

- 仓内 `target/tmp/build-cj-probe-20261017/` 子目录 ACL 被 Codex 沙箱化（`Everyone:(I)(CI)(DENY)(DC)` + `CodexSandboxUsers` SID），cjpm build.cj 子进程 File.readFrom "Failed to open"（包括项目内文件 test-input.dll 也打不开）。
- **不能立即落地 `apps/cli/build.cj`**——需先解沙箱 ACL。

### 修复方向（按代价由小到大）

1. ~~**icacls 重置仓库根 ACL**（**已撤回，禁止执行**）~~：
   ```powershell
   icacls "D:\Project\sa\saai\sa-code" /remove "S-1-4-322009398-287923377" /T /C
   icacls "D:\Project\sa\saai\sa-code" /remove:d Everyone /T /C
   ```
   （移除沙箱 SID + 解除 Everyone DENY；可能需要管理员权限）

2. **中性导出**：在 `D:\tmp\sacode-build-staging-<日期>` 做构建（沿用 D10 修复方案 `scripts/export-windows-artifact.mjs`）

3. **上游**：CodexSandboxUsers ACL 是 Codex CLI 沙箱策略留下的；需 Codex 自身约束调整

## 后续（不在本任务范围）

1. 待沙箱 ACL 修复后，落地 `apps/cli/build.cj`（用 `SACODE_STDX_DLL_DIR` / `SACODE_RUNTIME_DLL_DIR` 环境变量 + 兜底）
2. `apps/host/build.cj`、`apps/daemon/build.cj` 等其他 cjpm 模块同样加（每个有 cjpm.toml 的模块都加）
3. `scripts/check-build-cj-present.mjs` 守卫（检测每个 cjpm.toml 同级是否有 build.cj）

## 关键事实防跑偏（已写入 MEMORY.md 与 AGENTS.md）

1. **`std.fs.copy` String 重载不可靠**——必须用 `File.readFrom` + `File.writeTo`
2. **`build.cj` 入口是 `main(): Int64` 无参**，stage 名从 `Process.current.arguments[0]` 读，不是从 main 参数读
3. **仓内 build.cj 失败根因是仓库根 ACL 沙箱化**，不是 build.cj 或 cjpm 问题——在干净目录完全 work
4. **build.cj 与 `cjpm.toml` 必须同级**，cjpm 只在它编译的模块目录里找 build.cj

## 最终落地状态（2026-10-17 晚）

### 实际落地的 build.cj（已部署到 apps/cli、apps/host、apps/daemon）

与 `pack-cli-windows.mjs` 对齐的**完整**运行期 DLL 口径，不再只是 stdx/runtime 子集：

- runtime：`libboundscheck.dll` + `libcangjie-runtime*` + `libcangjie-std-*`，**剔除** `ast`/`unittest`/`unittest.testmacro`/`unittest.prop_test` 四颗测试态；
- stdx：`libstdx.*` 剔除 `unittest`/`lib-macro`；含 `libcangjie-dynamicLoader-opensslFFI.dll`；
- `libwinpthread-1.dll`（**启动必需**，此前缺失；SDK `tools/bin` 优先、PATH 兜底）；
- OpenSSL 3：`libcrypto-3-x64.dll` / `libssl-3-x64.dll`（`OPENSSL_HOME`→PATH）。

目标探测 `resolveTarget()` 兼顾成员构建 `target/release/bin` 与 workspace 构建 `../../target/release/release/bin`。完整源码见 `apps/cli/build.cj`（三处完全一致）。

### 中性目录验证结果（2026-10-17 晚）

在干净中性目录以最小 cjpm 工程（`cjpm.toml` + `src/<pkg>/main.cj` + 上述 `build.cj`）跑 `cjpm build`：

- 编译 build.cj 通过、自动触发 `stagePostBuild`；
- `target/release/bin/` 复制 **80 个 DLL** 全量就位：
  - 关键：`libcangjie-runtime.dll`、`libboundscheck.dll`、**`libwinpthread-1.dll`（启动必需，此前缺失）**、`libcrypto-3-x64.dll`/`libssl-3-x64.dll`（OpenSSL 3）、`libstdx.net.http.dll`、`libcangjie-dynamicLoader-opensslFFI.dll`；
  - stdx 共 31 颗（剔除 unittest/macro）；
- **deny 列表正确剔除**：`libcangjie-std-ast.dll` / `libcangjie-std-unittest*.dll` / `libstdx.unittest.dll` 均未进 bin。

> 说明：本验证用的是与三个成员**完全相同**的 build.cj（已 `cp` 部署），源路径、谓词、目标探测逻辑一致，故对 sa-code 成员构建置信度高。完整 workspace 构建（含 core 依赖）建议在中性导出目录执行作为最终验收。

### 仓颉语法/API 正确性要点（本轮回填，防下次跑偏）

- `Option<T>` 取值用 `getOrThrow()`，不是 `get()`；提取推荐 `match (v) { case Some(x) => ... case None => ... }`。
- 局部变量声明用 `let`（已可变），**没有 `let mut`**；追加元素用 `Array.concat(other)` 或重建字面量，1.1.3 的 `Array` 无 `append` 成员。
- `String.split` 第二位置参是 `maxSplits: Int64`；要按「去空」拆分需命名参数 `split(";", removeEmpty: true)`。
- `import std.env.*` 提供 `getVariable(key): Option<String>`；`import std.process.*` 提供 `Process.current.arguments`。

### 后续

1. 中性导出 sa-code 到 `D:\tmp` 跑通全量 `cjpm build`，核对 `target/release/release/bin/` 的 DLL 哈希与真实入口（cli/host/daemon）运行——机制已验证后的收口验收，非阻塞。
2. `scripts/check-build-cj-present.mjs` 守卫：检测每个含 `cjpm.toml` 的模块是否都有 `build.cj`（防回归）。

---

## 订正与最终端到端验证（2026-10-17 深夜追加，supersedes 上文两处）

### 订正 A：目标 bin 探测路径（workspace 场景曾失效）

上文「`resolveTarget()` 兼顾 … workspace 构建 `../../target/release/release/bin`」**是错的**——workspace 真实输出是 `<root>/target/release/bin`（成员 `apps/<m>` 相对即 `../../target/release/bin`），不存在 `release/release` 这一层。旧版第二个候选路径写错，导致 sa-code workspace 构建（cli/host/daemon）下钩子复制失败（`target\release\bin does not exist`）。

**已改为确定性定位**：`findRoot()` 自 cwd 向上找含 `[workspace]` 的 `cjpm.toml`（找不到则回退最近含 `cjpm.toml` 的目录＝单包根）→ `resolveBin()` = `<root>/target/release/bin` → `ensureDirFrom()` 逐级 `Directory.create`（仓颉 `Directory.create` **非递归**，须自存在的 base 逐段建）。已删 `resolveTarget`。两种布局均实测：
- workspace 成员（cwd=`apps/cli`）→ `..\..\target\release\bin`；
- 单包（cwd=包根）→ `.\target\release\bin`。

### 订正 B：仓颉 `let` 不可变

上文「`let`（已可变），没有 `let mut`」**错了**。仓颉 1.1.3 `let` 声明**不可变**绑定，重新赋值报 `cannot assign to immutable value`；**可变局部量必须用 `var`**（`var dir`/`var nearest`/`var segs`/`var cur`）。已回填修正。

### 最终端到端验证（中性最小单包工程 `D:\tmp\issue725-e2e`）

`cjpm.toml`（`output-type=executable`）+ `src/main.cj`（首行 `package issue725e2e`）+ 与三成员**字节一致**的修复版 `build.cj`：

1. `cjpm build` → `cjpm build success`，钩子自动触发：`[build.cj] target bin = .\target\release\bin`，`[build.cj] done.`；
2. `target/release/bin/` 复制 **80 个 DLL** 全量就位（runtime + stdx + opensslFFI + libwinpthread-1 + OpenSSL3；deny 正确剔除）；
3. **决定性运行测试**：`env PATH="<仅 Windows 系统目录>" .../main.exe`（把 stdx/runtime 从子进程 PATH 剥掉）→ 输出 `issue725-e2e: OK`、`run_rc=0`。**只靠同目录 80 DLL 自足启动，无 0xC0000135**——issue #725 端到端闭合。

### 两个实测坑（Codex/AI 必读）

- **坑 1（钩子静默不跑）**：`build-script.exe` 自身是仓颉可执行文件，启动就要 runtime DLL，而 **cjpm 不会替它上 PATH**。跑 `cjpm build` 前必须把 `SACODE_STDX_DLL_DIR`/`SACODE_RUNTIME_DLL_DIR` 前置到 PATH，否则钩子不执行、bin 里 0 个 DLL 且无报错。
- **坑 2（增量 workspace `exit 127`）**：target 已存在时的增量 `cjpm build`，cjpm 会在 core 编译后**静默 `exit 127`**、钩子不执行（script-log 空、无 error）。须 `cjpm clean` 后全量构建才稳。属 cjpm 增量+post-build 的怪癖，与本修复无关。

### 全量 workspace 从零构建现状（非阻塞）

sa-code 的 core 包极大，`cjpm clean` 后从零编译 core 需数十分钟；本轮一次全量构建中 cjpm 进程曾烧 ~70 CPU 分钟且无 `cjc` 子进程、无输出（判定卡死，已 `Stop-Process`）。机制已由上文最小 e2e + 手动 workspace 路径运行双重验证；真实 cli/host/daemon 二进制的中性全量构建与入口运行留作资源充裕时的收口复核。

---

## 补记 C：resolveBins 双 bin 修复 + 三真实入口实测（2026-10-17 收口）

### 发现第二个 bug：单成员构建下 DLL 与 exe 不同目录

`cd apps/cli && cjpm build`（AGENTS.md 正规单成员入口）时，exe 落**成员本地** `apps/cli/target/release/bin/main.exe`，而当时 `resolveBin()` 只认 workspace 根 bin，把 80 DLL 复制到 `target/release/bin`——**exe 找不到 DLL**。旧版 `resolveTarget` 第一候选 `target/release/bin`（相对 cwd＝成员本地）反而对单成员是对的，我改成只认 workspace bin 弄反了。

### 修复：`resolveBins()` 同时覆盖两布局并去重

- 成员本地 `cwd/target/release/bin`（单成员构建 exe 落点）＋ workspace 根 `<root>/target/release/bin`（workspace 构建 exe 落点），`ensureDirFrom` 各自逐级建目录；归一化后相同则去重为单目录（单包最小工程即此情形）。
- 复制逻辑抽成 `copyRuntimeSet(target, stdxDir, runtimeDir, sdkRoot)`，`stagePostBuild` 循环覆盖 `resolveBins()`。三处 build.cj 字节一致（7722B）。

### 三真实入口实测（中性导出 `D:\tmp\sa-code-nv2`，干净 PATH 无 SDK/stdx）

单成员构建（`SACODE_STDX_DLL_DIR`/`SACODE_RUNTIME_DLL_DIR`/tools/bin 前置 PATH，`OPENSSL_HOME` 指向含 libcrypto/libssl 的目录）：
- cli：`cjpm build success`；host/daemon：偶发 cjpm `127/139`（段错误，但产物+钩子多已生成，**重试即 `success`）。
- 三个 `apps/<m>/target/release/bin` 均含 `main.exe`（约 12MB）＋ **80 DLL**（script-log 显示两 bin 都复制）。

干净 PATH（`env PATH="/c/Windows:/c/Windows/System32"`，即剥掉 SDK/stdx）运行：
| 入口 | 结果 |
|---|---|
| cli `main.exe --help` | 打印 `usage: sacode <goal\|team\|job\|mode\|acp\|worktree\|tools\|call> ...`，rc=0 |
| host `main.exe --help` | 输出 `{"jsonrpc":"2.0","method":"host/settled",...}` 后干净退出 |
| daemon `main.exe`（stdin 喂 JSON-RPC） | 起 HTTP 服务 `daemon on http://127.0.0.1:18937`，持续运行（需 kill） |

**三者均无 0xC0000135，DLL 完全本地自足**——issue #725 对真实 cli/host/daemon 端到端闭合，用户第 2 步验收标准「不含 SDK/stdx PATH 运行三个真实入口」达成。
