package core
import std.collection.ArrayList
import std.collection.HashMap
import std.sync.*

// ACP 委派服务：委派会话/任务的生命周期、状态迁移、归属绑定、幂等（design §2.1.3、§2.2.2）。
// 每委派一会话（不复用）、绑定 sessionId+taskId+delegationId+protocolSessionId。
// requestId 幂等：同键同摘要回原委派，异摘要 request-conflict。
// create 前 L1+L2 门控必须通过（gate.requireCanDelegate）。
// 持久化经 checkpoint 回调（Task 2.4 整合 SessionLog/WriteLease）。

// 委派快照（只读视图）
public class AcpDelegationSnapshot {
    public let id: String                  // delegation-<序号>
    public let sessionId: String
    public let taskId: String
    public let requestId: String
    public let peerId: String              // 产品标识
    public let protocolSessionId: String   // 外部 Agent 返回的会话身份
    public let phase: String
    public let revision: Int64
    public let capabilityDigest: String
    public let result: String              // 结算事实
    public init(id: String, sessionId: String, taskId: String, requestId: String,
        peerId: String, protocolSessionId: String, phase: String, revision: Int64,
        capabilityDigest: String, result: String) {
        this.id = id
        this.sessionId = sessionId
        this.taskId = taskId
        this.requestId = requestId
        this.peerId = peerId
        this.protocolSessionId = protocolSessionId
        this.phase = phase
        this.revision = revision
        this.capabilityDigest = capabilityDigest
        this.result = result
    }
}

// 委派记录（内部可变状态）
class AcpDelegationEntry {
    var id: String
    var sessionId: String
    var taskId: String
    var requestId: String
    var peerId: String
    var protocolSessionId: String
    var phase: String
    var revision: Int64
    var capabilityDigest: String
    var result: String
    var proc: Option<AcpProcess> = None
    // 协作式取消令牌：父令牌取消时子令牌跟随；detached 不跟随
    var cancelToken: TurnToken
    // taskText 摘要用于幂等校验
    var taskDigest: String

    init(id: String, sessionId: String, taskId: String, requestId: String,
        peerId: String, taskDigest: String) {
        this.id = id
        this.sessionId = sessionId
        this.taskId = taskId
        this.requestId = requestId
        this.peerId = peerId
        this.protocolSessionId = ""
        this.phase = "pending"
        this.revision = Int64(0)
        this.capabilityDigest = ""
        this.result = ""
        this.cancelToken = TurnToken()
        this.taskDigest = taskDigest
    }

    func snapshot(): AcpDelegationSnapshot {
        return AcpDelegationSnapshot(id, sessionId, taskId, requestId,
            peerId, protocolSessionId, phase, revision, capabilityDigest, result)
    }
}

public class AcpDelegationService {
    let sessionId: String
    let gate: AcpGate
    let procFactory: (String) -> AcpProcess
    let checkpoint: () -> Bool
    // 委派存储：id → 条目
    let delegations = HashMap<String, AcpDelegationEntry>()
    // requestId → 委派 id（幂等索引）
    let requestIdIndex = HashMap<String, String>()
    // 序号生成
    let idGen = AtomicInt64(0)
    let mtx = Mutex()
    // 并发上限（配置化，待定）
    let maxConcurrent: Int64 = 4

    public init(sessionId: String, gate: AcpGate,
        procFactory: (String) -> AcpProcess,
        checkpoint!: () -> Bool = { => true }) {
        this.sessionId = sessionId
        this.gate = gate
        this.procFactory = procFactory
        this.checkpoint = checkpoint
    }

    // 创建委派：门控检查 → 幂等检查 → 进程启动 → 能力协商 → 会话创建
    public func create(taskId: String, requestId: String, peerId: String,
        taskText: String, workspace: String): AcpDelegationSnapshot {
        // 门控：L1 + L2 必须通过
        gate.requireCanDelegate("user", peerId)

        let taskDigest = simpleDigest(taskText)

        mtx.lock()
        // 幂等检查：同 requestId
        if (let Some(existingId) <- requestIdIndex.get(requestId)) {
            if (let Some(existing) <- delegations.get(existingId)) {
                if (existing.taskDigest == taskDigest) {
                    // 同键同摘要：回原委派
                    let snap = existing.snapshot()
                    mtx.unlock()
                    return snap
                } else {
                    mtx.unlock()
                    throw Exception("revision-conflict:requestId-digest-mismatch")
                }
            }
        }

        // 并发上限检查
        var active = Int64(0)
        for ((_, entry) in delegations) {
            if (entry.phase == "running" || entry.phase == "awaiting-permission" || entry.phase == "awaiting-input") {
                active += 1
            }
        }
        if (active >= maxConcurrent) {
            mtx.unlock()
            throw Exception("busy:concurrent-limit-${maxConcurrent}")
        }

        // 创建委派条目
        let seq = idGen.fetchAdd(1) + 1
        let delegationId = "delegation-${seq}"
        let entry = AcpDelegationEntry(delegationId, sessionId, taskId, requestId, peerId, taskDigest)
        delegations[delegationId] = entry
        requestIdIndex[requestId] = delegationId
        mtx.unlock()

        // 启动进程
        entry.phase = "initializing"
        entry.revision += 1
        let proc = procFactory(peerId)
        if (!proc.start()) {
            entry.phase = "failed"
            entry.result = "provider-unavailable:spawn-failed:${proc.startFailure()}"
            entry.revision += 1
            return entry.snapshot()
        }
        entry.proc = Some(proc)

        // 能力协商：initialize
        let initResult = proc.acpInitialize(1, "sacode", "0.1.0")
        if (let None <- initResult) {
            entry.phase = "failed"
            entry.result = "provider-unavailable:initialize-timeout"
            entry.revision += 1
            proc.kill()
            return entry.snapshot()
        }

        // 会话创建：session/new
        let sessionResult = proc.sessionNew(workspace)
        if (let Some(resp) <- sessionResult) {
            // 解析 protocolSessionId（简化：用响应中的 sessionId 字段）
            entry.protocolSessionId = extractSessionId(resp)
        } else {
            entry.phase = "failed"
            entry.result = "provider-unavailable:session-new-failed"
            entry.revision += 1
            proc.kill()
            return entry.snapshot()
        }

        // 进入运行态
        entry.phase = "running"
        entry.revision += 1
        proc.markBusy()

        // 持久化（Task 2.4 整合 SessionLog）
        let _ = checkpoint()

        return entry.snapshot()
    }

