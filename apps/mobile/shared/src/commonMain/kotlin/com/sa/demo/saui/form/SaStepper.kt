package com.sa.demo.saui.form

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

object SaStepper {

    fun build(
        value: Int = 0,
        min: Int = 0,
        max: Int = 99,
        step: Int = 1,
        disabled: Boolean = false,
        onChange: (Int) -> Unit = {}
    ): ViewBuilder = {
        val borderColor = if (disabled) SaUIColors.TextDisabledSolid else SaUIColors.BorderLevel1

        Row {
            attr { alignItems(FlexAlign.CENTER) }

            View {
                attr {
                    size(32f, 32f)
                    borderRadius(SaUIRadius.Small)
                    border(com.tencent.kuikly.core.base.Border(
                        1f,
                        com.tencent.kuikly.core.base.BorderStyle.SOLID,
                        Color(Color.parseString16ToLong(borderColor))
                    ))
                    alignItems(FlexAlign.CENTER)
                    justifyContent(FlexJustifyContent.CENTER)
                }
                Text {
                    attr {
                        text("\u2212")
                        fontSize(18f)
                        color(Color.parseString16ToLong(
                            if (disabled || value <= min) SaUIColors.TextDisabledSolid
                            else SaUIColors.TextPrimarySolid
                        ))
                    }
                }
                event {
                    click {
                        if (!disabled && value > min) {
                            onChange((value - step).coerceAtLeast(min))
                        }
                    }
                }
            }

            View {
                attr {
                    minWidth(48f)
                    height(32f)
                    alignItems(FlexAlign.CENTER)
                    justifyContent(FlexJustifyContent.CENTER)
                    borderTop(com.tencent.kuikly.core.base.Border(
                        1f,
                        com.tencent.kuikly.core.base.BorderStyle.SOLID,
                        Color(Color.parseString16ToLong(borderColor))
                    ))
                    borderBottom(com.tencent.kuikly.core.base.Border(
                        1f,
                        com.tencent.kuikly.core.base.BorderStyle.SOLID,
                        Color(Color.parseString16ToLong(borderColor))
                    ))
                }
                Text {
                    attr {
                        text(value.toString())
                        fontSize(16f)
                        color(Color.parseString16ToLong(
                            if (disabled) SaUIColors.TextDisabledSolid
                            else SaUIColors.TextPrimarySolid
                        ))
                    }
                }
            }

            View {
                attr {
                    size(32f, 32f)
                    borderRadius(SaUIRadius.Small)
                    border(com.tencent.kuikly.core.base.Border(
                        1f,
                        com.tencent.kuikly.core.base.BorderStyle.SOLID,
                        Color(Color.parseString16ToLong(borderColor))
                    ))
                    alignItems(FlexAlign.CENTER)
                    justifyContent(FlexJustifyContent.CENTER)
                }
                Text {
                    attr {
                        text("+")
                        fontSize(18f)
                        color(Color.parseString16ToLong(
                            if (disabled || value >= max) SaUIColors.TextDisabledSolid
                            else SaUIColors.TextPrimarySolid
                        ))
                    }
                }
                event {
                    click {
                        if (!disabled && value < max) {
                            onChange((value + step).coerceAtMost(max))
                        }
                    }
                }
            }
        }
    }
}
