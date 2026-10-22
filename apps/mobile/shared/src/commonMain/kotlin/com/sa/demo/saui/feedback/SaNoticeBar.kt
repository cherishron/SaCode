package com.sa.demo.saui.feedback

import com.sa.demo.saui.foundation.SaIcons
import com.sa.demo.saui.token.SaUIColors
import com.sa.demo.saui.token.SaUISpacing
import com.tencent.kuikly.core.base.Color
import com.tencent.kuikly.core.base.ViewBuilder
import com.tencent.kuikly.core.layout.FlexAlign
import com.tencent.kuikly.core.views.Text
import com.tencent.kuikly.core.views.View
import com.tencent.kuikly.core.views.layout.Row

object SaNoticeBar {

    enum class Variant(val bgColor: String, val textColor: String) {
        INFO(SaUIColors.BrandFocus, SaUIColors.BrandPrimary),
        SUCCESS(SaUIColors.SuccessLight, SaUIColors.Success),
        WARNING(SaUIColors.WarningLight, SaUIColors.Warning),
        ERROR(SaUIColors.ErrorLight, SaUIColors.Error)
    }

    fun build(
        text: String,
        variant: Variant = Variant.INFO,
        prefixIcon: Boolean = true,
        closable: Boolean = false,
        onClose: (() -> Unit)? = null
    ): ViewBuilder = {
        View {
            attr {
                backgroundColor(Color.parseString16ToLong(variant.bgColor))
                padding(SaUISpacing.sm, SaUISpacing.md, SaUISpacing.sm, SaUISpacing.md)
            }
            Row {
                attr { alignItems(FlexAlign.CENTER) }

                if (prefixIcon) {
                    Text {
                        attr {
                            text(SaIcons.BELL)
                            fontSize(16f)
                            color(Color.parseString16ToLong(variant.textColor))
                            marginRight(SaUISpacing.sm)
                        }
                    }
                }

                Text {
                    attr {
                        text(text)
                        fontSize(14f)
                        color(Color.parseString16ToLong(variant.textColor))
                        flex(1f)
                    }
                }

                if (closable) {
                    Text {
                        attr {
                            text(SaIcons.CLOSE)
                            fontSize(16f)
                            color(Color.parseString16ToLong(variant.textColor))
                            marginLeft(SaUISpacing.sm)
                        }
                        event {
                            click { onClose?.invoke() }
                        }
                    }
                }
            }
        }
    }
}
