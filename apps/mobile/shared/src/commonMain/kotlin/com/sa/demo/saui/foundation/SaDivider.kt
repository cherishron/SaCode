package com.sa.demo.saui.foundation

import com.sa.demo.saui.token.SaUIColors
import com.sa.demo.saui.token.SaUISpacing
import com.tencent.kuikly.core.base.Color
import com.tencent.kuikly.core.base.ViewBuilder
import com.tencent.kuikly.core.layout.FlexAlign
import com.tencent.kuikly.core.views.Text
import com.tencent.kuikly.core.views.View
import com.tencent.kuikly.core.views.layout.Row

object SaDivider {

    enum class Direction { HORIZONTAL, VERTICAL }

    fun build(
        text: String? = null,
        direction: Direction = Direction.HORIZONTAL,
        inset: Float = 0f
    ): ViewBuilder = {
        if (text != null) {
            Row {
                attr {
                    alignItems(FlexAlign.CENTER)
                    padding(left = inset, right = inset)
                }
                buildLine(direction, 1f, true).invoke(this)
                Text {
                    attr {
                        text(text)
                        fontSize(12f)
                        color(Color.parseString16ToLong(SaUIColors.TextSecondarySolid))
                        margin(left = SaUISpacing.md, right = SaUISpacing.md)
                    }
                }
                buildLine(direction, 1f, true).invoke(this)
            }
        } else {
            buildLine(direction, inset, false).invoke(this)
        }
    }

    private fun buildLine(
        direction: Direction,
        inset: Float,
        flex: Boolean
    ): ViewBuilder = {
        View {
            attr {
                backgroundColor(Color.parseString16ToLong(SaUIColors.BorderLevel1))
                if (direction == Direction.HORIZONTAL) {
                    height(0.5f)
                    if (flex) flex(1f)
                    if (inset > 0f) margin(left = inset, right = inset)
                } else {
                    width(0.5f)
                    if (flex) flex(1f)
                    if (inset > 0f) margin(top = inset, bottom = inset)
                }
            }
        }
    }
}
