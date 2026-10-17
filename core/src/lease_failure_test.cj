package core
import std.env.getTempDirectory
import std.fs.*
import std.unittest.*

// 本文件自带私有临时根：夹具产物既不能落仓库根，也不依赖尚未入库的共享夹具文件。
// 取临时目录用 std.env.getTempDirectory()（标准库推荐契约），拿不到才退回当前目录。
// 每个并行会话各自一份，互不共享；清理失败不算用例失败。
private func leaseTestRoot(): String {
    let base = try { getTempDirectory().toString() } catch (_: Exception) { "." }
    let dir = "${base}/sacode-lease-failure-tests"
    if (!exists(dir)) { Directory.create(dir, recursive: true) }
    return dir
}

@Test
func leaseFailureMissingDirectoryIsIoNotBusy() {
    let root = Directory.createTemp(Path(leaseTestRoot())).toString()
    try {
        let lease = WriteLease("${root}/missing/session.log")
        @Expect(lease.takeoverIfStale(), false)
        @Expect(lease.acquisitionFailure(), "io-failed")
        @Expect(lease.ownerToken(), "")
        @Expect(lease.stagingArtifact(), "")
    } finally { removeIfExists(root, recursive: true) }
}

@Test
func leaseFailureExistingDirectoryIsIoNotBusy() {
    let root = Directory.createTemp(Path(leaseTestRoot())).toString()
    let path = "${root}/session.log"
    Directory.create("${path}.lease")
    try {
        let lease = WriteLease(path)
        @Expect(lease.takeoverIfStale(), false)
        @Expect(lease.acquisitionFailure(), "io-failed")
        @Expect(FileInfo("${path}.lease").isDirectory(), true)
    } finally { removeIfExists(root, recursive: true) }
}

@Test
func leaseFailureLiveOwnerIsBusyAndCannotBeRemoved() {
    let root = Directory.createTemp(Path(leaseTestRoot())).toString()
    let path = "${root}/session.log"
    let holder = WriteLease(path)
    try {
        @Expect(holder.acquire(), true)
        let other = WriteLease(path)
        @Expect(other.takeoverIfStale(), false)
        @Expect(other.acquisitionFailure(), "busy")
        @Expect(other.currentOwner(), holder.ownerToken())
        @Expect(other.release(), false)
        @Expect(holder.release(), true)
        @Expect(other.takeoverIfStale(), true)
        @Expect(other.acquisitionFailure(), "")
        @Expect(other.release(), true)
    } finally { holder.release(); removeIfExists(root, recursive: true) }
}

@Test
func leaseFailureUnknownLivenessNeverDeletesOwner() {
    let root = Directory.createTemp(Path(leaseTestRoot())).toString()
    let path = "${root}/session.log"
    let mark = "writer=12345-unknown"
    File.writeTo("${path}.lease", mark.toArray())
    try {
        let lease = WriteLease(path)
        @Expect(lease.takeoverIfStale(probe: { _ => "unknown" }), false)
        @Expect(lease.acquisitionFailure(), "owner-unknown")
        @Expect(String.fromUtf8(File.readFrom("${path}.lease")), mark)
        File.writeTo("${path}.lease", "writer=5000000000-invalid".toArray())
        @Expect(lease.takeoverIfStale(), false)
        @Expect(lease.acquisitionFailure(), "owner-unknown")
    } finally { removeIfExists(root, recursive: true) }
}

@Test
func leaseFailureUnknownOwnerTokenNeverTakenOver() {
    let root = Directory.createTemp(Path(leaseTestRoot())).toString()
    let path = "${root}/session.log"
    File.writeTo("${path}.lease", "old-format".toArray())
    try {
        let lease = WriteLease(path)
        @Expect(lease.takeoverIfStale(), false)
        @Expect(lease.acquisitionFailure(), "owner-unknown")
        @Expect(String.fromUtf8(File.readFrom("${path}.lease")), "old-format")
    } finally { removeIfExists(root, recursive: true) }
}
