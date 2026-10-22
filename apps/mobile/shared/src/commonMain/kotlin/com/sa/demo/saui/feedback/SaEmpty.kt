package com.sa.demo.saui.feedback

import com.sa.demo.saui.base.SaButton
import com.sa.demo.saui.token.SaUIColors
import com.sa.demo.saui.token.SaUISpacing
import com.tencent.kuikly.core.base.Color
import com.tencent.kuikly.core.base.ViewBuilder
import com.tencent.kuikly.core.layout.FlexAlign
import com.tencent.kuikly.core.layout.FlexJustifyContent
import com.tencent.kuikly.core.views.Text
import com.tencent.kuikly.core.views.View
import com.tencent.kuikly.core.views.layout.Column
import com.tencent.kuikly.core.views.compose.Button

object SaEmpty {

    enum class IconType {
        SEARCH, NETWORK, GENERAL, FAVORITE, MESSAGE, FILE
    }

    fun build(
        message: String = "暂无数据",
        subMessage: String = "",
        iconType: IconType = IconType.GENERAL,
        actionText: String? = null,
        onAction: () -> Unit = {}
    ): ViewBuilder = {
        Column {
            attr {
                flex(1f)
                alignItems(FlexAlign.CENTER)
                justifyContent(FlexJustifyContent.CENTER)
                padding(top = SaUISpacing.huge, bottom = SaUISpacing.huge)
            }

            View {
                attr {
                    size(80f, 80f)
                    backgroundColor(Color.parseString16ToLong(SaUIColors.BgComponent))
                    borderRadius(40f)
                    marginBottom(SaUISpacing.xxl)
                    alignItems(FlexAlign.CENTER)
                    justifyContent(FlexJustifyContent.CENTER)
                }
                Text {
                    attr {
                        text(resolveIcon(iconType))
                        fontSize(32f)
                    }
                }
            }

            Text {
                attr {
                    text(message)
                    fontSize(16f)
                    color(Color.parseString16ToLong(SaUIColors.TextPrimarySolid))
                    fontWeightMedium()
                }
            }

            if (subMessage.isNotEmpty()) {
                Text {
                    attr {
                        text(subMessage)
                        fontSize(14f)
                        color(Color.parseString16ToLong(SaUIColors.TextSecondarySolid))
                        marginTop(SaUISpacing.sm)
                    }
                }
            }

            if (actionText != null) {
                View {
                    attr { marginTop(SaUISpacing.xxl) }
                    SaButton.build(
                        text = actionText,
                        variant = SaButton.Variant.PRIMARY_OUTLINE,
                        onClick = onAction
                    ).invoke(this)
                }
            }
        }
    }

    private fun resolveIcon(type: IconType): String = when (type) {
        IconType.SEARCH -> "\u2315"
        IconType.NETWORK -> "\u21BB"
        IconType.GENERAL -> "\u25A1"
        IconType.FAVORITE -> "\u2606"
        IconType.MESSAGE -> "\u2709"
        IconType.FILE -> "\u25A0"
    }
}
