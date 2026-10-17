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
