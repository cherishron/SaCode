package core

@When[os == "Windows"]
import std.sync.Mutex

// 私有目录生命周期；尚不复制真实工作区，不提供静默 cwd 映射或自动合入。
@When[os == "Windows"]
class WindowsPrivateWorkspace {
    let library: WindowsProcessLibrary
    let profile: WindowsOwnedProfile
    let owned: CPointer<Unit>
    let revokeCall: CFunc<(CPointer<Unit>) -> UInt32>
    let closeCall: CFunc<(CPointer<Unit>) -> UInt32>
    let path: String
    let creationError: UInt32
    let gate = Mutex()
    var closed = false
    init(library: WindowsProcessLibrary, profile: WindowsOwnedProfile, parent: String, leaf: String, writable: Bool) {
        // 文本先校验，获取引用后任何失败均释放；原生非空失败句柄保留在实例内。
        let parentBytes = fileWidePath(parent)
        let leafBytes = fileWidePath(leaf)
        library.retain()
        var acquired = false
        try {
            let sid = profile.acquire()
            acquired = true
            let create = CFunc<(CPointer<UInt16>, CPointer<UInt16>, CPointer<Unit>, UInt32, CPointer<CPointer<Unit>>) -> UInt32>(
                windowsRequiredExport(library.module, "sacode_windows_workspace_create"))
            let revoke = CFunc<(CPointer<Unit>) -> UInt32>(
                windowsRequiredExport(library.module, "sacode_windows_workspace_revoke"))
            let close = CFunc<(CPointer<Unit>) -> UInt32>(
                windowsRequiredExport(library.module, "sacode_windows_workspace_close"))
            var scope = CPointer<Unit>()
            let p = unsafe { acquireArrayRawData(parentBytes) }
            let error = try {
                let l = unsafe { acquireArrayRawData(leafBytes) }
                try {
                    unsafe { create(p.pointer, l.pointer, sid, if (writable) {
                        UInt32(1)
                    } else {
                        UInt32(0)
                    }, inout scope) }
                } finally {
                    unsafe { releaseArrayRawData(l) }
                }
            } finally {
                unsafe { releaseArrayRawData(p) }
            }
            if (scope.isNull()) {
                throw Exception("windows-workspace-create:${error}")
            }
            this.library = library
            this.profile = profile
            this.owned = scope
            this.revokeCall = revoke
            this.closeCall = close
            this.creationError = error
            this.path = parent.trimEnd({r => r == r'\\'}) + "\\" + leaf
        } catch (e: Exception) {
            if (acquired) {
                profile.release()
            }
            library.release()
            throw e
        }
    }
    func requireReady(): String {
        gate.lock()
        try {
            if (closed) {
                throw Exception("windows-workspace-closed")
            }
            if (creationError != 0) {
                throw Exception("windows-workspace-create:${creationError}")
            }
            return path
        } finally {
            gate.unlock()
        }
    }
    // 仅允许导出并清空内容后的空目录撤销；失败保留全部所有权以供独立清理后重试。
    func close(): Unit {
        gate.lock()
        try {
            if (closed) {
                return
            }
            let revoked = unsafe { revokeCall(owned) }
            if (revoked != 0) {
                throw Exception("windows-workspace-revoke:${revoked}")
            }
            let released = unsafe { closeCall(owned) }
            if (released != 0) {
                throw Exception("windows-workspace-close:${released}")
            }
            closed = true
            profile.release();
            library.release()
        } finally {
            gate.unlock()
        }
    }
}
