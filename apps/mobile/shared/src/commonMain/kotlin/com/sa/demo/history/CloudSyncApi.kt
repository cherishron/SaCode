package com.sa.demo.history

import com.sa.demo.core.platform.HttpRequest
import com.sa.demo.core.platform.HttpResponse
import com.sa.demo.core.platform.httpExecuteBlocking
import com.sa.demo.env.SaaiEnv

/**
 * 云端任务 / 历史同步契约（客户端侧骨架）。
 *
 * 产品线现状（2026-09-21）：
 * - sa-idp / gateway **尚无** end-user 对话历史与任务 API。
 * - 网关 `call_logs` 是计费审计，**不是**会话正文同步源（有脱敏与保留策略）。
 * - SaCode 会话/项目知识在桌面本地（SQLite / .sacode）。
 *
 * 因此 M2.5：历史 **本地优先**（按 IdP user 隔离）+ 任务在会话内建模；
 * 云端 sync 待产品线补齐下列端点后切换。
 *
 * 建议未来契约（gateway 或独立 collab 服务，Bearer sa-xxx / access_token）：
 * ```
 * GET  /api/me/history?since=<rev>          拉取用户对话/项目增量
 * PUT  /api/me/history                       批量上传 dirty 项
 * GET  /api/me/projects
 * POST /api/me/tasks                         提交云端任务 {title, payload, conversation_id}
 * GET  /api/me/tasks/{id}                    查询任务状态
 * POST /api/me/tasks/{id}/cancel
 * ```
 */
object CloudSyncApi {

    data class SyncResult(
        val supported: Boolean,
        val detail: String,
        val pulledConversations: Int = 0,
        val pushedConversations: Int = 0,
    )

    data class TaskSubmitResult(
        val supported: Boolean,
        val taskId: String?,
        val detail: String,
    )

    fun historyPullUrl(env: SaaiEnv): String =
        "${env.gatewayUrl.trimEnd('/')}/api/me/history"

    fun taskcreateUrl(env: SaaiEnv): String =
        "${env.gatewayUrl.trimEnd('/')}/api/me/tasks"

    /** 探测云端是否已提供用户历史接口。 */
    fun probeHistorySupport(env: SaaiEnv, bearer: String): SyncResult {
        return try {
            val resp = httpExecuteBlocking(
                HttpRequest(
                    method = "GET",
                    url = historyPullUrl(env),
                    headers = mapOf(
                        "Authorization" to "Bearer $bearer",
                        "Accept" to "application/json",
                    ),
                )
            )
            when {
                resp.statusCode == 404 || resp.statusCode == 405 ->
                    SyncResult(false, "云端历史接口未就绪（HTTP ${resp.statusCode}），使用本地历史")
                resp.isSuccess ->
                    SyncResult(true, "云端历史接口可用", pulledConversations = 0)
                resp.statusCode == 401 || resp.statusCode == 403 ->
                    SyncResult(false, "云端历史接口鉴权失败，继续本地")
                else ->
                    SyncResult(false, "云端历史探测 HTTP ${resp.statusCode}")
            }
        } catch (e: Exception) {
            SyncResult(false, "云端不可达：${e.message}，使用本地历史")
        }
    }

    /**
     * 提交云端任务。接口未就绪时返回 supported=false，调用方应标 unsupported，
     * 不得回退网关 chat 并宣称任务已完成。
     */
    fun submitTask(
        env: SaaiEnv,
        bearer: String,
        title: String,
        payload: String,
        conversationId: String?,
    ): TaskSubmitResult {
        val url = taskcreateUrl(env)
        val body = buildString {
            append("{")
            append("\"title\":").append('"').append(title.replace("\"", "\\\"")).append('"')
            append(",\"payload\":").append('"').append(payload.replace("\"", "\\\"")).append('"')
            if (!conversationId.isNullOrBlank()) {
                append(",\"conversation_id\":").append('"').append(conversationId).append('"')
            }
            append("}")
        }
        return try {
            val resp = httpExecuteBlocking(
                HttpRequest(
                    method = "POST",
                    url = url,
                    headers = mapOf(
                        "Authorization" to "Bearer $bearer",
                        "Content-Type" to "application/json",
                        "Accept" to "application/json",
                    ),
                    body = body,
                )
            )
            when {
                resp.statusCode == 404 || resp.statusCode == 405 ->
                    TaskSubmitResult(false, null, "云端任务接口未就绪")
                resp.isSuccess ->
                    TaskSubmitResult(true, extractTaskId(resp.body), "任务已提交")
                resp.statusCode == 401 || resp.statusCode == 403 ->
                    TaskSubmitResult(false, null, "任务接口鉴权失败")
                else ->
                    TaskSubmitResult(false, null, "任务提交 HTTP ${resp.statusCode}")
            }
        } catch (e: Exception) {
            TaskSubmitResult(false, null, "任务接口不可达：${e.message}")
        }
    }

    private fun extractTaskId(body: String): String? {
        val key = "\"task_id\""
        val i = body.indexOf(key)
        if (i < 0) return null
        val after = body.substring(i + key.length)
        val q1 = after.indexOf('"')
        if (q1 < 0) return null
        val q2 = after.indexOf('"', q1 + 1)
        if (q2 < 0) return null
        return after.substring(q1 + 1, q2)
    }
}