    // 查询委派
    public func describe(id: String): AcpDelegationSnapshot {
        mtx.lock()
        if (let Some(entry) <- delegations.get(id)) {
            let snap = entry.snapshot()
            mtx.unlock()
            return snap
        }
        mtx.unlock()
        throw Exception("not-found:delegation-${id}")
    }

    // 列出所有委派
    public func list(): ArrayList<AcpDelegationSnapshot> {
        let out = ArrayList<AcpDelegationSnapshot>()
        mtx.lock()
        for ((_, entry) in delegations) {
            out.add(entry.snapshot())
        }
        mtx.unlock()
        return out
    }

    // 取消委派：发 session/cancel 并等待结算；同时设置 TurnToken
    public func cancel(id: String, expectedRevision: Int64): AcpDelegationSnapshot {
        mtx.lock()
        if (let Some(entry) <- delegations.get(id)) {
            if (entry.revision != expectedRevision) {
                mtx.unlock()
                throw Exception("revision-conflict:expected-${expectedRevision}-actual-${entry.revision}")
            }
            entry.phase = "cancelling"
            entry.revision += 1
            // 设置取消令牌
            entry.cancelToken.cancel()
            mtx.unlock()

            // 发 session/cancel
            if (let Some(proc) <- entry.proc) {
                if (proc.alive()) {
                    let cancelResult = proc.sessionCancel(entry.protocolSessionId, timeoutMs: 3000)
                    if (let Some(_) <- cancelResult) {
                        entry.phase = "cancelled"
                    } else {
                        // 未确认停止 → outcome-unknown
                        entry.phase = "outcome-unknown"
                        entry.result = "cancel-no-confirmation"
                    }
                } else {
                    entry.phase = "cancelled"
                }
                proc.markIdle()
            } else {
                entry.phase = "cancelled"
            }
            entry.revision += 1
            let _ = checkpoint()
            return entry.snapshot()
        }
        mtx.unlock()
        throw Exception("not-found:delegation-${id}")
    }

    // 关闭委派：发 session/close 再结算进程
    public func close(id: String, expectedRevision: Int64): AcpDelegationSnapshot {
        mtx.lock()
        if (let Some(entry) <- delegations.get(id)) {
            if (entry.revision != expectedRevision) {
                mtx.unlock()
                throw Exception("revision-conflict:expected-${expectedRevision}-actual-${entry.revision}")
            }
            entry.phase = "completing"
            entry.revision += 1
            mtx.unlock()

            if (let Some(proc) <- entry.proc) {
                proc.close()
                proc.markIdle()
            }
            entry.phase = "completed"
            entry.revision += 1
            let _ = checkpoint()
            return entry.snapshot()
        }
        mtx.unlock()
        throw Exception("not-found:delegation-${id}")
    }

    // 内容块入口（内部）：Task 3.x 实现
    public func onUpdate(id: String, block: String): Unit {
        // 待 Task 3.1 AcpContentRouter 实现
    }

    // 授权请求入口：Task 4.1 实现
    public func onPermissionRequest(id: String, request: String): Int64 {
        // 待 Task 4.1 AcpApprovalBridge 实现
        return Int64(-1)
    }

    // elicitation 入口：Task 4.x 实现
    public func onElicitation(id: String, requestId: String, fields: String): Unit {
        // 待 Task 4.x 实现
    }

    // 简易摘要：取 taskText 的长度 + 前 64 字节哈希（不引 stdx）
    private func simpleDigest(text: String): String {
        let arr = text.toArray()
        var sum = Int64(0)
        var n = Int64(0)
        for (b in arr) {
            sum = sum * Int64(31) + Int64(b)
            n += 1
        }
        return "${n}:${sum}"
    }

    // 从 session/new 响应中提取 sessionId（简化版，正式版需 JSON 解析）
    private func extractSessionId(response: String): String {
        // 在响应 JSON 中找 "sessionId":"..."
        let hay = response.toArray()
        let pat = "\"sessionId\":\"".toArray()
        let hlen = Int64(hay.size)
        let plen = Int64(pat.size)
        if (plen > hlen) { return "" }
        var i: Int64 = 0
        while (i <= hlen - plen) {
            var same = true
            var k: Int64 = 0
            while (k < plen) {
                if (hay[i + k] != pat[k]) { same = false; break }
                k += 1
            }
            if (same) {
                // 提取引号内的值
                var j = i + plen
                let out = ArrayList<Byte>()
                while (j < hlen && hay[j] != 34) { // '"'
                    out.add(hay[j])
                    j += 1
                }
                return String.fromUtf8(out.toArray())
            }
            i += 1
        }
        return ""
    }
}