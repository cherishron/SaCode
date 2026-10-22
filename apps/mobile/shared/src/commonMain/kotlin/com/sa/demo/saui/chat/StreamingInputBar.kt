package com.sa.demo.saui.chat

import com.sa.demo.saui.token.SaUIColors
import com.sa.demo.saui.token.SaUIRadius
import com.sa.demo.saui.token.SaUISpacing
import com.tencent.kuikly.core.base.Color
import com.tencent.kuikly.core.base.ViewBuilder
import com.tencent.kuikly.core.layout.FlexAlign
import com.tencent.kuikly.core.layout.FlexJustifyContent
import com.tencent.kuikly.core.views.Input
import com.tencent.kuikly.core.views.Text
import com.tencent.kuikly.core.views.View
import com.tencent.kuikly.core.views.layout.Column
import com.tencent.kuikly.core.views.layout.Row

/**
 * StreamingInputBar：流式对话输入栏。
 * 包含输入框、发送/停止按钮、模型选择。
 */
object StreamingInputBar {

    fun build(
        draft: String,
        busy: Boolean,
        useStream: Boolean,
        selectedModel: String,
        models: List<String>,
        onDraftChange: (String) -> Unit,
        onSend: () -> Unit,
        onStop: (() -> Unit)? = null,
        onModelSelect: ((String) -> Unit)? = null,
        onToggleStream: ((Boolean) -> Unit)? = null,
        /** 模型下拉是否展开。默认 false = 收起，保持旧调用方行为不变。 */
        modelPickerOpen: Boolean = false,
        /** 点击模型按钮时回调；为 null 时不渲染可点击的模型入口。 */
        onToggleModelPicker: (() -> Unit)? = null
    ): ViewBuilder = {
        Column {
            Row {
            attr {
                height(48f)
                backgroundColor(Color.parseString16ToLong(SaUIColors.BgContainer))
                borderRadius(SaUIRadius.Medium)
                padding(left = SaUISpacing.md, right = SaUISpacing.md)
                alignItems(FlexAlign.CENTER)
                margin(SaUISpacing.md, SaUISpacing.md, SaUISpacing.md, SaUISpacing.md)
            }

            // 输入框
            Input {
                attr {
                    flex(1f)
                    height(40f)
                    placeholder("输入消息...")
                    text(draft)
                    fontSize(15f)
                    color(Color(Color.parseString16ToLong(SaUIColors.TextPrimarySolid)))
                    placeholderColor(Color(Color.parseString16ToLong(SaUIColors.TextPlaceholderSolid)))
                }
                event {
                    textDidChange { params ->
                        onDraftChange(params.text)
                    }
                    inputReturn {
                        if (!busy && draft.isNotBlank()) {
                            onSend()
                        }
                    }
                }
            }

            // 流式开关（可选）
            if (onToggleStream != null) {
                View {
                    attr {
                        margin(left = SaUISpacing.sm)
                        padding(SaUISpacing.xs, SaUISpacing.sm, SaUISpacing.xs, SaUISpacing.sm)
                        borderRadius(SaUIRadius.Small)
                        backgroundColor(
                            Color.parseString16ToLong(
                                if (useStream) SaUIColors.BrandFocus else SaUIColors.BgComponent
                            )
                        )
                    }
                    Text {
                        attr {
                            text(if (useStream) "流式" else "普通")
                            fontSize(11f)
                            color(
                                Color.parseString16ToLong(
                                    if (useStream) SaUIColors.BrandPrimary else SaUIColors.TextSecondarySolid
                                )
                            )
                        }
                    }
                    event {
                        click { onToggleStream(!useStream) }
                    }
                }
            }

            // 模型选择（可选）：点击展开下拉，选中后回调 onModelSelect
            if (onModelSelect != null && models.isNotEmpty()) {
                View {
                    attr {
                        margin(left = SaUISpacing.sm)
                        padding(SaUISpacing.xs, SaUISpacing.sm, SaUISpacing.xs, SaUISpacing.sm)
                        borderRadius(SaUIRadius.Small)
                        backgroundColor(
                            Color.parseString16ToLong(
                                if (modelPickerOpen) SaUIColors.BrandFocus else SaUIColors.BgComponent
                            )
                        )
                    }
                    Text {
                        attr {
                            text(selectedModel.ifBlank { "模型" })
                            fontSize(11f)
                            color(
                                Color.parseString16ToLong(
                                    if (modelPickerOpen) SaUIColors.BrandPrimary
                                    else SaUIColors.TextSecondarySolid
                                )
                            )
                        }
                    }
                    event {
                        click {
                            if (onToggleModelPicker != null) {
                                onToggleModelPicker()
                            } else {
                                // 无外部状态时退化为轮询切换，保持组件可独立使用
                                val idx = models.indexOf(selectedModel)
                                onModelSelect(models[(idx + 1).mod(models.size)])
                            }
                        }
                    }
                }
            }

            // busy 只禁止发送；停止能力由调用方显式提供，不能由输出偏好推断。
            val canStop = busy && onStop != null
            val canSend = !busy && draft.isNotBlank()
            View {
                attr {
                    margin(left = SaUISpacing.sm)
                    size(if (busy && !canStop) 64f else 36f, 36f)
                    borderRadius(18f)
                    backgroundColor(
                        Color.parseString16ToLong(
                            when {
                                canStop -> SaUIColors.Error
                                canSend -> SaUIColors.BrandPrimary
                                else -> SaUIColors.BgComponent
                            }
                        )
                    )
                    alignItems(FlexAlign.CENTER)
                    justifyContent(FlexJustifyContent.CENTER)
                }
                Text {
                    attr {
                        text(if (canStop) "⏹" else if (busy) "处理中" else "↑")
                        fontSize(if (busy && !canStop) 12f else 16f)
                        color(if (canStop || canSend) Color.WHITE else Color(Color.parseString16ToLong(SaUIColors.TextSecondarySolid)))
                    }
                }
                if (canStop) {
                    event { click { onStop?.invoke() } }
                } else if (canSend) {
                    event { click { onSend() } }
                }
            }
            }

            // 模型下拉列表：仅在展开且有选择回调时渲染
            if (modelPickerOpen && onModelSelect != null && models.isNotEmpty()) {
                Column {
                    attr {
                        margin(
                            left = SaUISpacing.md,
                            right = SaUISpacing.md,
                            top = SaUISpacing.xs,
                            bottom = 0f
                        )
                        borderRadius(SaUIRadius.Medium)
                        backgroundColor(Color.parseString16ToLong(SaUIColors.BgContainer))
                    }

                    models.forEach { model ->
                        Row {
                            attr {
                                padding(SaUISpacing.sm, SaUISpacing.md, SaUISpacing.sm, SaUISpacing.md)
                                alignItems(FlexAlign.CENTER)
                                backgroundColor(
                                    Color.parseString16ToLong(
                                        if (model == selectedModel) SaUIColors.BrandFocus
                                        else SaUIColors.BgContainer
                                    )
                                )
                            }
                            Text {
                                attr {
                                    text(model)
                                    fontSize(13f)
                                    color(
                                        Color.parseString16ToLong(
                                            if (model == selectedModel) SaUIColors.BrandPrimary
                                            else SaUIColors.TextPrimarySolid
                                        )
                                    )
                                }
                            }
                            event {
                                click {
                                    // 选择后的收起状态由调用方统一负责，不能再 toggle。
                                    onModelSelect(model)
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}
