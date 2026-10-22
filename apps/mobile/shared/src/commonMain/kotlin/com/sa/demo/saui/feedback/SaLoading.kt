package com.sa.demo.saui.feedback

import com.sa.demo.saui.token.SaUIColors
import com.sa.demo.saui.token.SaUIRadius
import com.sa.demo.saui.token.SaUISpacing
import com.tencent.kuikly.core.base.Color
import com.tencent.kuikly.core.base.ViewBuilder
import com.tencent.kuikly.core.layout.FlexAlign
import com.tencent.kuikly.core.layout.FlexJustifyContent
import com.tencent.kuikly.core.views.ActivityIndicator
import com.tencent.kuikly.core.views.Text
import com.tencent.kuikly.core.views.View
import com.tencent.kuikly.core.views.layout.Column

object SaLoading {

    enum class Variant { CIRCLE, DOTS }

    fun build(
        message: String = "加载中...",
        variant: Variant = Variant.CIRCLE,
        overlay: Boolean = false
    ): ViewBuilder = {
        Column {
            attr {
                if (overlay) {
                    flex(1f)
                    backgroundColor(Color.parseString16ToLong(SaUIColors.Overlay))
                    opacity(0.5f)
                }
                alignItems(FlexAlign.CENTER)
                justifyContent(FlexJustifyContent.CENTER)
            }

            when (variant) {
                Variant.CIRCLE -> {
                    ActivityIndicator {
                        attr {
                            size(36f, 36f)
                        }
                    }
                }
                Variant.DOTS -> {
                    View {
                        attr {
                            size(48f, 8f)
                            borderRadius(SaUIRadius.Small)
                            backgroundColor(Color.parseString16ToLong(SaUIColors.BrandPrimary))
                            opacity(0.3f)
                        }
                    }
                }
            }

            if (message.isNotEmpty()) {
                Text {
                    attr {
                        text(message)
                        fontSize(14f)
                        color(Color.parseString16ToLong(SaUIColors.TextSecondarySolid))
                        marginTop(SaUISpacing.md)
                    }
                }
            }
        }
    }

    fun buildInline(): ViewBuilder = {
        View {
            attr {
                padding(all = SaUISpacing.md)
                alignItems(FlexAlign.CENTER)
                justifyContent(FlexJustifyContent.CENTER)
            }
            Text {
                attr {
                    text("加载中...")
                    fontSize(13f)
                    color(Color.parseString16ToLong(SaUIColors.TextSecondarySolid))
                }
            }
        }
    }
}
