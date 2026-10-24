package com.sa.demo.chat

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement

@Serializable
data class ChatMessage(
    val role: String,
    val content: String,
)

@Serializable
data class ChatCompletionRequest(
    val model: String,
    val messages: List<ChatMessage>,
    @SerialName("max_tokens") val maxTokens: Int? = 256,
    val stream: Boolean = false,
    val temperature: Double? = null,
)

@Serializable
data class ChatChoiceMessage(
    val role: String? = null,
    val content: String? = null,
)

@Serializable
data class ChatChoice(
    val index: Int? = null,
    val message: ChatChoiceMessage? = null,
    val delta: ChatChoiceMessage? = null,
    @SerialName("finish_reason") val finishReason: String? = null,
)

@Serializable
data class ChatCompletionResponse(
    val id: String? = null,
    val `object`: String? = null,
    val model: String? = null,
    val choices: List<ChatChoice> = emptyList(),
    val error: JsonElement? = null,
)

data class ChatTurn(
    val role: String,
    val content: String,
)

data class ChatUiMessage(
    val role: String,
    val content: String,
    val streaming: Boolean = false,
    /** 该条回复是否可重发（发送失败 / 用户主动停止）。 */
    val retryable: Boolean = false,
    /** 仅供 UI 投影复用；copy 保留身份，不进入业务历史或序列化协议。 */
    val renderKey: Any = Any(),
) {
    val isUser: Boolean get() = role == "user"
}
