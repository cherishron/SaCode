package com.sa.demo.saui.foundation

import com.sa.demo.saui.token.SaUIColors
import com.sa.demo.saui.token.SaUIRadius
import com.tencent.kuikly.core.base.Color
import com.tencent.kuikly.core.base.ViewBuilder
import com.tencent.kuikly.core.layout.FlexAlign
import com.tencent.kuikly.core.layout.FlexJustifyContent
import com.tencent.kuikly.core.views.Text
import com.tencent.kuikly.core.views.View

object SaBadge {

    enum class Variant { DOT, COUNT }

    enum class Position { TOP_RIGHT, TOP_LEFT }

    fun build(
        text: String? = null,
        variant: Variant = Variant.COUNT,
        maxCount: Int = 99
    ): ViewBuilder = {
        val displayText = when {
            variant == Variant.DOT -> null
            text == null -> null
            text.toIntOrNull()?.let { if (it > maxCount) "$maxCount+" else text } != null ->
                text.toIntOrNull()?.let { if (it > maxCount) "$maxCount+" else text }
            else -> text
        }

        View {
            attr {
                backgroundColor(Color.parseString16ToLong(SaUIColors.Error))
                borderRadius(SaUIRadius.Round)
                if (variant == Variant.DOT) {
                    size(8f, 8f)
                } else {
                    val width = if (displayText != null && displayText.length > 1) 24f else 16f
                    size(width, 16f)
                    alignItems(FlexAlign.CENTER)
                    justifyContent(FlexJustifyContent.CENTER)
                }
            }
            if (displayText != null && variant == Variant.COUNT) {
                Text {
                    attr {
                        text(displayText)
                        fontSize(10f)
                        color(Color.WHITE)
                    }
                }
            }
        }
    }
}
