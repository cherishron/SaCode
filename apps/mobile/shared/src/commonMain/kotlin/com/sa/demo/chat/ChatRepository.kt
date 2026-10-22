package com.sa.demo.chat

import com.sa.demo.auth.AuthException
import com.sa.demo.auth.saaiJson
import com.sa.demo.core.platform.CancelToken
import com.sa.demo.core.platform.HttpRequest
import com.sa.demo.core.platform.HttpResponse
import com.sa.demo.core.platform.httpExecuteBlocking
import com.sa.demo.core.platform.httpStreamSse
import com.sa.demo.env.SaaiEnv
import com.sa.demo.storage.SecureStoreKeys
import com.sa.demo.storage.SecureStores

object ChatRepository {

    fun requireApiKey(): String =
        SecureStores.get().getString(SecureStoreKeys.API_KEY)
            ?: throw AuthException("未登录或缺少网关 api_key，请先完成登录")

    /** 非流式对话（阻塞；后台线程调用）。 */
    fun complete(
        env: SaaiEnv,
        model: String,
        messages: List<ChatTurn>,
        maxTokens: Int = 256,
    ): String {
        val apiKey = requireApiKey()
        val body = saaiJson.encodeToString(
            ChatCompletionRequest.serializer(),
            ChatCompletionRequest(
                model = model,
                messages = messages.map { ChatMessage(it.role, it.content) },
                maxTokens = maxTokens,
                stream = false,
            ),
        )
        val resp = httpExecuteBlocking(
            HttpRequest(
                method = "POST",
                url = chatUrl(env),
                headers = mapOf(
                    "Authorization" to "Bearer $apiKey",
                    "Content-Type" to "application/json",
                    "Accept" to "application/json",
                ),
                body = body,
            )
        )
        return parseCompletion(resp)
    }

    /**
     * 流式对话：[onDelta] 增量回调；返回拼接后的完整回复。
     * 阻塞 API，须在后台线程调用。
     *
     * 传入 [token] 可中途取消：取消后立即停止读取并返回**已产出的部分内容**
     *（不抛异常），调用方据此把半截回复落库即可。
     *
     * [onDelta] 刻意置于最后，使调用方可用尾随 lambda 书写。
     */
    fun completeStream(
        env: SaaiEnv,
        model: String,
        messages: List<ChatTurn>,
        maxTokens: Int = 512,
        token: CancelToken = CancelToken(),
        onDelta: (String) -> Unit,
    ): String {
        val apiKey = requireApiKey()
        val body = saaiJson.encodeToString(
            ChatCompletionRequest.serializer(),
            ChatCompletionRequest(
                model = model,
                messages = messages.map { ChatMessage(it.role, it.content) },
                maxTokens = maxTokens,
                stream = true,
            ),
        )
        val acc = StringBuilder()
        httpStreamSse(
            HttpRequest(
                method = "POST",
                url = chatUrl(env),
                headers = mapOf(
                    "Authorization" to "Bearer $apiKey",
                    "Content-Type" to "application/json",
                    "Accept" to "text/event-stream",
                ),
                body = body,
            ),
            token,
        ) { line ->
            val payload = parseSseDataLine(line) ?: return@httpStreamSse
            if (payload == "[DONE]") return@httpStreamSse
            val delta = parseDelta(payload) ?: return@httpStreamSse
            if (delta.isNotEmpty()) {
                acc.append(delta)
                onDelta(delta)
            }
        }
        return acc.toString()
    }

    fun chatUrl(env: SaaiEnv): String = "${env.gatewayUrl.trimEnd('/')}/v1/chat/completions"

    fun parseSseDataLine(line: String): String? {
        val trimmed = line.trim()
        if (!trimmed.startsWith("data:")) return null
        return trimmed.removePrefix("data:").trim().takeIf { it.isNotEmpty() }
    }

    fun parseDelta(json: String): String? {
        return try {
            val resp = saaiJson.decodeFromString(ChatCompletionResponse.serializer(), json)
            resp.choices.firstOrNull()?.delta?.content
                ?: resp.choices.firstOrNull()?.message?.content
        } catch (_: Exception) {
            null
        }
    }

    private fun parseCompletion(resp: HttpResponse): String {
        if (!resp.isSuccess) {
            throw AuthException("对话失败 HTTP ${resp.statusCode}: ${resp.body.take(300)}", resp.statusCode)
        }
        val parsed = try {
            saaiJson.decodeFromString(ChatCompletionResponse.serializer(), resp.body)
        } catch (e: Exception) {
            throw AuthException("对话响应解析失败: ${e.message}")
        }
        val content = parsed.choices.firstOrNull()?.message?.content
        if (content.isNullOrBlank()) {
            throw AuthException("对话返回为空：${resp.body.take(200)}")
        }
        return content
    }
}
