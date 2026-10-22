package com.sa.demo.saui.form

import com.sa.demo.saui.token.SaUIColors
import com.sa.demo.saui.token.SaUISpacing
import com.tencent.kuikly.core.base.Color
import com.tencent.kuikly.core.base.ViewBuilder
import com.tencent.kuikly.core.layout.FlexAlign
import com.tencent.kuikly.core.views.CheckBox
import com.tencent.kuikly.core.views.Text
import com.tencent.kuikly.core.views.layout.Row

object SaCheckBox {

    enum class CheckBoxSize(val boxSize: Float, val fontSize: Float) {
        SMALL(18f, 14f),
        MEDIUM(22f, 16f),
        LARGE(26f, 18f)
    }

    fun build(
        label: String = "",
        checked: Boolean = false,
        size: CheckBoxSize = CheckBoxSize.MEDIUM,
        disabled: Boolean = false,
        onCheckedChanged: (Boolean) -> Unit = {}
    ): ViewBuilder = {
        Row {
            attr {
                alignItems(FlexAlign.CENTER)
            }

            CheckBox {
                attr {
                    this.size(size.boxSize, size.boxSize)
                    this.checked(checked)
                    if (disabled) {
                        disable(true)
                    }
                    marginRight(SaUISpacing.sm)
                }
                event {
                    checkedDidChanged { isChecked ->
                        onCheckedChanged(isChecked)
                    }
                }
            }

            if (label.isNotEmpty()) {
                Text {
                    attr {
                        text(label)
                        fontSize(size.fontSize)
                        color(Color.parseString16ToLong(
                            if (disabled) SaUIColors.TextDisabledSolid
                            else SaUIColors.TextPrimarySolid
                        ))
                    }
                }
            }
        }
    }
}
