package host

import core.*
import std.fs.*
import stdx.encoding.json.*

// 调度方为当前会话持有一个实例；目录/修订或会话变化后丢弃并重新装配。
// 装配前须完成工作区授信与文件范围/ignore 确认；本层不遍历目录、不扩大清单。
public class KnowledgeIndexHostRpc {
    private let state: SessionWorkspace
    private let sessionId: String
    private let boundLog: SessionLog
    private let workspace: String
    private let workspaceRevision: Int64
    private let workspaceInfo: FileInfo
    private let rpc: KnowledgeIndexRpc

    public init(log: SessionLog, sessionId: String) {
        state = SessionWorkspace(log)
        this.sessionId = sessionId
        boundLog = log
        if (state.directory().size == 0 || !state.available()) {
            throw Exception("knowledge-index-host-workspace-required")
        }
        workspace = canonicalize(state.directory()).toString()
        workspaceRevision = state.revision()
        workspaceInfo = FileInfo(workspace)
        rpc = KnowledgeIndexRpc(state, sessionId)
        requireBinding()
    }

    public static func handles(method: String): Bool {
        return KnowledgeIndexRpc.handles(method)
    }

    // 由调度方传入当前可信 activeId/shared，而不是使用请求中的 sessionId 选择日志。
    // 重载为另一个日志对象时也重新装配，不能用同路径重放副本绕过活日志修订。
    public func belongsTo(activeId: String, log: SessionLog): Bool {
        if (activeId != sessionId || !refEq(log, boundLog)) {
            return false
        }
        try {
            requireBinding()
            let current = SessionWorkspace(log)
            return current.available() && current.revision() == workspaceRevision &&
                canonicalize(current.directory()).toString() == workspace
        } catch (_: Exception) {
            return false
        }
    }

    private func requireBinding(): Unit {
        if (!state.available() || state.revision() != workspaceRevision || canonicalize(state.directory()).toString() !=
            workspace || FileInfo(workspace) != workspaceInfo) {
            throw Exception("knowledge-index-host-workspace-changed")
        }
    }

    // 参数沿用 core 闭集，不代填/覆盖客户端的 workspace 或修订，旧请求不能被悄悄升级。
    // core 在 search 中逐条 verify，只把 current digest 放进 matches；其 excerpt 不会序列化。
    // 所有方法均不调用 KnowledgeStore.reference/prepare，不返回原文，也不回退到全文检索。
    public func dispatch(method: String, params: String, token!: TurnToken = TurnToken()): String {
        if (!KnowledgeIndexHostRpc.handles(method)) {
            throw Exception("unsupported:knowledge-index-method")
        }
        requireBinding()
        let result = rpc.dispatch(method, params, token: token)
        requireBinding()
        if (token.cancelled()) {
            throw Exception("knowledge-index-host-cancelled")
        }
        return result
    }

    // 与现有 Host request 入口一致：body 是完整 JSON-RPC 请求，idText 是已解析的 JSON id。
    // 不在 main.cj 注册；调度方可先 handles，再 request，或自行为 dispatch 结果封帧。
    public func request(method: String, body: String, idText: String, activeId: String, log: SessionLog,
        token!: TurnToken = TurnToken()): Bool {
        if (!KnowledgeIndexHostRpc.handles(method)) {
            return false
        }
        try {
            if (!belongsTo(activeId, log)) {
                throw Exception("knowledge-index-host-binding-changed")
            }
            if (body.size > 12599296) {
                throw Exception("knowledge-index-rpc-capacity")
            }
            let params = JsonValue.fromStr(body).asObject().get("params").getOrThrow().asObject().toString()
            let result = dispatch(method, params, token: token)
            if (!belongsTo(activeId, log)) {
                throw Exception("knowledge-index-host-binding-changed")
            }
            if (token.cancelled()) {
                throw Exception("knowledge-index-host-cancelled")
            }
            emit(okFrame(idText, result))
        } catch (e: Exception) {
            // 不把 JSON/文件系统异常中的正文、路径或请求内容带入协议错误。
            let reason = if (e.message.startsWith("knowledge-index-") || e.message ==
                "unsupported:knowledge-index-method") {
                e.message
            } else {
                "knowledge-index-host-request-rejected"
            }
            emit(errFrame(idText, if (reason == "knowledge-index-rpc-revision-conflict") {
                -32031
            } else {
                -32003
            }, reason))
        }
        return true
    }
}
