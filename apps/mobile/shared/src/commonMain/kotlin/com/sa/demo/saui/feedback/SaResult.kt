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

object SaResult {

    enum class Variant(val icon: String, val color: String) {
        SUCCESS("\u2713", SaUIColors.Success),
        ERROR("\u2717", SaUIColors.Error),
        WARNING("!", SaUIColors.Warning),
        INFO("i", SaUIColors.BrandPrimary),
        EMPTY("\u2205", SaUIColors.TextSecondarySolid)
    }

    fun build(
        variant: Variant = Variant.INFO,
        title: String,
        description: String = "",
        actionText: String? = null,
        onAction: () -> Unit = {}
    ): ViewBuilder = {
        Column {
            attr {
                alignItems(FlexAlign.CENTER)
                justifyContent(FlexJustifyContent.CENTER)
                padding(SaUISpacing.xxl, SaUISpacing.xl, SaUISpacing.xxl, SaUISpacing.xl)
            }

            View {
                attr {
                    size(64f, 64f)
                    borderRadius(32f)
                    backgroundColor(Color.parseString16ToLong(variant.color).let { c ->
                        (c and 0x00FFFFFF) or 0x1A000000
                    })
                    alignItems(FlexAlign.CENTER)
                    justifyContent(FlexJustifyContent.CENTER)
                    marginBottom(SaUISpacing.lg)
                }
                Text {
                    attr {
                        text(variant.icon)
                        fontSize(32f)
                        color(Color.parseString16ToLong(variant.color))
                    }
                }
            }

            Text {
                attr {
                    text(title)
                    fontSize(18f)
                    color(Color.parseString16ToLong(SaUIColors.TextPrimarySolid))
                    marginBottom(SaUISpacing.xs)
                }
            }

            if (description.isNotEmpty()) {
                Text {
                    attr {
                        text(description)
                        fontSize(14f)
                        color(Color.parseString16ToLong(SaUIColors.TextSecondarySolid))
                        marginBottom(SaUISpacing.lg)
                    }
                }
            }

            if (actionText != null) {
                SaButton.build(
                    text = actionText,
                    variant = SaButton.Variant.PRIMARY
                ) { onAction() }.invoke(this)
            }
        }
    }
}
