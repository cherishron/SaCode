package core

import std.collection.HashMap
import std.sync.*

// ACP 授权/信息桥：把外部 Agent 的 session/request_permission 与 elicitation/create
// 转发给 ApprovalDesk 发号，绑定不可变提案字节（sessionId:delegationId:摘要:原文）。
// 回传时用 consumeExactForCall 做精确匹配，禁止跨委派复用（REQ-APPR-07）。
// 写操作不自动批准（REQ-APPR-01），提案不可变（REQ-APPR-02）。

public class AcpPermissionProposal {
    public let tool: String
    public let summary: String
    public let raw: String
    public init(tool: String, summary: String, raw: String) {
        this.tool = tool
        this.summary = summary
        this.raw = raw
    }
}


public class AcpApprovalBridge {
    let desk: ApprovalDesk
    let delegations: AcpDelegationService
    let sessionId: String
    // approvalId → (delegationId, proposal) 内部映射，用于回传时重建不可变提案字节
    let approvalProposals = HashMap<Int64, (String, AcpPermissionProposal)>()
    let mtx = Mutex()

    public init(desk: ApprovalDesk, delegations: AcpDelegationService, sessionId: String) {
        this.desk = desk
        this.delegations = delegations
        this.sessionId = sessionId
    }

    // 构造工单参数字节：sessionId:delegationId:摘要:提案原文（不可变）
    public func permissionArguments(delegationId: String, proposal: AcpPermissionProposal): String {
        return "${sessionId}:${delegationId}:${proposal.summary}:${proposal.raw}"
    }

    // 发号：绑定 delegationId + 不可变提案；返回 approvalId
    public func askPermission(delegationId: String, proposal: AcpPermissionProposal): Int64 {
        let args = permissionArguments(delegationId, proposal)
        let id = desk.askForCall(proposal.tool, args, ttl: 120)
        mtx.lock()
        try {
            approvalProposals[id] = (delegationId, proposal)
        } finally {
            mtx.unlock()
        }
        return id
    }

    // 回传批准/拒绝：只认 allowed-once/denied
    // 批准时用 consumeExactForCall 精确匹配（提案变化使批准失效）
    // 拒绝即不执行，不消费工单
    public func answerPermission(approvalId: Int64, decision: String): Bool {
        if (decision != "allowed-once" && decision != "denied") {
            return false
        }
        // 取回发号时绑定的提案
        var proposalOpt: Option<AcpPermissionProposal> = None
        var delegationId = ""
        mtx.lock()
        try {
            if (let Some(pair) <- approvalProposals.get(approvalId)) {
                delegationId = pair[0]
                proposalOpt = Some(pair[1])
            }
        } finally {
            mtx.unlock()
        }
        if (proposalOpt.isNone()) {
            return false
        }
        let proposal = proposalOpt.getOrThrow()
        if (decision == "allowed-once") {
            let args = permissionArguments(delegationId, proposal)
            let grant = desk.consumeExactForCall(approvalId, proposal.tool, args)
            return grant == "allowed-once"
        }
        // denied：直接记录到 desk
        return desk.answer(approvalId, "denied")
    }

    // elicitation 回传：submitted/abandoned/expired
    public func answerElicitation(requestId: String, decision: String, values: String): Bool {
        var valid = false
        for (d in acpElicitationDecisions) {
            if (d == decision) {
                valid = true
            }
        }
        if (!valid) {
            return false
        }
        // 由 AcpDelegationService 记录 elicitation 结果
        delegations.onElicitation("", requestId, "${decision}:${values}")
        return true
    }

    // 查询某委派待决工单数
    public func pendingFor(delegationId: String): Int64 {
        // 简化：返回 desk 全局 pending 数（生产需按 delegation 过滤）
        return desk.pendingCount()
    }
}