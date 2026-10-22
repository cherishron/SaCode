package com.sa.demo.saui.feedback

import com.sa.demo.saui.token.SaUIColors
import com.sa.demo.saui.token.SaUIRadius
import com.sa.demo.saui.token.SaUISpacing
import com.tencent.kuikly.core.base.Color
import com.tencent.kuikly.core.base.ViewBuilder
import com.tencent.kuikly.core.layout.FlexAlign
import com.tencent.kuikly.core.layout.FlexPositionType
import com.tencent.kuikly.core.views.Text
import com.tencent.kuikly.core.views.View
import com.tencent.kuikly.core.views.layout.Row

object SaToast {

    enum class Type {
        SUCCESS, ERROR, WARNING, INFO, LOADING
    }

    fun build(
        message: String,
        type: Type = Type.INFO,
        duration: Int = 2000,
        visible: Boolean = true
    ): ViewBuilder = {
        if (visible) {
            val bgColor = Color.parseString16ToLong(SaUIColors.TextPrimarySolid)

            View {
                attr {
                    positionType(FlexPositionType.ABSOLUTE)
                    top(50f)
                    left(0f)
                    right(0f)
                    zIndex(9999)
                    alignItems(FlexAlign.CENTER)
                }
                    Row {
                        attr {
                            padding(
                                top = SaUISpacing.md,
                                bottom = SaUISpacing.md,
                                left = SaUISpacing.lg,
                                right = SaUISpacing.lg
                            )
                            backgroundColor((bgColor and 0x00FFFFFF) or 0xCC000000)
                            borderRadius(SaUIRadius.Medium)
                            alignItems(FlexAlign.CENTER)
                        }

                    Text {
                        attr {
                            text(resolveIcon(type))
                            fontSize(16f)
                            margin(right = SaUISpacing.sm)
                        }
                    }

                    Text {
                        attr {
                            text(message)
                            fontSize(14f)
                            color(Color.WHITE)
                        }
                    }
                }
            }
        }
    }

    private fun resolveIcon(type: Type): String = when (type) {
        Type.SUCCESS -> "\u2713"
        Type.ERROR -> "\u2715"
        Type.WARNING -> "!"
        Type.INFO -> "i"
        Type.LOADING -> "\u25CB"
    }
}
