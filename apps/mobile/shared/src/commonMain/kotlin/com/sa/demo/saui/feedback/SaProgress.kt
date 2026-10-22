package com.sa.demo.saui.feedback

import com.sa.demo.saui.token.SaUIColors
import com.sa.demo.saui.token.SaUIRadius
import com.tencent.kuikly.core.base.Color
import com.tencent.kuikly.core.base.ViewBuilder
import com.tencent.kuikly.core.views.View

object SaProgress {

    enum class Variant { LINE, CIRCLE }

    enum class Status { DEFAULT, SUCCESS, ERROR, WARNING }

    private fun statusColor(status: Status): String = when (status) {
        Status.DEFAULT -> SaUIColors.BrandPrimary
        Status.SUCCESS -> SaUIColors.Success
        Status.WARNING -> SaUIColors.Warning
        Status.ERROR -> SaUIColors.Error
    }

    fun build(
        percentage: Float = 0f,
        variant: Variant = Variant.LINE,
        status: Status = Status.DEFAULT,
        strokeWidth: Float = 6f
    ): ViewBuilder = {
        val clamped = percentage.coerceIn(0f, 100f)
        val color = statusColor(status)
        val bgColor = SaUIColors.BgComponent

        View {
            attr {
                when (variant) {
                    Variant.LINE -> {
                        height(strokeWidth)
                        borderRadius(strokeWidth / 2)
                        backgroundColor(Color.parseString16ToLong(bgColor))
                    }
                    Variant.CIRCLE -> {
                        size(80f, 80f)
                        borderRadius(40f)
                        border(com.tencent.kuikly.core.base.Border(
                            strokeWidth,
                            com.tencent.kuikly.core.base.BorderStyle.SOLID,
                            Color(Color.parseString16ToLong(bgColor))
                        ))
                    }
                }
            }

            if (variant == Variant.LINE && clamped > 0f) {
                View {
                    attr {
                        val parentWidth = 300f
                        val w = parentWidth * (clamped / 100f)
                        size(w, strokeWidth)
                        borderRadius(strokeWidth / 2)
                        backgroundColor(Color.parseString16ToLong(color))
                        absolutePosition(top = 0f, left = 0f)
                    }
                }
            }
        }
    }
}
