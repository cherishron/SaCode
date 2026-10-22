package com.sa.demo.saui.form

import com.sa.demo.saui.token.SaUIColors
import com.sa.demo.saui.token.SaUIRadius
import com.sa.demo.saui.token.SaUISpacing
import com.tencent.kuikly.core.base.Color
import com.tencent.kuikly.core.base.ViewBuilder
import com.tencent.kuikly.core.layout.FlexAlign
import com.tencent.kuikly.core.views.Input
import com.tencent.kuikly.core.views.Text
import com.tencent.kuikly.core.views.layout.Row

object SaSearchBar {

    enum class Shape { ROUNDED, CAPSULE }

    fun build(
        placeholder: String = "搜索",
        value: String = "",
        shape: Shape = Shape.CAPSULE,
        showCancel: Boolean = false,
        onTextChange: (String) -> Unit = {},
        onSearch: (String) -> Unit = {},
        onCancel: () -> Unit = {},
        onClear: () -> Unit = {}
    ): ViewBuilder = {
        Row {
            attr {
                height(36f)
                backgroundColor(Color.parseString16ToLong(SaUIColors.BgComponent))
                borderRadius(if (shape == Shape.CAPSULE) SaUIRadius.Round else SaUIRadius.Medium)
                padding(left = SaUISpacing.md, right = SaUISpacing.md)
                alignItems(FlexAlign.CENTER)
                flex(1f)
            }

            Text {
                attr {
                    text("\u2315")
                    fontSize(16f)
                    color(Color.parseString16ToLong(SaUIColors.TextPlaceholderSolid))
                    marginRight(SaUISpacing.sm)
                }
            }

            Input {
                attr {
                    placeholder(placeholder)
                    text(value)
                    fontSize(14f)
                    color(Color(Color.parseString16ToLong(SaUIColors.TextPrimarySolid)))
                    placeholderColor(Color(Color.parseString16ToLong(SaUIColors.TextPlaceholderSolid)))
                    flex(1f)
                }
                event {
                    textDidChange { params ->
                        onTextChange(params.text)
                    }
                    inputReturn { params ->
                        onSearch(params.text)
                    }
                }
            }

            if (value.isNotEmpty()) {
                Text {
                    attr {
                        text("\u2715")
                        fontSize(14f)
                        color(Color.parseString16ToLong(SaUIColors.TextPlaceholderSolid))
                        marginLeft(SaUISpacing.sm)
                    }
                    event {
                        click { onClear() }
                    }
                }
            }
        }

        if (showCancel) {
            Text {
                attr {
                    text("取消")
                    fontSize(14f)
                    color(Color.parseString16ToLong(SaUIColors.BrandPrimary))
                    marginLeft(SaUISpacing.md)
                }
                event {
                    click { onCancel() }
                }
            }
        }
    }
}
