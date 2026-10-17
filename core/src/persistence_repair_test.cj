package core

import std.fs.*
import std.unittest.*
import std.sync.*
import std.collection.ArrayList

@Test
func persistenceConcurrentFlushPublishesEveryAppend() {
    let root = Directory.createTemp(Path(coreTestRoot())).toString()
    let path = "${root}/session.log"
    try {
        let log = SessionLog(path)
        let gate = SyncCounter(3)
        let tasks = ArrayList<Future<Int64>>()
        for (id in 0..Int64(3)) {
            tasks.add(spawn { =>
                gate.dec(); gate.waitUntilZero()
                var saved: Int64 = 0
                for (i in 0..Int64(40)) {
                    log.append("user/message", "${id}-${i}")
                    if (log.flush()) { saved += 1 }
                }
                saved
            })
        }
        var saved: Int64 = 0
        for (task in tasks) { saved += task.get() }
        @Expect(saved, Int64(120))
        @Expect(log.isDurableFrozen(), false)
        let replay = SessionLog(path)
        @Expect(replay.load(), true)
        @Expect(replay.eventCount(), Int64(120))
        @Expect(replay.verifySeqContiguous(), true)
    } finally { removeIfExists(root, recursive: true) }
}

@When[os == "Windows"]
@Test
func persistenceReaderSharingConflictIsRetryableBeforeWrite() {
    let root = Directory.createTemp(Path(coreTestRoot())).toString()
    let path = "${root}/session.log"
    try {
        let log = SessionLog(path)
        log.append("user/message", "first")
        @Expect(log.flush(), true)
        let before = File.readFrom(path)
        let name = unsafe { acquireArrayRawData(fileWidePath(path)) }
        // 只允许读共享的活句柄确定性阻挡写句柄，不依赖调度运气。
        let reader = unsafe { CreateFileW(name.pointer, 2147483648, 1, CPointer<Unit>(), 3, 128, CPointer<Unit>()) }
        unsafe { releaseArrayRawData(name) }
        @Expect(fileHandleValid(reader), true)
        log.append("user/message", "second")
        try {
            @Expect(log.flush(), false)
            @Expect(log.isDurableFrozen(), false)
            @Expect(log.durableCount(), Int64(1))
            @Expect(samePersistenceBytes(File.readFrom(path), before), true)
        } finally { unsafe { CloseHandle(reader) } }
        @Expect(log.flush(), true)
        @Expect(log.durableCount(), Int64(2))
        let replay = SessionLog(path)
        @Expect(replay.load(), true)
        @Expect(replay.eventCount(), Int64(2))
    } finally { removeIfExists(root, recursive: true) }
}

func samePersistenceBytes(a: Array<Byte>, b: Array<Byte>): Bool {
    if (a.size != b.size) { return false }
    for (i in 0..a.size) { if (a[i] != b[i]) { return false } }
    return true
}

@Test
func persistenceCheckpointRejectsForeignLeaseWithoutFreezingOwner() {
    let root = Directory.createTemp(Path(coreTestRoot())).toString()
    let path = "${root}/session.log"
    let own = WriteLease(path)
    let unrelated = WriteLease("${root}/other.log")
    try {
        @Expect(own.acquire(), true)
        @Expect(unrelated.acquire(), true)
        let log = SessionLog(path)
        log.append("user/message", "first")
        @Expect(log.durableCheckpoint(unrelated), false)
        @Expect(log.isDurableFrozen(), false)
        @Expect(log.durableCheckpoint(own), true)
        log.append("user/message", "second")
        @Expect(log.flush(), true)
        @Expect(own.protects(path), true)
    } finally { own.release(); unrelated.release(); removeIfExists(root, recursive: true) }
}

@Test
func persistenceHalfUtf8TailRecoversAndRepublishes() {
    let root = Directory.createTemp(Path(coreTestRoot())).toString()
    let path = "${root}/session.log"
    try {
        let head = "0\tuser/message\t完整\n1\tuser/message\t".toArray()
        let bytes = Array<Byte>(head.size + 2, repeat: 0)
        for (i in 0..head.size) { bytes[i] = head[i] }
        bytes[head.size] = 228; bytes[head.size + 1] = 184
        File.writeTo(path, bytes)
        let log = SessionLog(path)
        @Expect(log.load(), true)
        @Expect(log.eventCount(), Int64(1))
        @Expect(log.isTruncatedTail(), true)
        log.append("user/message", "recovered")
        @Expect(log.flush(), true)
        let replay = SessionLog(path)
        @Expect(replay.load(), true)
        @Expect(replay.eventCount(), Int64(2))
        @Expect(replay.isTruncatedTail(), false)
    } finally { removeIfExists(root, recursive: true) }
}

