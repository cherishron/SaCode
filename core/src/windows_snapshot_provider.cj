package core

@When[os == "Windows"]
import stdx.encoding.json.*

// 只由核心装配：会话/审批仍描述原工作区，物理cwd由已持久化快照绑定决定。
@When[os == "Windows"]
class WindowsSnapshotExecutionProvider <: ExecutionProcessProvider {
    let service: ExecutionService
    let executionId: String
    let snapshot: WindowsWorkspaceSnapshot
    let proposal: String
    let native: WindowsExecutionProcessProvider
    let tool: ?WindowsExecutionTool
    init(service: ExecutionService, executionId: String, snapshot: WindowsWorkspaceSnapshot,
        library: WindowsProcessLibrary, profile: WindowsOwnedProfile, environment: Array<UInt16>,
        tool!: ?WindowsExecutionTool = None) {
        let state = service.describe(executionId)
        let receipt = JsonValue.fromStr(service.workspaceSnapshot(executionId)).asObject()
        let approved = JsonValue.fromStr(state.proposal).asObject()
        if (state.sessionId != snapshot.sessionId || state.taskId != snapshot.taskId || state.requestId != snapshot
            .requestId || approved.get("cwd").getOrThrow().asString().getValue().toAsciiLower() !=
            snapshot.source.path.toAsciiLower() || receipt.get("manifestDigest").getOrThrow().asString().getValue() != snapshot
            .digest || receipt.get("sourceIdentity").getOrThrow().asString().getValue() != snapshot.source.identity ||
            receipt.get("sourceDirectory").getOrThrow().asString().getValue() != snapshot.source.path ||
            receipt.get("executionDirectory").getOrThrow().asString().getValue() != snapshot.destination.path) {
            throw Exception("workspace-snapshot-binding-conflict")
        }
        if (let Some(bound) <- tool) {
            if (bound.binding() != snapshot.toolBinding ||
                receipt.get("toolBinding").getOrThrow().asString().getValue() != bound.binding() || bound.requested !=
                approved.get("executable").getOrThrow().asString().getValue()) {
                throw Exception("execution-tool-binding-conflict")
            }
            bound.assertFresh()
        } else if (snapshot.toolBinding.size > 0) {
            throw Exception("execution-tool-binding-required")
        }
        this.tool = tool
        this.service = service
        this.executionId = executionId
        this.snapshot = snapshot
        this.proposal = state.proposal
        approved.put("cwd", JsonString(snapshot.destination.path))
        if (let Some(bound) <- tool) {
            approved.put("executable", JsonString(bound.executable))
        }
        this.native = WindowsExecutionProcessProvider(
            library,
            profile,
            environment,
            approved.toString(),
            beforeResume: {
                =>
                    let workspace = SessionWorkspace(service.log)
                    if (!workspace.available() || workspace.revision() != snapshot.workspaceRevision ||
                        workspace.directory().toAsciiLower() != snapshot.source.path.toAsciiLower()) {
                        throw Exception("workspace-changed")
                    }
                    snapshot.assertFresh(snapshot.sessionId, snapshot.taskId, snapshot.requestId,
                        snapshot.workspaceRevision)
                    if (let Some(bound) <- tool) {
                        bound.assertFresh()
                    }
            }
        )
    }
    public func execute(request: ExecutionProcessRequest): ?ShellResult {
        let approved = JsonValue.fromStr(proposal).asObject()
        let argv = approved.get("argv").getOrThrow().asArray()
        if (request.directory != approved.get("cwd").getOrThrow().asString().getValue() || request.executable !=
            approved.get("executable").getOrThrow().asString().getValue() || request.timeoutMs !=
            approved.get("timeoutMs").getOrThrow().asInt().getValue() || request.outputLimit !=
            approved.get("outputLimit").getOrThrow().asInt().getValue() || request.arguments.size != argv.size() ||
            service.describe(executionId).proposal != proposal) {
            throw Exception("windows-process-proposal-mismatch")
        }
        for (index in 0..argv.size()) {
            if (request.arguments[index] != argv.get(index).getOrThrow().asString().getValue()) {
                throw Exception("windows-process-proposal-mismatch")
            }
        }
        let ownedToken = synchronized(service.log.mtx) {
            let current = service.describe(executionId)
            if ((current.phase != "starting" && current.phase != "stopping") || !service.starts.contains(executionId) ||
                !service.starts[executionId] || !service.tokens.contains(executionId) ||
                !service.lease.protects(service.log.path)) {
                throw Exception("not-authorized")
            }
            service.tokens[executionId]
        }
        let executable = if (let Some(bound) <- tool) {
            bound.executable
        } else {
            request.executable
        }
        return native.execute(
            ExecutionProcessRequest(executable, request.arguments, snapshot.destination.path, request.timeoutMs,
                request.outputLimit, ownedToken, request.onCreated, request.onStarted))
    }
    func close(): Unit {
        native.cleanup()
    }
}
