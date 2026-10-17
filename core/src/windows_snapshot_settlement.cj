package core

@When[os == "Windows"]
import std.sync.Mutex
@When[os == "Windows"]
import stdx.encoding.json.*

// 独占胶囊的结束阶段。必须先保存对象/审查，再删除私有字节；不重建或接管旧进程。
@When[os == "Windows"]
class WindowsSnapshotSettlement {
    let service: ExecutionService
    let store: AttachmentStore
    let snapshot: WindowsWorkspaceSnapshot
    let provider: WindowsSnapshotExecutionProvider
    let scope: WindowsPrivateWorkspace
    let profile: WindowsOwnedProfile
    let library: WindowsProcessLibrary
    let gate = Mutex()
    var reviewSaved = false
    var began = false
    var disposed = false
    var released = false
    init(service: ExecutionService, store: AttachmentStore, snapshot: WindowsWorkspaceSnapshot,
        provider: WindowsSnapshotExecutionProvider, scope: WindowsPrivateWorkspace, profile: WindowsOwnedProfile,
        library: WindowsProcessLibrary) {
        if (scope.requireReady().toAsciiLower() != snapshot.destination.path.toAsciiLower() || scope.profile.name != profile
            .name || provider.snapshot.digest != snapshot.digest || library.closed) {
            throw Exception("workspace-snapshot-binding-conflict")
        }
        this.service = service
        this.store = store
        this.snapshot = snapshot
        this.provider = provider
        this.scope = scope
        this.profile = profile
        this.library = library
    }
    private func persist(kind: String, state: ExecutionSnapshot): Unit {
        synchronized(service.log.mtx) {
            if (!service.lease.protects(service.log.path)) {
                throw Exception("already-owned")
            }
            let value = JsonObject();
            value.put("version", JsonInt(1))
            value.put("sessionId", JsonString(state.sessionId));
            value.put("executionId", JsonString(state.id))
            value.put("executionRevision", JsonInt(state.revision));
            value.put("manifestDigest", JsonString(snapshot.digest))
            service.log.append(kind, value.toString())
            var saved = false
            try {
                saved = service.checkpoint()
            } catch (_: Exception) {
                saved = false
            }
            if (!saved || !service.lease.protects(service.log.path)) {
                service.persistenceFailed = true
                throw Exception("persistence-failed")
            }
        }
    }
    func complete(state: ExecutionSnapshot): Unit {
        gate.lock()
        try {
            if (state.id != provider.executionId || state.sessionId != service.sessionId) {
                throw Exception("workspace-snapshot-binding-conflict")
            }
            let actual = service.describe(state.id)
            if (actual.phase != "exited" || actual.revision != state.revision || actual.proposal != state.proposal) {
                throw Exception("workspace-snapshot-execution-unsettled")
            }
            if (released) {
                return
            }
            if (!reviewSaved) {
                snapshot.recordReview(service.log, service.lease, state, store);
                reviewSaved = true
            }
            if (!began) {
                persist("execution/resources-release-begin", state);
                began = true
            }
            if (!disposed) {
                provider.close() // 已确认无活动进程/读者才释放原生进程句柄。
                snapshot.destination.close();
                snapshot.source.close()
                if (!scope.closed) {
                    scope.disposeContents();
                    scope.close()
                }
                profile.close();
                library.close()
                disposed = true
            }
            persist("execution/resources-released", state)
            released = true
        } finally {
            gate.unlock()
        }
    }
}
