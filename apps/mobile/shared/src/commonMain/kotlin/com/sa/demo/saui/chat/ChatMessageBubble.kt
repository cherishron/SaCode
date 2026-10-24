package com.sa.demo.saui.chat

import com.sa.demo.chat.ChatUiMessage
import com.sa.demo.saui.token.SaUIColors
import com.sa.demo.saui.token.SaUIRadius
import com.sa.demo.saui.token.SaUISpacing
import com.tencent.kuikly.core.base.Color
import com.tencent.kuikly.core.base.ViewBuilder
import com.tencent.kuikly.core.directives.vif
import com.tencent.kuikly.core.layout.FlexAlign
import com.tencent.kuikly.core.layout.FlexJustifyContent
import com.tencent.kuikly.core.views.Text
import com.tencent.kuikly.core.views.View
import com.tencent.kuikly.core.views.layout.Row

/** 用户原文与助手 Markdown 气泡；复制、光标、重试由调用方控制。 */
object ChatMessageBubble {
    enum class Role { USER, ASSISTANT }
    const val RETRY_LABEL = "重试"

    fun build(
        content: String,
        role: Role,
        streaming: Boolean = false,
        onCopy: (() -> Unit)? = null,
        onRetry: (() -> Unit)? = null,
        theme: SaMarkdownTheme = SaMarkdownTheme.LIGHT,
    ): ViewBuilder = {
        val renderer = ChatMessageRenderer(ChatUiMessage(
            if (role == Role.USER) "user" else "assistant", content, streaming, retryable = onRetry != null,
        ), this)
        build(renderer, { theme }, onCopy, onRetry).invoke(this)
    }

    /** 流式页面复用同一个 renderer，参数读取留在响应式 attr/指令闭包内。 */
    fun build(
        renderer: ChatMessageRenderer,
        theme: () -> SaMarkdownTheme = { SaMarkdownTheme.LIGHT },
        onCopy: (() -> Unit)? = null,
        onRetry: (() -> Unit)? = null,
    ): ViewBuilder = {
        val isUser = renderer.role == "user"
        Row {
            attr {
                justifyContent(if (isUser) FlexJustifyContent.FLEX_END else FlexJustifyContent.FLEX_START)
                padding(left = SaUISpacing.md, right = SaUISpacing.md, top = SaUISpacing.xs, bottom = SaUISpacing.xs)
            }
            View {
                attr {
                    backgroundColor(if (isUser) Color.parseString16ToLong(SaUIColors.BrandPrimary) else theme().assistantBackground())
                    borderRadius(SaUIRadius.Medium)
                    padding(SaUISpacing.md, SaUISpacing.md, SaUISpacing.md, SaUISpacing.md)
                    maxWidth(280f)
                }
                if (onCopy != null) event { longPress { onCopy() } }
                if (isUser) {
                    // 一个原生 Text 直接绑定原文，保留空行、前后空白及围栏，不经过任何 Markdown 解析。
                    Text {
                        attr {
                            text(renderer.content)
                            fontSize(15f)
                            color(Color.parseString16ToLong(SaUIColors.TextAnti))
                        }
                    }
                } else {
                    SaMarkdown(renderer, theme)
                }
                vif({ renderer.streaming }) {
                    Row {
                        attr { marginTop(SaUISpacing.xs); alignItems(FlexAlign.CENTER) }
                        Text {
                            attr {
                                text("▍")
                                fontSize(12f)
                                color(if (isUser) Color.parseString16ToLong(SaUIColors.TextAnti) else theme().markdownConfig().colors.text)
                            }
                        }
                    }
                }
                if (onRetry != null) {
                    vif({ renderer.retryable }) {
                        Row {
                            attr { marginTop(SaUISpacing.xs); alignItems(FlexAlign.CENTER) }
                            Text {
                                attr {
                                    text(RETRY_LABEL)
                                    fontSize(12f)
                                    color(if (isUser) Color.parseString16ToLong(SaUIColors.TextAnti) else theme().markdownConfig().colors.linkColor)
                                }
                                event { click { onRetry() } }
                            }
                        }
                    }
                }
            }
        }
    }
}
