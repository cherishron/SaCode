package com.sa.demo.saui.feedback

import com.sa.demo.saui.token.SaUIColors
import com.tencent.kuikly.core.base.Color
import com.tencent.kuikly.core.base.ViewBuilder
import com.tencent.kuikly.core.layout.FlexAlign
import com.tencent.kuikly.core.views.Text
import com.tencent.kuikly.core.views.layout.Row

object SaRate {

    fun build(
        value: Int = 0,
        max: Int = 5,
        size: Float = 24f,
        disabled: Boolean = false,
        onChange: (Int) -> Unit = {}
    ): ViewBuilder = {
        val filledColor = SaUIColors.Warning
        val emptyColor = SaUIColors.BgComponent
        val starChar = "\u2605"
        val emptyStarChar = "\u2606"

        Row {
            attr { alignItems(FlexAlign.CENTER) }
            for (i in 1..max) {
                Text {
                    attr {
                        text(if (i <= value) starChar else emptyStarChar)
                        fontSize(size)
                        color(Color.parseString16ToLong(
                            if (i <= value) filledColor else emptyColor
                        ))
                    }
                    if (!disabled) {
                        event {
                            click { onChange(i) }
                        }
                    }
                }
            }
        }
    }
}
