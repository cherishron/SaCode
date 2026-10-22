package com.sa.demo.saui.form

import com.sa.demo.saui.token.SaUIColors
import com.sa.demo.saui.token.SaUIRadius
import com.sa.demo.saui.token.SaUISpacing
import com.tencent.kuikly.core.base.Border
import com.tencent.kuikly.core.base.BorderStyle
import com.tencent.kuikly.core.base.Color
import com.tencent.kuikly.core.base.ViewBuilder
import com.tencent.kuikly.core.layout.FlexAlign
import com.tencent.kuikly.core.views.Input
import com.tencent.kuikly.core.views.Text
import com.tencent.kuikly.core.views.View
import com.tencent.kuikly.core.views.layout.Column
import com.tencent.kuikly.core.views.layout.Row

object SaInput {

    enum class InputState { NORMAL, FOCUS, ERROR, DISABLED }

    enum class KeyboardType { DEFAULT, PASSWORD, NUMBER, EMAIL }

    fun build(
        placeholder: String = "请输入",
        value: String = "",
        label: String? = null,
        required: Boolean = false,
        maxLength: Int = 140,
        state: InputState = InputState.NORMAL,
        keyboardType: KeyboardType = KeyboardType.DEFAULT,
        errorMessage: String? = null,
        prefixIcon: String? = null,
        suffixIcon: String? = null,
        onTextChange: (String) -> Unit = {},
        onFocus: () -> Unit = {},
        onBlur: () -> Unit = {}
    ): ViewBuilder = {
        Column {
            attr { flex(1f) }

            if (label != null) {
                Row {
                    attr {
                        marginBottom(SaUISpacing.sm)
                        alignItems(FlexAlign.CENTER)
                    }
                    if (required) {
                        Text {
                            attr {
                                text("*")
                                color(Color.parseString16ToLong(SaUIColors.Error))
                                fontSize(14f)
                                marginRight(SaUISpacing.xxs)
                            }
                        }
                    }
                    Text {
                        attr {
                            text(label)
                            fontSize(14f)
                            color(Color.parseString16ToLong(SaUIColors.TextPrimarySolid))
                            fontWeightMedium()
                        }
                    }
                }
            }

            Row {
                attr {
                    height(44f)
                    backgroundColor(Color.parseString16ToLong(
                        if (state == InputState.DISABLED) SaUIColors.BgComponent
                        else SaUIColors.BgContainer
                    ))
                    borderRadius(SaUIRadius.Small)
                    padding(left = SaUISpacing.md, right = SaUISpacing.md)
                    alignItems(FlexAlign.CENTER)

                    val borderColor = when (state) {
                        InputState.NORMAL -> SaUIColors.BorderLevel1
                        InputState.FOCUS -> SaUIColors.BrandPrimary
                        InputState.ERROR -> SaUIColors.Error
                        InputState.DISABLED -> SaUIColors.BorderLevel1
                    }
                    border(Border(1f, BorderStyle.SOLID, Color(Color.parseString16ToLong(borderColor))))
                }

                if (prefixIcon != null) {
                    Text {
                        attr {
                            text(prefixIcon)
                            fontSize(16f)
                            marginRight(SaUISpacing.sm)
                            color(Color.parseString16ToLong(SaUIColors.TextPlaceholderSolid))
                        }
                    }
                }

                Input {
                    attr {
                        flex(1f)
                        height(44f)
                        placeholder(placeholder)
                        placeholderColor(Color(Color.parseString16ToLong(SaUIColors.TextPlaceholderSolid)))
                        fontSize(16f)
                        color(Color(Color.parseString16ToLong(SaUIColors.TextPrimarySolid)))
                        maxTextLength(maxLength)

                        when (keyboardType) {
                            KeyboardType.PASSWORD -> keyboardTypePassword()
                            KeyboardType.NUMBER -> keyboardTypeNumber()
                            KeyboardType.EMAIL -> keyboardTypeEmail()
                            KeyboardType.DEFAULT -> {}
                        }

                        if (state == InputState.DISABLED) {
                            editable(false)
                        }
                    }
                    event {
                        textDidChange { params ->
                            onTextChange(params.text)
                        }
                        inputFocus { onFocus() }
                        inputBlur { onBlur() }
                    }
                }

                if (suffixIcon != null) {
                    Text {
                        attr {
                            text(suffixIcon)
                            fontSize(16f)
                            marginLeft(SaUISpacing.sm)
                            color(Color.parseString16ToLong(SaUIColors.TextPlaceholderSolid))
                        }
                    }
                }
            }

            if (state == InputState.ERROR && errorMessage != null) {
                Text {
                    attr {
                        text(errorMessage)
                        fontSize(12f)
                        color(Color.parseString16ToLong(SaUIColors.Error))
                        marginTop(SaUISpacing.xs)
                    }
                }
            }
        }
    }
}
