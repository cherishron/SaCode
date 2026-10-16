// build.cj: cjpm stagePostBuild hook.
// Fixes upstream cjpm not copying bin-dependencies' runtime DLLs (issue #725):
// after a successful build, copy the full Cangjie runtime DLL set into the
// build-output bin/ so the freshly built binary is directly runnable
// (no 0xC0000135 STATUS_DLL_NOT_FOUND at startup).
import std.process.*
import std.fs.*
import std.env.*

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
func copyIfDll(srcDir: String, dstDir: String, predicate: (String) -> Bool): Int64 {
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

func resolveTarget(): String {
  let candidates = ["target/release/bin", "../../target/release/release/bin"]
  for (c in candidates) {
    try {
      let _ = Directory.readFrom(c)
      return c
    } catch (e: Exception) { }
  }
  return "target/release/bin"
}

func stagePostBuild(): Int64 {
  let stdxDir = "C:/Users/jingg/stdx-work/stdx-1.1.3.1/windows_x86_64_cjnative/dynamic/stdx"
  let runtimeDir = "D:/Program Files/HuaWei/Cangjie/runtime/lib/windows_x86_64_cjnative"
  let sdkRoot = "D:/Program Files/HuaWei/Cangjie"
  let target = resolveTarget()
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

main(): Int64 {
  match (Process.current.arguments[0]) {
    case "post-build" => stagePostBuild()
    case _ => 0
  }
}
