package com.sa.demo.saui.chat

import com.sa.demo.chat.ChatUiMessage
import com.sa.demo.saui.token.SaUIColors
import com.tencent.kuikly.core.base.Color
import com.tencent.kuikly.core.base.PagerScope
import com.tencent.kuikly.core.base.ViewContainer
import com.tencent.kuikly.core.directives.vbind
import com.tencent.kuikly.core.directives.vfor
import com.tencent.kuikly.core.reactive.handler.observable
import com.tencent.kuikly.core.reactive.handler.observableList
import com.tencent.kuikly.core.views.Text
import com.tencent.kuikly.core.views.View
import com.tencent.kuiklybase.KuiklyStreamingMarkdown
import com.tencent.kuiklybase.config.MarkdownColors
import com.tencent.kuiklybase.config.MarkdownConfig
import com.tencent.kuiklybase.streaming.MarkdownBlock
import com.tencent.kuiklybase.streaming.MarkdownStreamingState
import org.intellij.markdown.MarkdownElementTypes
import org.intellij.markdown.ast.ASTNode

/** 只控制消息气泡，不代表 SaUI 或整个 App 已支持系统深色模式。 */
enum class SaMarkdownTheme { LIGHT, DARK }

fun SaMarkdownTheme.assistantBackground(): Long = if (this == SaMarkdownTheme.DARK) {
    0xFF252525L
} else Color.parseString16ToLong(SaUIColors.BgComponent)

/** 不注入链接事件、不创建浏览器或脚本执行能力。图片由块级安全策略阻断。 */
fun SaMarkdownTheme.markdownConfig(): MarkdownConfig = MarkdownConfig(
    colors = if (this == SaMarkdownTheme.DARK) MarkdownColors(
        text = 0xFFF0F0F0L,
        codeBackground = 0xFF181818L,
        inlineCodeBackground = 0xFF383838L,
        dividerColor = 0xFF606060L,
        tableBackground = 0xFF303030L,
        blockQuoteBar = 0xFF91A7FFL,
        blockQuoteBackground = 0xFF303344L,
        linkColor = 0xFF9BBFFFL,
        codeText = 0xFFE7E7E7L,
    ) else MarkdownColors(
        text = Color.parseString16ToLong(SaUIColors.TextPrimarySolid),
        codeBackground = 0xFFF5F5F5L,
        inlineCodeBackground = 0xFFD8D8D8L,
        dividerColor = 0xFFAAAAAAL,
        tableBackground = assistantBackground(),
        blockQuoteBar = 0xFF0052D9L,
        blockQuoteBackground = 0xFFDDE5F5L,
        linkColor = Color.parseString16ToLong(SaUIColors.BrandPrimary),
        codeText = 0xFF1A1A1AL,
    ),
    onLinkLongPress = null,
    codeHighlightDarkTheme = this == SaMarkdownTheme.DARK,
)

internal data class SaMarkdownBlock(
    val block: MarkdownBlock,
    val structure: String,
    val references: String,
    val plainTextOnly: Boolean,
)

/** 每条 UI 消息独占的渲染状态，不进入业务日志和序列化消息。库仍对完整文本解析 AST。 */
class ChatMessageRenderer(message: ChatUiMessage, private val owner: PagerScope? = null) : PagerScope {
    override val pagerId: String get() = owner?.pagerId ?: ""
    val key: Any = message.renderKey
    val role: String = message.role
    val markdownState = MarkdownStreamingState()
    internal var blocks by observableList<SaMarkdownBlock>()
        private set
    var content by observable("")
        private set
    var streaming by observable(false)
        private set
    var retryable by observable(false)
        private set
    private var initialized = false

    init { update(message) }

    fun update(message: ChatUiMessage) {
        require(message.renderKey === key && message.role == role)
        val reset = initialized && (!message.content.startsWith(content) || (!streaming && message.streaming))
        if (role != "user") {
            if (reset) {
                markdownState.reset()
                blocks.clear()
            }
            val finalFlush = initialized && streaming && !message.streaming
            val parsed = markdownState.update(message.content, force = finalFlush)
            if (parsed != null) {
                // 与库的递归引用收集保持一致：后置的嵌套定义、内联链接也可能改变早期块语义。
                val references = buildString {
                    markdownState.blockNodes.forEach { it.appendReferenceSignature(message.content, this) }
                }
                val next = parsed.map { block ->
                    val node = markdownState.blockNodes[block.blockIndex]
                    SaMarkdownBlock(block, node.structure(), references, node.containsImage())
                }
                // 精确比较内容及 AST 结构，不只比较库的 hash id，避免吞掉变化和引用解析变化。
                var prefix = 0
                // 收束时统一失效一次，不能把 force 重新解析误认为会自动刷新旧视图。
                while (!finalFlush && prefix < blocks.size && prefix < next.size && blocks[prefix] == next[prefix]) prefix++
                while (blocks.size > prefix) blocks.removeAt(blocks.lastIndex)
                blocks.addAll(next.drop(prefix))
            }
        }
        content = message.content
        streaming = message.streaming
        retryable = message.retryable
        initialized = true
    }
}

private fun ASTNode.structure(): String = buildString {
    append(type.name)
    append('(')
    children.forEach { append(it.structure()); append(',') }
    append(')')
}

private fun ASTNode.appendReferenceSignature(content: String, output: StringBuilder) {
    if (type == MarkdownElementTypes.LINK_DEFINITION ||
        type == MarkdownElementTypes.INLINE_LINK || type == MarkdownElementTypes.AUTOLINK) {
        val source = content.substring(startOffset, endOffset)
        // 长度前缀避免不同节点拼接产生相同签名；不使用可能碰撞的 hashCode。
        output.append(type.name).append(':').append(source.length).append(':').append(source).append(';')
    }
    children.forEach { it.appendReferenceSignature(content, output) }
}

private fun ASTNode.containsImage(): Boolean =
    type == MarkdownElementTypes.IMAGE || children.any { it.containsImage() }

/** 普通组件样例保持兼容；真实聊天必须传入页面持久持有的 renderer。 */
fun ViewContainer<*, *>.SaMarkdown(content: String, theme: SaMarkdownTheme = SaMarkdownTheme.LIGHT) {
    SaMarkdown(ChatMessageRenderer(ChatUiMessage("assistant", content), this), theme = { theme })
}

fun ViewContainer<*, *>.SaMarkdown(
    renderer: ChatMessageRenderer,
    theme: () -> SaMarkdownTheme = { SaMarkdownTheme.LIGHT },
) {
    vfor({ renderer.blocks }) { item ->
        View {
            // 只有显式换主题才重建当前块；delta 由块列表增删驱动，不重建整条消息。
            vbind({ theme() }) {
                val config = theme().markdownConfig()
                if (item.plainTextOnly) {
                    // 库的列表/引用递归会恢复默认组件；含图片的块统一只显示原文，绝不创建 Image。
                    Text {
                        attr { text(item.block.blockContent); fontSize(15f); color(config.colors.text) }
                    }
                } else {
                    KuiklyStreamingMarkdown(renderer.markdownState, item.block, config)
                }
            }
        }
    }
}
