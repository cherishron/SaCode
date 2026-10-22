package com.sa.demo.saui.navigation

import com.sa.demo.saui.token.SaUIColors
import com.sa.demo.saui.token.SaUISpacing
import com.tencent.kuikly.core.base.Color
import com.tencent.kuikly.core.base.ViewBuilder
import com.tencent.kuikly.core.layout.FlexAlign
import com.tencent.kuikly.core.layout.FlexJustifyContent
import com.tencent.kuikly.core.views.Text
import com.tencent.kuikly.core.views.View
import com.tencent.kuikly.core.views.layout.Column
import com.tencent.kuikly.core.views.layout.Row

object SaSteps {

    data class Step(val label: String, val description: String = "")

    enum class Direction { HORIZONTAL, VERTICAL }

    fun build(
        steps: List<Step>,
        current: Int = 0,
        direction: Direction = Direction.HORIZONTAL
    ): ViewBuilder = {
        val container: ViewBuilder = {
            steps.forEachIndexed { index, step ->
                val isCompleted = index < current
                val isCurrent = index == current
                val isLast = index == steps.lastIndex

                val stepColor = when {
                    isCompleted || isCurrent -> SaUIColors.BrandPrimary
                    else -> SaUIColors.TextDisabledSolid
                }

                if (direction == Direction.HORIZONTAL) {
                    Row {
                        attr { alignItems(FlexAlign.CENTER) }
                        buildStepContent(
                            index, step, isCompleted, isCurrent, stepColor, isLast, Direction.HORIZONTAL
                        ).invoke(this)
                    }
                } else {
                    buildStepContent(
                        index, step, isCompleted, isCurrent, stepColor, isLast, Direction.VERTICAL
                    ).invoke(this)
                }
            }
        }

        if (direction == Direction.HORIZONTAL) {
            Row {
                attr {
                    alignItems(FlexAlign.CENTER)
                    flexWrap(com.tencent.kuikly.core.layout.FlexWrap.WRAP)
                }
                container()
            }
        } else {
            Column { container() }
        }
    }

    private fun buildStepContent(
        index: Int, step: Step, isCompleted: Boolean, isCurrent: Boolean,
        stepColor: String, isLast: Boolean, direction: Direction
    ): ViewBuilder = {
        if (direction == Direction.VERTICAL) {
            Row {
                attr { alignItems(FlexAlign.CENTER) }

                Column {
                    attr { alignItems(FlexAlign.CENTER); marginRight(SaUISpacing.sm) }

                    View {
                        attr {
                            size(28f, 28f)
                            borderRadius(14f)
                            backgroundColor(Color.parseString16ToLong(stepColor))
                            alignItems(FlexAlign.CENTER)
                            justifyContent(FlexJustifyContent.CENTER)
                        }
                        Text {
                            attr {
                                text(if (isCompleted) "\u2713" else "${index + 1}")
                                fontSize(12f)
                                color(Color.WHITE)
                            }
                        }
                    }

                    if (!isLast) {
                        View {
                            attr {
                                width(2f)
                                height(32f)
                                backgroundColor(Color.parseString16ToLong(
                                    if (isCompleted) SaUIColors.BrandPrimary
                                    else SaUIColors.BgComponent
                                ))
                                marginTop(4f)
                                marginBottom(4f)
                            }
                        }
                    }
                }

                Column {
                    attr { marginLeft(SaUISpacing.sm) }
                    Text {
                        attr {
                            text(step.label)
                            fontSize(16f)
                            color(Color.parseString16ToLong(
                                if (isCurrent || isCompleted) SaUIColors.TextPrimarySolid
                                else SaUIColors.TextSecondarySolid
                            ))
                        }
                    }
                    if (step.description.isNotEmpty()) {
                        Text {
                            attr {
                                text(step.description)
                                fontSize(12f)
                                color(Color.parseString16ToLong(SaUIColors.TextSecondarySolid))
                                marginTop(2f)
                            }
                        }
                    }
                }
            }
        } else {
            Column {
                attr { alignItems(FlexAlign.CENTER); flex(1f) }
                View {
                    attr {
                        size(28f, 28f)
                        borderRadius(14f)
                        backgroundColor(Color.parseString16ToLong(stepColor))
                        alignItems(FlexAlign.CENTER)
                        justifyContent(FlexJustifyContent.CENTER)
                    }
                    Text {
                        attr {
                            text(if (isCompleted) "\u2713" else "${index + 1}")
                            fontSize(12f)
                            color(Color.WHITE)
                        }
                    }
                }
                Text {
                    attr {
                        text(step.label)
                        fontSize(12f)
                        color(Color.parseString16ToLong(
                            if (isCurrent || isCompleted) SaUIColors.TextPrimarySolid
                            else SaUIColors.TextSecondarySolid
                        ))
                        marginTop(4f)
                    }
                }
            }

            if (!isLast) {
                View {
                    attr {
                        height(2f)
                        width(32f)
                        backgroundColor(Color.parseString16ToLong(
                            if (isCompleted) SaUIColors.BrandPrimary
                            else SaUIColors.BgComponent
                        ))
                        alignSelf(FlexAlign.FLEX_START)
                        marginTop(14f)
                    }
                }
            }
        }
    }
}
