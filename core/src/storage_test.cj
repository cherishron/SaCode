package core
import std.fs.*
import std.unittest.*

// 存储上游契约（260 行）：`ctx.storage` hub + `StorageBackend { kv?, close() }`
// + `DomainSpec { name, version, ... }`；`open(spec)` 严格序列失败整体回滚
// （`already-open` / `backend-not-found` / `facet-unsupported` / `version-mismatch` /
// `malformed-medium` / `invalid-record`）；写入排队 per-domain chain→先落 backend
// durable→再改内存→再 emit `domain/changed`；被拒的 backend 写不动内存
// （读侧永不与持久层撕裂）。`domain/changed` 是 in-process only（跨进程推送是
// 记录在案的局限），本切片以 log-only `domain/changed` 事件近似之。

@Test
func storageDomainOpenPutGetRoundTripAndReplay() {
    let root = "core-storage-roundtrip"
    removeIfExists(root, recursive: true)
    Directory.create(root, recursive: true)
    let path = "${root}/session.log"
    let log = SessionLog(path)
    let store = StorageHub(log)
    store.open("sessions", Int64(1))
    log.append("user/message", "开工")
    store.put("sessions", "a", "甲")
    store.put("sessions", "b", "乙")
    @Expect(store.get("sessions", "a"), "甲")
    @Expect(store.get("sessions", "b"), "乙")
    @Expect(log.flush(), true)

    let fresh = SessionLog(path)
    @Expect(fresh.load(), true)
    let replayed = StorageHub(fresh)
    replayed.open("sessions", Int64(1))
    replayed.putFrom("sessions", "a", "甲")
    replayed.putFrom("sessions", "b", "乙")
    @Expect(replayed.get("sessions", "a"), "甲")
    @Expect(replayed.get("sessions", "b"), "乙")
    // 关键：domain/changed 是 log-only 事件，deriveMessages 只看到那一条 user/message。
    @Expect(fresh.deriveMessages().size, Int64(1))
    removeIfExists(root, recursive: true)
}

@Test
func storageDomainAlreadyOpenRejected() {
    let root = "core-storage-dup"
    removeIfExists(root, recursive: true)
    Directory.create(root, recursive: true)
    let log = SessionLog("${root}/session.log")
    let store = StorageHub(log)
    store.open("sessions", Int64(1))
    var threw = false
    try {
        store.open("sessions", Int64(1))
    } catch (e: Exception) {
        threw = true
    }
    @Expect(threw, true)
    removeIfExists(root, recursive: true)
}

@Test
func storageDomainVersionMismatchRejectsOpen() {
    let root = "core-storage-version"
    removeIfExists(root, recursive: true)
    Directory.create(root, recursive: true)
    let log = SessionLog("${root}/session.log")
    let store = StorageHub(log)
    // 已经有一次 v1 的 domain/changed 事件持久在日志里。
    store.open("sessions", Int64(1))
    store.put("sessions", "k", "v")
    store.close("sessions")
    var threw = false
    try {
        // 试图以 v2 打开同一 domain：持久层是 v1，version-mismatch。
        store.open("sessions", Int64(2))
    } catch (e: Exception) {
        threw = true
    }
    @Expect(threw, true)
    removeIfExists(root, recursive: true)
}

@Test
func storageDomainCloseAllowsReopenSameVersion() {
    let root = "core-storage-reopen"
    removeIfExists(root, recursive: true)
    Directory.create(root, recursive: true)
    let log = SessionLog("${root}/session.log")
    let store = StorageHub(log)
    store.open("sessions", Int64(1))
    store.close("sessions")
    store.open("sessions", Int64(1))
    // close 后 name 释放，可再次 open 同版本。
    @Expect(store.get("sessions", "any"), "")
    removeIfExists(root, recursive: true)
}
