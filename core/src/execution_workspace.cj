package core

// 仅共享核心持有；RPC只能引用执行身份，不接收胶囊、回调或原生资源。
interface ExecutionWorkspaceCapsule {
    func ready(): Bool
    func closed(): Bool
    func start(revision: Int64): ExecutionRun
    func shutdown(): Bool
}

@When[os != "Windows"]
func prepareExecutionWorkspace(service: ExecutionService, store: ?AttachmentStore, root: String, task: String,
    request: String, proposal: String): ?ExecutionSnapshot {
    return None
}
