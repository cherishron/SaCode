// build.cj: cjpm stagePostBuild hook.
// Fixes upstream cjpm not copying bin-dependencies' runtime DLLs (issue #725):
// after a successful build, copy the full Cangjie runtime DLL set into the
// build-output bin/ so the freshly built binary is directly runnable
// (no 0xC0000135 STATUS_DLL_NOT_FOUND at startup).
//
// 路径一律「环境变量优先，仓库布局与旧本机路径兜底」：
//   SACODE_STDX_DLL_DIR      stdx 动态库目录（优先）
//   SACODE_STDX_LIB_DIR      编译期 stdx 目录；Windows 发行布局里与 DLL 同目录
//   SACODE_RUNTIME_DLL_DIR   仓颉运行期库目录
//   CANGJIE_HOME             SDK 根目录（runtime/lib 与 tools/bin 都由它派生）
// 源目录不存在时只 WARN 并继续：钩子不能把「换一台机器」变成链接成功后的构建失败。
// 真正的 IO 错误（目录在但读不了）仍然返回非 0。
//
// 输出 bin 同时支持两种布局：
//   (a) 单成员 `cd apps/<m> && cjpm build` → cwd/target/release/bin
//   (b) 工作区根 `cjpm build`            → <root>/target/release/bin
// 以及 build-platform.mjs 使用的 `cjpm build --target-dir <dir>`：钩子拿不到
// 命令行参数，由 SACODE_BUILD_TARGET_DIR 传入，递归找本轮 main.exe 所在目录。
import std.process.*
import std.fs.*
import std.env.*
import std.collection.ArrayList

// Runtime libs that are test/compile-time only and must NOT ship.
let RUNTIME_DENY: Array<String> = [
  "libcangjie-std-ast.dll",
  "libcangjie-std-unittest.dll",
  "libcangjie-std-unittest.testmacro.dll",
  "libcangjie-std-unittest.prop_test.dll"
]

func isRuntimeDenied(name: String): Bool {
  for (d in RUNTIME_DENY) {
    if (d == name) { return true }
  }
  return false
}

func isStdxDenied(name: String): Bool {
  return name.startsWith("libstdx.unittest") || name.startsWith("lib-macro")
}

func runtimePredicate(name: String): Bool {
  if (name == "libboundscheck.dll") { return true }
  if (name.startsWith("libcangjie-runtime")) { return true }
  if (name.startsWith("libcangjie-std-")) { return !isRuntimeDenied(name) }
  return false
}

func stdxPredicate(name: String): Bool {
  return name.startsWith("libstdx") && !isStdxDenied(name)
}

// Copy every .dll in srcDir whose name passes `predicate` into dstDir.
// 缺失目录是「本机没装/CI 没铺」而不是构建逻辑失败：WARN 后继续。
func copyIfDll(srcDir: String, dstDir: String, predicate: (String) -> Bool): Int64 {
  if (srcDir.isEmpty() || !exists(srcDir)) {
    eprintln("WARN: DLL source dir missing, skip: " + (if (srcDir.isEmpty()) { "<unresolved>" } else { srcDir }))
    return 0
  }
  try {
    let src = Path(srcDir).normalize()
    let dst = Path(dstDir).normalize()
    let files = Directory.readFrom(src)
    for (f in files) {
      let name = f.name
      if (name.endsWith(".dll") && predicate(name)) {
        let bytes = File.readFrom(src.join(name).toString())
        File.writeTo(dst.join(name).toString(), bytes)
      }
    }
    return 0
  } catch (e: Exception) {
    eprintln("copyIfDll failed for " + srcDir + ": " + e.message)
    return 1
  }
}

// Best-effort copy of one named dll from the first dir that contains it.
func copyNamedFrom(dirs: Array<String>, name: String, dstDir: String): Bool {
  for (d in dirs) {
    if (d.isEmpty()) { continue }
    let src = Path(d).normalize().join(name).toString()
    try {
      let bytes = File.readFrom(src)
      File.writeTo(Path(dstDir).normalize().join(name).toString(), bytes)
      println("  + " + name + " <- " + d)
      return true
    } catch (e: Exception) { }
  }
  return false
}

// SDK third-party / tools dirs that may provide the MinGW pthread runtime.
func mingwSources(sdkRoot: String): Array<String> {
  let r: Array<String> = [
    Path(sdkRoot).join("tools").join("bin").toString(),
    Path(sdkRoot).join("third_party").join("llvm").join("bin").toString(),
    Path(sdkRoot).join("third_party").join("mingw").join("lib").toString()
  ]
  return r
}

