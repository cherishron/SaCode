package com.sa.demo.saui.navigation

import com.sa.demo.saui.token.SaUIColors
import com.sa.demo.saui.token.SaUISpacing
import com.tencent.kuikly.core.base.Color
import com.tencent.kuikly.core.base.ViewBuilder
import com.tencent.kuikly.core.layout.FlexAlign
import com.tencent.kuikly.core.layout.FlexJustifyContent
import com.tencent.kuikly.core.views.Text
import com.tencent.kuikly.core.views.View
import com.tencent.kuikly.core.views.layout.Row

object SaTabBar {

    data class TabItem(
        val key: String,
        val label: String,
        val icon: String
    )

    fun build(
        items: List<TabItem>,
        selectedKey: String,
        onSelect: (String) -> Unit = {}
    ): ViewBuilder = {
        View {
            attr {
                height(56f)
                backgroundColor(Color.parseString16ToLong(SaUIColors.BgContainer))
                borderTop(com.tencent.kuikly.core.base.Border(
                    1f,
                    com.tencent.kuikly.core.base.BorderStyle.SOLID,
                    Color(Color.parseString16ToLong(SaUIColors.BorderLevel1))
                ))
            }
            Row {
                attr {
                    alignItems(FlexAlign.CENTER)
                    justifyContent(FlexJustifyContent.SPACE_AROUND)
                    flex(1f)
                }

                items.forEach { item ->
                    val isSelected = item.key == selectedKey

                    View {
                        attr {
                            alignItems(FlexAlign.CENTER)
                            justifyContent(FlexJustifyContent.CENTER)
                            flex(1f)
                            padding(SaUISpacing.xs, 0f, SaUISpacing.xs, 0f)
                        }

                        Text {
                            attr {
                                text(item.icon)
                                fontSize(22f)
                                color(Color.parseString16ToLong(
                                    if (isSelected) SaUIColors.BrandPrimary
                                    else SaUIColors.TextSecondarySolid
                                ))
                                marginBottom(2f)
                            }
                        }

                        Text {
                            attr {
                                text(item.label)
                                fontSize(10f)
                                color(Color.parseString16ToLong(
                                    if (isSelected) SaUIColors.BrandPrimary
                                    else SaUIColors.TextSecondarySolid
                                ))
                            }
                        }

                        event { click { onSelect(item.key) } }
                    }
                }
            }
        }
    }
}
