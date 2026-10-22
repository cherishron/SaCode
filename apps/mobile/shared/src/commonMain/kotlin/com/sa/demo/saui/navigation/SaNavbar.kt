package com.sa.demo.saui.navigation

import com.sa.demo.saui.foundation.SaIcons
import com.sa.demo.saui.token.SaUIColors
import com.sa.demo.saui.token.SaUISpacing
import com.tencent.kuikly.core.base.Color
import com.tencent.kuikly.core.base.ViewBuilder
import com.tencent.kuikly.core.layout.FlexAlign
import com.tencent.kuikly.core.layout.FlexJustifyContent
import com.tencent.kuikly.core.views.Text
import com.tencent.kuikly.core.views.View
import com.tencent.kuikly.core.views.layout.Row

object SaNavbar {

    fun build(
        title: String,
        leftIcon: String = SaIcons.ARROW_LEFT,
        onLeftClick: (() -> Unit)? = null,
        rightText: String? = null,
        onRightClick: (() -> Unit)? = null
    ): ViewBuilder = {
        View {
            attr {
                height(44f)
                backgroundColor(Color.parseString16ToLong(SaUIColors.BgContainer))
                padding(0f, SaUISpacing.md, 0f, SaUISpacing.md)
            }
            Row {
                attr {
                    alignItems(FlexAlign.CENTER)
                    justifyContent(FlexJustifyContent.SPACE_BETWEEN)
                    flex(1f)
                }

                View {
                    attr {
                        size(44f, 44f)
                        alignItems(FlexAlign.CENTER)
                        justifyContent(FlexJustifyContent.CENTER)
                    }
                    Text {
                        attr {
                            text(leftIcon)
                            fontSize(20f)
                            color(Color.parseString16ToLong(SaUIColors.TextPrimarySolid))
                        }
                    }
                    event { click { onLeftClick?.invoke() } }
                }

                Text {
                    attr {
                        text(title)
                        fontSize(18f)
                        color(Color.parseString16ToLong(SaUIColors.TextPrimarySolid))
                        fontFamily("PingFang SC")
                    }
                }

                View {
                    attr {
                        size(44f, 44f)
                        alignItems(FlexAlign.CENTER)
                        justifyContent(FlexJustifyContent.CENTER)
                    }
                    if (rightText != null) {
                        Text {
                            attr {
                                text(rightText)
                                fontSize(16f)
                                color(Color.parseString16ToLong(SaUIColors.BrandPrimary))
                            }
                        }
                        event { click { onRightClick?.invoke() } }
                    }
                }
            }
        }
    }
}
