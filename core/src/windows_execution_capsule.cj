package core

@When[os == "Windows"]
import std.fs.*
@When[os == "Windows"]
import std.env.getVariable
@When[os == "Windows"]
import std.sync.*
@When[os == "Windows"]
import std.collection.*
@When[os == "Windows"]
import stdx.encoding.json.*

// 从准备到结束统一持有资源；正常路径的结束收束交给同一监督器。
@When[os == "Windows"]
class WindowsExecutionCapsule <: ExecutionWorkspaceCapsule {
    let service: ExecutionService
    let store: AttachmentStore
    let state: ExecutionSnapshot
    let root: String
    let gate = Mutex()
    let available = AtomicBool(false)
    let finished = AtomicBool(false)
    var library: ?WindowsProcessLibrary = None
    var profile: ?WindowsOwnedProfile = None
    var scope: ?WindowsPrivateWorkspace = None
    var source: ?WindowsWorkspaceTree = None
    var destination: ?WindowsWorkspaceTree = None
    var snapshot: ?WindowsWorkspaceSnapshot = None
    var tool: ?WindowsExecutionTool = None
    var probe: ?WindowsExecutionProcessProvider = None
    var settlement: ?WindowsSnapshotSettlement = None
    var run: ?ExecutionRun = None
    init(service: ExecutionService, store: AttachmentStore, state: ExecutionSnapshot, root: String) {
        this.service = service
        this.store = store
        this.state = state
        this.root = root
    }
    private func fact(kind: String): Unit {
        synchronized(service.log.mtx) {
            if (!service.lease.protects(service.log.path)) {
                throw Exception("already-owned")
            }
            let value = JsonObject();
            value.put("version", JsonInt(1))
            value.put("sessionId", JsonString(state.sessionId));
            value.put("executionId", JsonString(state.id))
            if (let Some(p) <- profile) {
                value.put("profileName", JsonString(p.name))
            }
            if (let Some(s) <- scope) {
                value.put("executionDirectory", JsonString(s.path))
            }
            if (let Some(d) <- destination) {
                value.put("executionIdentity", JsonString(d.identity))
            }
            service.log.append(kind, value.toString())
            var saved = false;
            try {
                saved = service.checkpoint()
            } catch (_: Exception) {}
            if (!saved || !service.lease.protects(service.log.path)) {
                service.persistenceFailed = true
                throw Exception("persistence-failed")
            }
        }
    }
    func prepare(): Unit {
        gate.lock()
        try {
            let proposal = JsonValue.fromStr(state.proposal).asObject()
            let directory = SessionWorkspace(service.log).directory()
            let base = if (root.size > 0) {
                canonicalize(root).toString()
            } else {
                canonicalize(getVariable("LOCALAPPDATA").getOrThrow()).toString() + "\\SaCode\\execution-workspaces\\v1"
            }
            let a = directory.toAsciiLower().trimEnd({r => r == r'\\'})
            let b = base.toAsciiLower().trimEnd({r => r == r'\\'})
            if (a.size <= 3 || a == b || b.startsWith(a + "\\") || a.startsWith(b + "\\")) {
                throw Exception("workspace-snapshot-overlap")
            }
            tool = Some(WindowsExecutionTool(proposal.get("executable").getOrThrow().asString().getValue()))
            fact("execution/workspace-preparing")
            if (!exists(base)) {
                Directory.create(base, recursive: true)
            }
            library = Some(WindowsProcessLibrary(reviewNativeLibraryPath()))
            profile = Some(WindowsOwnedProfile())
            scope = Some(
                WindowsPrivateWorkspace(library.getOrThrow(), profile.getOrThrow(), base,
                    "sacode-workspace-job-${ownProcessId()}-${windowsOwnedProfileSequence.fetchAdd(1)}", true))
            source = Some(WindowsWorkspaceTree(library.getOrThrow(), directory, false))
            destination = Some(WindowsWorkspaceTree(library.getOrThrow(), scope.getOrThrow().requireReady(), true))
            fact("execution/workspace-allocated")
            snapshot = Some(
                WindowsWorkspaceSnapshot(source.getOrThrow(), destination.getOrThrow(), state.sessionId, state.taskId,
                    state.requestId, proposal.get("workspaceRevision").getOrThrow().asInt().getValue(),
                    ownedPaths: [service.log.path, service.lease.leasePath, store.dir],
                    toolBinding: tool.getOrThrow().binding()))
            snapshot.getOrThrow().capture();
            snapshot.getOrThrow().record(service.log, service.lease, state)
            // 固定本地无输入探针；不执行提案命令、不访问模型或认证配置。
            let check = JsonObject();
            check.put("executable", JsonString(getVariable("SystemRoot").getOrThrow() + "\\System32\\cmd.exe"))
            check.put("cwd", JsonString(scope.getOrThrow().path));
            check.put("timeoutMs", JsonInt(3000));
            check.put("outputLimit", JsonInt(64))
            let argv = JsonArray();
            for (arg in ["/d", "/s", "/c", "exit 0"]) {
                argv.add(JsonString(arg))
            };
            check.put("argv", argv)
            probe = Some(
                WindowsExecutionProcessProvider(library.getOrThrow(), profile.getOrThrow(),
                    acProbeEnvironment(getVariable("LOCALAPPDATA").getOrThrow(), getVariable("SystemRoot").getOrThrow()),
                    check.toString()))
            let result = probe
                .getOrThrow()
                .execute(
                    ExecutionProcessRequest(check.get("executable").getOrThrow().asString().getValue(),
                        ["/d", "/s", "/c", "exit 0"], scope.getOrThrow().path, 3000, 64, TurnToken(), {_ =>}, {_ =>}))
                .getOrThrow()
            if (!result.exitObserved || !result.outputComplete || result.exitCode != 0 || result.error.size > 0) {
                throw Exception("sandbox-probe-failed")
            }
            fact("execution/workspace-ready");
            available.store(true)
        } finally {
            gate.unlock()
        }
    }
    public func ready(): Bool {
        return available.load() && !finished.load()
    }
    public func closed(): Bool {
        return finished.load()
    }
    public func start(revision: Int64): ExecutionRun {
        gate.lock()
        try {
            if (!ready() || run.isSome()) {
                throw Exception("execution-workspace-unavailable")
            }
            let provider = WindowsSnapshotExecutionProvider(service, state.id, snapshot.getOrThrow(),
                library.getOrThrow(), profile.getOrThrow(),
                acProbeEnvironment(getVariable("LOCALAPPDATA").getOrThrow(), getVariable("SystemRoot").getOrThrow()),
                tool: tool)
            let ending = WindowsSnapshotSettlement(service, store, snapshot.getOrThrow(), provider, scope.getOrThrow(),
                profile.getOrThrow(), library.getOrThrow())
            settlement = Some(ending)
            let started = ExecutionSupervisor(
                service,
                providerReady: {=> ready()},
                processProvider: Some(provider),
                onSettled: {
                    terminal =>
                        available.store(false);
                        ending.complete(terminal);
                        finished.store(true)
                }
            ).start(state.id, revision)
            run = Some(started)
            return started
        } finally {
            gate.unlock()
        }
    }
    public func shutdown(): Bool {
        gate.lock()
        try {
            if (closed()) {
                return true
            }
            available.store(false)
            if (let Some(active) <- run) {
                active.cancel()
                try {
                    active.wait(timeoutMs: 5000)
                } catch (_: Exception) {}
                if (!active.settled()) {
                    return false
                }
                let current = service.describe(state.id)
                if (current.phase != "exited" || settlement.isNone()) {
                    return false
                }
                settlement.getOrThrow().complete(current);
                finished.store(true);
                return true
            }
            let current = service.describe(state.id)
            if (current.phase != "awaiting-approval" && current.phase != "admitted" && current.phase !=
                "cancelled-before-start") {
                return false
            }
            if (let Some(p) <- probe) {
                p.cleanup()
            }
            if (current.phase != "cancelled-before-start") {
                service.stop(state.id, current.revision)
            }
            if (let Some(d) <- destination) {
                d.close()
            };
            if (let Some(s) <- source) {
                s.close()
            }
            if (let Some(s) <- scope) {
                if (!s.closed) {
                    s.disposeContents();
                    s.close()
                }
            }
            if (let Some(p) <- profile) {
                p.close()
            };
            if (let Some(l) <- library) {
                l.close()
            }
            fact("execution/workspace-discarded");
            finished.store(true);
            return true
        } catch (_: Exception) {
            return false
        } finally {
            gate.unlock()
        }
    }
}

@When[os == "Windows"]
func prepareExecutionWorkspace(service: ExecutionService, store: ?AttachmentStore, root: String, task: String,
    request: String, proposal: String): ?ExecutionSnapshot {
    if (store.isNone() || !exists(reviewNativeLibraryPath())) {
        return None
    }
    synchronized(service.log.mtx) {
        let state = service.propose(task, request, proposal)
        if (service.workspaceCapsules.contains(state.id) || state.phase != "awaiting-approval" ||
            service.workspaceSnapshot(state.id).size > 0) {
            return Some(state)
        }
        let removed = ArrayList<String>()
        for ((id, capsule) in service.workspaceCapsules) {
            if (capsule.closed()) {
                removed.add(id)
            }
        }
        for (id in removed) {
            service.workspaceCapsules.remove(id)
        }
        if (service.workspaceCapsules.size > 0) {
            throw Exception("execution-workspace-busy")
        }
        let capsule = WindowsExecutionCapsule(service, store.getOrThrow(), state, root)
        service.workspaceCapsules[state.id] = capsule
        try {
            capsule.prepare()
        } catch (e: Exception) {
            if (capsule.shutdown()) {
                service.workspaceCapsules.remove(state.id)
            };
            throw e
        }
        return Some(state)
    }
}
