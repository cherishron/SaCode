// 会话/审批/取消这三个面的取值模型：必填字段缺失即拒，可选显示字段才允许默认。
//
// 这条区分是产品红线：把缺失的 sessionId 默认成空串，客户端就敢把消息发到
// 「当前会话」——而 0.2 之后没有「当前会话」这回事，归属必须显式。
package sacode

// 线格式按 daemon 实际回的字段名走：目录条目是 `id`/`durable`/`status`/`title`/
// `workspaceDirectory`，而**请求**里的归属键是 `workspaceId`——两侧不对称，
// 客户端必须照各自的名字读，不能自己造一个「sessionId」然后默认填空。
class SessionModel(
    val sessionId: String,
    val title: String,
    val workspaceDirectory: String,
    val durable: Boolean,
    val status: String
) {

    companion object {
        fun from(v: Map<String, Any?>): SessionModel = SessionModel(
            requiredString(v, "id"),
            optionalString(v, "title"),
            optionalString(v, "workspaceDirectory"),
            requiredBoolean(v, "durable"),
            requiredString(v, "status")
        )

        fun list(v: Any?): List<SessionModel> = Json.arr(v).map { from(Json.obj(it)) }

        private fun requiredString(v: Map<String, Any?>, key: String): String {
            val raw = v[key] ?: throw IllegalArgumentException("missing-required-field:$key")
            if (raw !is String) throw IllegalArgumentException("field-not-string:$key")
            if (raw.isBlank()) throw IllegalArgumentException("blank-required-field:$key")
            return raw
        }

        private fun requiredBoolean(v: Map<String, Any?>, key: String): Boolean {
            val raw = v[key] ?: throw IllegalArgumentException("missing-required-field:$key")
            if (raw !is Boolean) throw IllegalArgumentException("field-not-boolean:$key")
            return raw
        }

        private fun optionalString(v: Map<String, Any?>, key: String): String {
            val raw = v[key] ?: return ""
            if (raw !is String) throw IllegalArgumentException("field-not-string:$key")
            return raw
        }
    }
}

class ApprovalDraft(
    private val approvalId: String,
    private val decision: String,
    private val sessionId: String,
    private val selfReported: String? = null
) {
    fun withSelfReportedApproval(value: String): ApprovalDraft =
        ApprovalDraft(approvalId, decision, sessionId, value)

    // 审批凭据只能是工单号：自报审批字符串在这条面上没有通路（与桌面 preload 同口径）。
    fun paramsJson(): String {
        if (approvalId.isBlank()) throw IllegalArgumentException("approval-id-required")
        if (sessionId.isBlank()) throw IllegalArgumentException("session-id-required")
        if (decision != "approve" && decision != "deny") throw IllegalArgumentException("approval-decision-invalid")
        if (selfReported != null) throw IllegalArgumentException("self-reported-approval-has-no-channel")
        return Json.stringify(
            linkedMapOf<String, Any?>("sessionId" to sessionId, "approvalId" to approvalId, "decision" to decision)
        )
    }
}

object TurnOps {
    fun cancelParams(sessionId: String, operationId: String): String {
        if (sessionId.isBlank()) throw IllegalArgumentException("session-id-required")
        if (operationId.isBlank()) throw IllegalArgumentException("operation-id-required")
        return Json.stringify(linkedMapOf<String, Any?>("sessionId" to sessionId, "operationId" to operationId))
    }
}
