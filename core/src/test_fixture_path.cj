package core
import std.env.getVariable
import std.fs.*

// 仓颉单测的临时产物唯一落位：TMP 下按需自建的私有目录。
//
// 为什么不再写死绝对路径（2026-10-11 实测）：
// 1. 写死 `apps/desktop/.tmp-test/host-restore-20261009/…` 把 core 的测试产物放进
//    桌面模块目录，既跨模块又落在 gitignore 目录里——干净检出时目录不存在，
//    `WriteLease.acquire()` 里的 `File.createTemp` 直接抛，整批用例在第一步就红。
// 2. 写死本仓根 `target/` 依赖一个由构建器创建、并非测试自己保证的目录。
//    我把 TMP 指向私有目录后它就不存在了，于是 `TeamRunnerFixture` 在 init 抛错，
//    finally 不执行，模块级 `teamRunnerClaims` 永不归还，后续用例被误报成
//    `team-runner-session-owned`——夹具缺陷伪装成并发缺陷。
// 3. 夹具自己建目录、自己在可用范围内清理，才对「TMP 指到哪」不敏感。
//
// 保留的纪律：目录由 `Directory.createTemp` 原子创建，多个并行会话各自一份，
// 不共享也不认领彼此的夹具；清理失败不算用例失败，残留留在私有 TMP 里。

// 惰性建立本进程私有的根目录。
// 刻意不做模块级缓存：core 里没有模块级可变状态的传统，写一个 `var` 反而引入
// 跨用例共享；而这里只多一次 exists 判断，幂等且可并发，收益不值得那份耦合。
public func coreTestRoot(): String {
    let base = getVariable("TMP") ?? (getVariable("TEMP") ?? ".")
    let dir = "${base}/sacode-core-tests"
    try { if (!exists(dir)) { Directory.create(dir, recursive: true) } }
    catch (_: Exception) { return base }
    // 建不出来就退回 TMP 本身：Directory.createTemp 仍能给出唯一子目录，
    // 好过让整批用例在「找不到根目录」上一起红掉。
    return dir
}

// 一个用例独占的目录路径；目录本身由调用方在需要时创建。
public func coreTestDir(tag: String): String {
    return "${coreTestRoot()}/${tag}"
}

// 按需自建某用例的目录并返回规范路径。
public func coreTestDirCreated(tag: String): String {
    let dir = coreTestDir(tag)
    if (!exists(dir)) { Directory.create(dir, recursive: true) }
    return canonicalize(dir).toString()
}

// 尽力清理；删不掉的（Git 只读对象等）留在私有 TMP 里，不把清理失败记成用例失败。
public func coreTestTidy(path: String): Unit {
    try { removeIfExists(path, recursive: true) } catch (_: Exception) {}
}
