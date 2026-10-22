package com.sa.demo.chat

/**
 * 重试前的会话回退：把「末尾的助手轮 + 紧随其后的用户轮」摘掉。
 *
 * [ChatPage.retryLast] 依赖这段纯逻辑——它要同时覆盖两条路径：
 * - **发送失败**：onFailure 已删掉 user 轮，history 末尾没有 user 可摘
 * - **用户停止**：onSuccess 追加了 assistant 轮，history 末尾是 user，必须摘掉，
 *   否则 [ChatPage.send] 会把它再追加一次，产生两条相同的 user 记录
 *
 * 纯函数便于断言，避免只能靠真机点按验证。
 */
object RetryRewind {

    /**
     * @param turns 当前 history（[com.sa.demo.chat.ChatTurn] 列表）
     * @return 回退后的新列表；原列表不变
     */
    fun rewind(turns: List<ChatTurn>): List<ChatTurn> {
        val out = turns.toMutableList()
        if (out.isNotEmpty() && out.last().role == "assistant") {
            out.removeAt(out.lastIndex)
        }
        if (out.isNotEmpty() && out.last().role == "user") {
            out.removeAt(out.lastIndex)
        }
        return out
    }
}
