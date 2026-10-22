package com.sa.demo.saui.chat

/** Markdown 解析结果的一个片段。 */
sealed class MdBlock {
    /** 正文行。 */
    data class Text(val text: String) : MdBlock()

    /** 围栏代码块（``` … ```），[code] 已去除首尾空白。 */
    data class Code(val code: String) : MdBlock()
}

/**
 * 极简 Markdown 解析：只识别 ``` 围栏代码块，其余非空行按正文处理。
 *
 * 刻意保持简单——移动端聊天场景不需要完整 Markdown（表格/列表/内联样式等）。
 * 纯函数、无 Kuikly 依赖，因此可在 commonTest 中直接断言。
 */
object MdParser {

    private const val CODE_FENCE = "```"

    /**
     * 把消息正文切成 [MdBlock] 序列。
     *
     * 规则：
     * - 以 ``` 开头的行切换「代码态」；再次遇到 ``` 结束当前代码块
     * - 代码态内的行原样保留（含缩进），仅去掉末尾换行
     * - 正文态的空行/纯空白行被丢弃，避免连续留白
     * - 流式场景下末尾的 ``` 可能尚未到达：此时已缓存的代码仍作为一个 Code 块输出
     * - 兼容 CRLF：先归一化换行，避免行尾残留 `\r`
     */
    fun parse(content: String): List<MdBlock> {
        val blocks = mutableListOf<MdBlock>()
        val codeBuffer = StringBuilder()
        var inCode = false

        fun flushCode() {
            val code = codeBuffer.toString().trimEnd()
            if (code.isNotEmpty()) blocks += MdBlock.Code(code)
            codeBuffer.clear()
        }

        content.replace("\r\n", "\n").replace('\r', '\n').split("\n").forEach { line ->
            when {
                line.trimStart().startsWith(CODE_FENCE) -> {
                    if (inCode) {
                        flushCode()
                        inCode = false
                    } else {
                        inCode = true
                    }
                }

                inCode -> codeBuffer.append(line).append('\n')

                line.isNotBlank() -> blocks += MdBlock.Text(line.trimEnd())
            }
        }

        if (inCode) flushCode()
        return blocks
    }
}
