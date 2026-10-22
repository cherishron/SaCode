package com.sa.demo.saui.feedback

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

object SaPopup {

    enum class Placement { BOTTOM, TOP, CENTER, LEFT, RIGHT }

    fun build(
        visible: Boolean,
        placement: Placement = Placement.BOTTOM,
        title: String? = null,
        onClose: () -> Unit = {},
        content: ViewBuilder
    ): ViewBuilder = {
        if (visible) {
            View {
                attr {
                    absolutePosition(0f, 0f, 0f, 0f)
                    backgroundColor(0x80000000L)
                    when (placement) {
                        Placement.BOTTOM -> {
                            alignItems(FlexAlign.CENTER)
                            justifyContent(FlexJustifyContent.FLEX_END)
                        }
                        Placement.TOP -> {
                            alignItems(FlexAlign.CENTER)
                            justifyContent(FlexJustifyContent.FLEX_START)
                        }
                        Placement.CENTER -> {
                            alignItems(FlexAlign.CENTER)
                            justifyContent(FlexJustifyContent.CENTER)
                        }
                        Placement.LEFT -> {
                            justifyContent(FlexJustifyContent.CENTER)
                            alignItems(FlexAlign.FLEX_START)
                        }
                        Placement.RIGHT -> {
                            justifyContent(FlexJustifyContent.CENTER)
                            alignItems(FlexAlign.FLEX_END)
                        }
                    }
                }

                event { click { onClose() } }

                View {
                    attr {
                        when (placement) {
                            Placement.BOTTOM, Placement.TOP -> {
                                flex(1f)
                            }
                            Placement.LEFT, Placement.RIGHT -> {
                                height(1f)
                                width(280f)
                            }
                            Placement.CENTER -> {
                                width(300f)
                                borderRadius(SaUIRadius.Large)
                            }
                        }
                        backgroundColor(Color.parseString16ToLong(SaUIColors.BgContainer))
                        padding(SaUISpacing.lg, SaUISpacing.lg, SaUISpacing.lg, SaUISpacing.lg)
                        if (placement == Placement.TOP || placement == Placement.BOTTOM) {
                            borderRadius(
                                topLeft = if (placement == Placement.TOP) 0f else SaUIRadius.Large,
                                topRight = if (placement == Placement.TOP) 0f else SaUIRadius.Large,
                                bottomLeft = if (placement == Placement.BOTTOM) 0f else SaUIRadius.Large,
                                bottomRight = if (placement == Placement.BOTTOM) 0f else SaUIRadius.Large
                            )
                        }
                    }

                    event { click { /* stop propagation */ } }

                    if (title != null) {
                        Row {
                            attr {
                                justifyContent(FlexJustifyContent.SPACE_BETWEEN)
                                alignItems(FlexAlign.CENTER)
                                marginBottom(SaUISpacing.md)
                            }
                            Text {
                                attr {
                                    text(title)
                                    fontSize(18f)
                                    color(Color.parseString16ToLong(SaUIColors.TextPrimarySolid))
                                }
                            }
                            Text {
                                attr {
                                    text("\u2715")
                                    fontSize(20f)
                                    color(Color.parseString16ToLong(SaUIColors.TextSecondarySolid))
                                }
                                event { click { onClose() } }
                            }
                        }
                    }

                    content()
                }
            }
        }
    }
}