func splitPath(v: Option<String>): Array<String> {
  match (v) {
    case Some(s) => s.split(";", removeEmpty: true)
    case None => Array<String>()
  }
}

func pathDirs(): Array<String> {
  return splitPath(getVariable("PATH")).concat(splitPath(getVariable("Path")))
}

// Read a file as UTF-8 text; "" on any error (also covers non-existence).
func readText(path: String): String {
  try {
    return String.fromUtf8(File.readFrom(path))
  } catch (e: Exception) {
    return ""
  }
}

// Walk up from cwd to find the workspace root: the nearest ancestor whose
// cjpm.toml contains "[workspace]". Falls back to the nearest cjpm.toml dir
// (single-package build) or cwd.
func findRoot(): String {
  var dir = "."
  var nearest = "."
  for (i in 0..8) {
    let toml = Path(dir).join("cjpm.toml").toString()
    if (readText(toml).contains("[workspace]")) {
      return Path(dir).normalize().toString()
    }
    if (!readText(toml).isEmpty()) {
      nearest = dir
    }
    dir = Path(dir).join("..").toString()
  }
  return Path(nearest).normalize().toString()
}

// Create `base/rel` one segment at a time (Directory.create is non-recursive).
func ensureDirFrom(base: String, rel: String): Unit {
  var segs: Array<String> = []
  for (seg in rel.split("/")) {
    for (x in seg.split("\\")) {
      if (!x.isEmpty()) { segs = segs.concat([x]) }
    }
  }
  var cur = Path(base).normalize().toString()
  for (s in segs) {
    cur = Path(cur).join(s).toString()
    try {
      Directory.create(cur)
    } catch (e: Exception) { }
  }
}

func pickExistingDir(candidates: Array<String>): String {
  for (c in candidates) {
    if (!c.isEmpty() && exists(c) && FileInfo(c).isDirectory()) {
      return c
    }
  }
  return ""
}

func resolveSdkRoot(): String {
  let fromEnv = getVariable("CANGJIE_HOME") ?? ""
  if (!fromEnv.isEmpty() && exists(fromEnv)) {
    return fromEnv
  }
  return "D:/Program Files/HuaWei/Cangjie"
}

// stdx 的 Windows 发行布局是 windows_x86_64_cjnative/dynamic/stdx；
// SACODE_STDX_LIB_DIR 在 Windows CI 上正是指向这里（编译接口与 DLL 同目录）。
func resolveStdxDir(root: String): String {
  return pickExistingDir([
    getVariable("SACODE_STDX_DLL_DIR") ?? "",
    getVariable("SACODE_STDX_LIB_DIR") ?? "",
    Path(root).join(".deps").join("stdx").join("windows_x86_64_cjnative").join("dynamic").join("stdx").toString(),
    "C:/Users/jingg/stdx-work/stdx-1.1.3.1/windows_x86_64_cjnative/dynamic/stdx"
  ])
}

func resolveRuntimeDir(sdkRoot: String): String {
  return pickExistingDir([
    getVariable("SACODE_RUNTIME_DLL_DIR") ?? "",
    Path(sdkRoot).join("runtime").join("lib").join("windows_x86_64_cjnative").toString(),
    "D:/Program Files/HuaWei/Cangjie/runtime/lib/windows_x86_64_cjnative"
  ])
}

func sameDir(a: String, b: String): Bool {
  return Path(a).normalize().toString().toAsciiLower() == Path(b).normalize().toString().toAsciiLower()
}

func addUnique(out: ArrayList<String>, dir: String): Unit {
  if (dir.isEmpty()) { return }
  let norm = Path(dir).normalize().toString()
  for (d in out) {
    if (sameDir(d, norm)) { return }
  }
  out.add(norm)
}

// `cjpm build --target-dir` 的落点由 cjpm 决定，钩子只认「本轮 main.exe 在哪」。
func collectMainExeDirs(dir: String, out: ArrayList<String>): Unit {
  try {
    for (f in Directory.readFrom(Path(dir))) {
      let child = Path(dir).join(f.name).toString()
      if (f.isDirectory()) {
        collectMainExeDirs(child, out)
      } else if (f.name == "main.exe") {
        addUnique(out, Path(dir).normalize().toString())
      }
    }
  } catch (e: Exception) { }
}

