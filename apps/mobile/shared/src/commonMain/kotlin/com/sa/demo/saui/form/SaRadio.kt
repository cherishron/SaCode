package com.sa.demo.saui.form

import com.sa.demo.saui.token.SaUIColors
import com.sa.demo.saui.token.SaUISpacing
import com.tencent.kuikly.core.base.Color
import com.tencent.kuikly.core.base.ViewBuilder
import com.tencent.kuikly.core.layout.FlexAlign
import com.tencent.kuikly.core.views.CheckBox
import com.tencent.kuikly.core.views.Text
import com.tencent.kuikly.core.views.View
import com.tencent.kuikly.core.views.layout.Column
import com.tencent.kuikly.core.views.layout.Row

object SaRadio {

    enum class Size(val dotSize: Float, val fontSize: Float) {
        SMALL(16f, 14f),
        MEDIUM(20f, 16f),
        LARGE(24f, 18f)
    }

    fun build(
        label: String,
        selected: Boolean = false,
        size: Size = Size.MEDIUM,
        disabled: Boolean = false,
        onClick: () -> Unit = {}
    ): ViewBuilder = {
        Row {
            attr { alignItems(FlexAlign.CENTER) }

            View {
                attr {
                    size(size.dotSize, size.dotSize)
                    borderRadius(size.dotSize / 2)
                    border(com.tencent.kuikly.core.base.Border(
                        2f,
                        com.tencent.kuikly.core.base.BorderStyle.SOLID,
                        Color(Color.parseString16ToLong(
                            if (disabled && !selected) SaUIColors.TextDisabledSolid
                            else if (selected) SaUIColors.BrandPrimary
                            else SaUIColors.BorderLevel1
                        ))
                    ))
                    marginRight(SaUISpacing.sm)
                }

                if (selected) {
                    View {
                        attr {
                            val inner = size.dotSize * 0.5f
                            val margin = (size.dotSize - inner) / 2
                            size(inner, inner)
                            borderRadius(inner / 2)
                            backgroundColor(Color.parseString16ToLong(SaUIColors.BrandPrimary))
                            absolutePosition(top = margin, left = margin)
                        }
                    }
                }
            }

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

            event {
                click { if (!disabled) onClick() }
            }
        }
    }
}

object SaRadioGroup {

    data class RadioOption(val label: String, val value: String)

    fun build(
        options: List<RadioOption>,
        selectedValue: String,
        direction: String = "vertical",
        disabled: Boolean = false,
        onSelect: (String) -> Unit = {}
    ): ViewBuilder = {
        val container: ViewBuilder = {
            options.forEach { option ->
                SaRadio.build(
                    label = option.label,
                    selected = option.value == selectedValue,
                    disabled = disabled,
                    onClick = { onSelect(option.value) }
                ).invoke(this)
                if (option != options.last()) {
                    View {
                        attr {
                            if (direction == "vertical") {
                                height(SaUISpacing.sm)
                            } else {
                                width(SaUISpacing.sm)
                            }
                        }
                    }
                }
            }
        }

        if (direction == "vertical") {
            Column { container() }
        } else {
            Row { attr { alignItems(FlexAlign.CENTER) }; container() }
        }
    }
}
