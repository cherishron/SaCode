package com.sa.demo.saui.feedback

import com.sa.demo.saui.token.SaUIColors
import com.sa.demo.saui.token.SaUIRadius
import com.sa.demo.saui.token.SaUISpacing
import com.tencent.kuikly.core.base.Color
import com.tencent.kuikly.core.base.ViewBuilder
import com.tencent.kuikly.core.layout.FlexAlign
import com.tencent.kuikly.core.layout.FlexDirection
import com.tencent.kuikly.core.layout.FlexJustifyContent
import com.tencent.kuikly.core.views.Text
import com.tencent.kuikly.core.views.View
import com.tencent.kuikly.core.views.layout.Column

object SaDrawer {

    enum class Placement { LEFT, RIGHT }

    fun build(
        visible: Boolean,
        placement: Placement = Placement.RIGHT,
        header: String? = null,
        onClose: () -> Unit = {},
        content: ViewBuilder
    ): ViewBuilder = {
        if (visible) {
            View {
                attr {
                    absolutePosition(0f, 0f, 0f, 0f)
                    backgroundColor(0x80000000L)
                    if (placement == Placement.RIGHT) {
                        alignItems(FlexAlign.FLEX_END)
                    } else {
                        alignItems(FlexAlign.FLEX_START)
                    }
                }

                event { click { onClose() } }

                View {
                    attr {
                        width(300f)
                        flex(1f)
                        backgroundColor(Color.parseString16ToLong(SaUIColors.BgContainer))
                        padding(SaUISpacing.xl, SaUISpacing.lg, SaUISpacing.xl, SaUISpacing.lg)
                    }

                    event { click { /* stop propagation */ } }

                    if (header != null) {
                        View {
                            attr {
                                height(48f)
                                alignItems(FlexAlign.CENTER)
                                justifyContent(FlexJustifyContent.SPACE_BETWEEN)
                                flexDirection(FlexDirection.ROW)
                                marginBottom(SaUISpacing.lg)
                                borderBottom(com.tencent.kuikly.core.base.Border(
                                    1f,
                                    com.tencent.kuikly.core.base.BorderStyle.SOLID,
                                    Color(Color.parseString16ToLong(SaUIColors.BorderLevel1))
                                ))
                            }
                            Text {
                                attr {
                                    text(header)
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
