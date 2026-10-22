package com.sa.demo.saui.feedback

import com.sa.demo.saui.token.SaUIColors
import com.sa.demo.saui.token.SaUIRadius
import com.sa.demo.saui.token.SaUISpacing
import com.tencent.kuikly.core.base.Color
import com.tencent.kuikly.core.base.ViewBuilder
import com.tencent.kuikly.core.views.Text
import com.tencent.kuikly.core.views.View
import com.tencent.kuikly.core.views.layout.Column

object SaSkeleton {

    enum class Variant { RECT, CIRCLE, TEXT, CARD }

    fun build(
        variant: Variant = Variant.RECT,
        width: Float = 200f,
        height: Float = 16f,
        count: Int = 1,
        animated: Boolean = true
    ): ViewBuilder = {
        val bgColor = SaUIColors.BgComponent

        Column {
            repeat(count) {
                val h = when (variant) {
                    Variant.CIRCLE -> width
                    Variant.CARD -> 80f
                    Variant.TEXT -> 16f
                    Variant.RECT -> height
                }
                val w = when (variant) {
                    Variant.CIRCLE -> width
                    Variant.CARD -> width
                    Variant.TEXT -> width
                    Variant.RECT -> width
                }
                val radius = when (variant) {
                    Variant.CIRCLE -> width / 2
                    Variant.CARD -> SaUIRadius.Medium
                    Variant.TEXT -> 4f
                    Variant.RECT -> 4f
                }

                if (variant == Variant.CARD) {
                    View {
                        attr {
                            size(w, h)
                            borderRadius(radius)
                            backgroundColor(Color.parseString16ToLong(bgColor))
                            marginBottom(SaUISpacing.sm)
                            padding(SaUISpacing.md, SaUISpacing.md, SaUISpacing.md, SaUISpacing.md)
                        }
                        Column {
                            View {
                                attr {
                                    width(w * 0.6f)
                                    height(14f)
                                    borderRadius(4f)
                                    backgroundColor(Color.parseString16ToLong(SaUIColors.BgContainer))
                                    marginBottom(SaUISpacing.xs)
                                }
                            }
                            View {
                                attr {
                                    width(w * 0.8f)
                                    height(12f)
                                    borderRadius(4f)
                                    backgroundColor(Color.parseString16ToLong(SaUIColors.BgContainer))
                                }
                            }
                        }
                    }
                } else {
                    View {
                        attr {
                            size(w, h)
                            borderRadius(radius)
                            backgroundColor(Color.parseString16ToLong(bgColor))
                            if (it < count - 1) marginBottom(SaUISpacing.sm)
                        }
                    }
                }
            }
        }
    }
}