// Resolve ALL plausible build-output bin dirs and make sure each exists.
// 显式 target-dir 优先；没有传入（或还没产出 main.exe）时回退旧的两套布局。
func resolveBins(): Array<String> {
  let root = findRoot()
  let out = ArrayList<String>()
  let explicit = getVariable("SACODE_BUILD_TARGET_DIR") ?? ""
  if (!explicit.isEmpty() && exists(explicit)) {
    collectMainExeDirs(explicit, out)
  }
  if (out.size == 0) {
    ensureDirFrom(root, "target/release/bin")
    ensureDirFrom(".", "target/release/bin")
    addUnique(out, Path(root).join("target").join("release").join("bin").toString())
    addUnique(out, Path(".").join("target").join("release").join("bin").toString())
  }
  return out.toArray()
}

// Copy the full runtime DLL set into one target bin. Returns non-zero on IO failure.
func copyRuntimeSet(target: String, stdxDir: String, runtimeDir: String, sdkRoot: String): Int64 {
  var rc = 0
  // 1) runtime libs (boundscheck + libcangjie-runtime* + libcangjie-std-* minus DENY)
  rc = copyIfDll(runtimeDir, target, runtimePredicate)
  if (rc != 0) { return rc }

  // 2) stdx libs minus DENY
  rc = copyIfDll(stdxDir, target, stdxPredicate)
  if (rc != 0) { return rc }

  // 2b) OpenSSL FFI loader shipped from stdx (only if present)
  if (!copyNamedFrom([stdxDir], "libcangjie-dynamicLoader-opensslFFI.dll", target)) {
    println("  ~ libcangjie-dynamicLoader-opensslFFI.dll not in stdx (skip)")
  }

  // 3) winpthread (REQUIRED for startup) — SDK first, then PATH
  let mw = mingwSources(sdkRoot)
  if (!copyNamedFrom(mw, "libwinpthread-1.dll", target)) {
    if (!copyNamedFrom(pathDirs(), "libwinpthread-1.dll", target)) {
      eprintln("WARN: libwinpthread-1.dll not found -> binary may 0xC0000135 without it on PATH")
    }
  }
  // optional mingw runtimes
  copyNamedFrom(mw, "libgcc_s_seh-1.dll", target)
  copyNamedFrom(mw, "libstdc++-6.dll", target)

  // 4) OpenSSL 3 (TLS) — OPENSSL_HOME then PATH
  let opensslHome = getVariable("OPENSSL_HOME")
  let sslSources = match (opensslHome) {
    case Some(h) => if (h.isEmpty()) { Array<String>() } else { [h] }
    case None => Array<String>()
  }
  for (dll in ["libcrypto-3-x64.dll", "libssl-3-x64.dll"]) {
    if (!copyNamedFrom(sslSources, dll, target)) {
      if (!copyNamedFrom(pathDirs(), dll, target)) {
        eprintln("WARN: " + dll + " not found -> TLS (https/SSE) will throw without it on PATH")
      }
    }
  }
  return 0
}

// 钩子补抄的是 Windows 运行期 DLL（上游 cjpm issue #725）。其他平台既不产出
// DLL，也没有对应的 SDK/stdx 目录，不能因为 Windows 路径不存在就判构建失败。
@When[os == "Windows"]
func needsDllStaging(): Bool {
  return true
}

@When[os != "Windows"]
func needsDllStaging(): Bool {
  return false
}

func stagePostBuild(): Int64 {
  if (!needsDllStaging()) {
    println("[build.cj] skip: runtime DLL staging is Windows-only")
    return 0
  }
  let root = findRoot()
  let sdkRoot = resolveSdkRoot()
  let stdxDir = resolveStdxDir(root)
  let runtimeDir = resolveRuntimeDir(sdkRoot)
  if (stdxDir.isEmpty()) {
    eprintln("WARN: stdx DLL dir unresolved; set SACODE_STDX_DLL_DIR (build continues, runtime may miss libstdx.*)")
  }
  if (runtimeDir.isEmpty()) {
    eprintln("WARN: Cangjie runtime DLL dir unresolved; set SACODE_RUNTIME_DLL_DIR or CANGJIE_HOME (build continues)")
  }
  let targets = resolveBins()
  if (targets.size == 0) {
    eprintln("WARN: no build-output bin resolved; runtime DLLs not staged")
    return 0
  }
  for (target in targets) {
    println("[build.cj] target bin = " + target)
    let rc = copyRuntimeSet(target, stdxDir, runtimeDir, sdkRoot)
    if (rc != 0) { return rc }
  }
  println("[build.cj] done.")
  return 0
}

main(): Int64 {
  match (Process.current.arguments[0]) {
    case "post-build" => stagePostBuild()
    case _ => 0
  }
}
