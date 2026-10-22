package com.sa.demo.saui.chat

import com.sa.demo.saui.token.SaUIColors
import com.sa.demo.saui.token.SaUIRadius
import com.sa.demo.saui.token.SaUISpacing
import com.tencent.kuikly.core.base.Color
import com.tencent.kuikly.core.base.ViewBuilder
import com.tencent.kuikly.core.layout.FlexAlign
import com.tencent.kuikly.core.layout.FlexJustifyContent
import com.tencent.kuikly.core.views.Text
import com.tencent.kuikly.core.views.View
import com.tencent.kuikly.core.views.layout.Row

/**
 * ChatMessageBubble：聊天消息气泡。
 * 支持用户/AI 左右对齐、极简 Markdown（围栏代码块）、流式光标。
 *
 * 交互：
 * - 传入 [onCopy] 后长按气泡即触发复制（移动端聊天的通用手势）
 * - 传入 [onRetry] 后气泡下方渲染「重试」入口；不传则不渲染，保持默认外观不变
 */
object ChatMessageBubble {

    enum class Role { USER, ASSISTANT }

    /** 「重试」入口文案，便于调用方统一多语言时替换。 */
    const val RETRY_LABEL = "重试"

    fun build(
        content: String,
        role: Role,
        streaming: Boolean = false,
        onCopy: (() -> Unit)? = null,
        onRetry: (() -> Unit)? = null
    ): ViewBuilder = {
        val isUser = role == Role.USER
        val bgColor = if (isUser) SaUIColors.BrandPrimary else SaUIColors.BgComponent
        val textColor = if (isUser) SaUIColors.TextAnti else SaUIColors.TextPrimarySolid
        val align = if (isUser) FlexJustifyContent.FLEX_END else FlexJustifyContent.FLEX_START

        Row {
            attr {
                justifyContent(align)
                padding(left = SaUISpacing.md, right = SaUISpacing.md, top = SaUISpacing.xs, bottom = SaUISpacing.xs)
            }

            View {
                attr {
                    backgroundColor(Color.parseString16ToLong(bgColor))
                    borderRadius(SaUIRadius.Medium)
                    padding(SaUISpacing.md, SaUISpacing.md, SaUISpacing.md, SaUISpacing.md)
                    maxWidth(280f)
                }

                // 长按复制：仅在调用方提供回调时绑定，避免无响应手势
                if (onCopy != null) {
                    event { longPress { onCopy() } }
                }

                // 简单 Markdown：代码块用等宽字体 + 背景区分
                renderContent(content, textColor).invoke(this)

                if (streaming) {
                    Row {
                        attr { marginTop(SaUISpacing.xs); alignItems(FlexAlign.CENTER) }
                        Text {
                            attr {
                                text("▍")
                                fontSize(12f)
                                color(Color.parseString16ToLong(textColor))
                            }
                        }
                    }
                }

                // 重试入口：仅在调用方提供回调时渲染（通常只给失败消息传）
                if (onRetry != null) {
                    Row {
                        attr { marginTop(SaUISpacing.xs); alignItems(FlexAlign.CENTER) }
                        Text {
                            attr {
                                text(RETRY_LABEL)
                                fontSize(12f)
                                color(
                                    Color.parseString16ToLong(
                                        // 用户气泡是蓝底，重试用白字保证对比度
                                        if (isUser) SaUIColors.TextAnti else SaUIColors.BrandPrimary
                                    )
                                )
                            }
                            event { click { onRetry() } }
                        }
                    }
                }
            }
        }
    }

    /**
     * 极简 Markdown 渲染：按行扫描，识别 ``` 围栏代码块，其余按正文逐行输出。
     * 返回 ViewBuilder 而非扩展函数——ViewBuilder 是 lambda 类型，
     * 作为扩展接收者会导致 `this` 不是 ViewContainer，View/Text 无法解析。
     */
    private fun renderContent(content: String, textColor: String): ViewBuilder = {
        val textColorLong = Color.parseString16ToLong(textColor)

        MdParser.parse(content).forEach { block ->
            when (block) {
                is MdBlock.Text -> Text {
                    attr {
                        text(block.text)
                        fontSize(BODY_FONT_SIZE)
                        color(textColorLong)
                        marginBottom(SaUISpacing.xxs)
                    }
                }

                is MdBlock.Code -> View {
                    attr {
                        backgroundColor(CODE_BG)
                        borderRadius(SaUIRadius.Small)
                        padding(SaUISpacing.sm, SaUISpacing.sm, SaUISpacing.sm, SaUISpacing.sm)
                        marginTop(SaUISpacing.xs)
                        marginBottom(SaUISpacing.xs)
                    }
                    Text {
                        attr {
                            text(block.code)
                            fontSize(CODE_FONT_SIZE)
                            color(CODE_FG)
                            fontFamily(MONOSPACE)
                        }
                    }
                }
            }
        }
    }

    private const val CODE_FENCE = "```"
    private const val MONOSPACE = "monospace"
    private const val BODY_FONT_SIZE = 15f
    private const val CODE_FONT_SIZE = 12f
    private const val CODE_BG = 0xFF1E1E1EL
    private const val CODE_FG = 0xFFD4D4D4L
}