@Test
func persistenceProjectionRebuildKeepsEarlierSnapshotStable() {
    let log = SessionLog("unused-projection.log")
    log.append("user/message", "one")
    let previous = log.deriveMessages()
    let builds = log.projectionBuilds()
    log.append("turn/start", "1")
    log.deriveMessages()
    @Expect(log.projectionBuilds(), builds)
    log.append("user/message", "two")
    @Expect(log.deriveMessages().size, Int64(2))
    @Expect(previous.size, Int64(1))
}

@Test
func persistenceDivergedDraftCannotRewriteCommittedPrefix() {
    let root = Directory.createTemp(Path(coreTestRoot())).toString()
    let path = "${root}/session.log"
    try {
        let first = SessionLog(path)
        first.append("user/message", "original")
        @Expect(first.flush(), true)
        let before = File.readFrom(path)
        let stale = SessionLog(path)
        stale.append("user/message", "different")
        @Expect(stale.flush(), false)
        @Expect(samePersistenceBytes(File.readFrom(path), before), true)
        @Expect(stale.durableCount(), Int64(0))
        @Expect(exists("${path}.lease"), false)
    } finally { removeIfExists(root, recursive: true) }
}

@Test
func persistenceCheckpointSupportsLargeUtf8PendingBatch() {
    let root = Directory.createTemp(Path(coreTestRoot())).toString()
    let path = "${root}/session.log"
    let lease = WriteLease(path)
    try {
        @Expect(lease.acquire(), true)
        let log = SessionLog(path)
        var content = ""
        for (_ in 0..Int64(3000)) { content += "中文" }
        log.append("user/message", content)
        @Expect(log.durableCheckpointBatched(lease), true)
        @Expect(log.durableCount(), Int64(1))
        let replay = SessionLog(path)
        @Expect(replay.load(), true)
        @Expect(replay.snapshotEvents()[0].data, content)
    } finally { lease.release(); removeIfExists(root, recursive: true) }
}

@When[os == "Windows"]
@Test
func persistenceExplicitCheckpointFailureFreezesFuturePublishing() {
    let root = Directory.createTemp(Path(coreTestRoot())).toString()
    let path = "${root}/session.log"
    let lease = WriteLease(path)
    try {
        @Expect(lease.acquire(), true)
        let log = SessionLog(path)
        log.append("user/message", "first")
        @Expect(log.durableCheckpoint(lease), true)
        let before = File.readFrom(path)
        let name = unsafe { acquireArrayRawData(fileWidePath(path)) }
        let reader = unsafe { CreateFileW(name.pointer, 2147483648, 1, CPointer<Unit>(), 3, 128, CPointer<Unit>()) }
        unsafe { releaseArrayRawData(name) }
        @Expect(fileHandleValid(reader), true)
        log.append("user/message", "second")
        try {
            @Expect(log.durableCheckpoint(lease), false)
            @Expect(log.isDurableFrozen(), true)
        } finally { unsafe { CloseHandle(reader) } }
        @Expect(log.flush(), false)
        @Expect(log.durableCount(), Int64(1))
        @Expect(samePersistenceBytes(File.readFrom(path), before), true)
    } finally { lease.release(); removeIfExists(root, recursive: true) }
}

@Test
func persistenceLostLeaseRefusesPublishingAndPreservesNewOwner() {
    let root = Directory.createTemp(Path(coreTestRoot())).toString()
    let path = "${root}/session.log"
    let lease = WriteLease(path)
    try {
        @Expect(lease.acquire(), true)
        let log = SessionLog(path)
        log.append("user/message", "first")
        @Expect(log.durableCheckpoint(lease), true)
        let before = File.readFrom(path)
        File.writeTo("${path}.lease", "writer=someone-else".toArray())
        log.append("user/message", "second")
        @Expect(log.flush(), false)
        @Expect(lease.release(), false)
        @Expect(String.fromUtf8(File.readFrom("${path}.lease")), "writer=someone-else")
        @Expect(samePersistenceBytes(File.readFrom(path), before), true)
    } finally {
        // 该凭据是本用例自己写入的，清理仅限本用例独占目录。
        removeIfExists("${path}.lease")
        removeIfExists(root, recursive: true)
    }
}
