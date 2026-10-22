package com.sa.demo.saui.base

import com.sa.demo.saui.token.SaUIColors
import com.sa.demo.saui.token.SaUIRadius
import com.tencent.kuikly.core.base.Border
import com.tencent.kuikly.core.base.BorderStyle
import com.tencent.kuikly.core.base.Color
import com.tencent.kuikly.core.base.ViewBuilder
import com.tencent.kuikly.core.views.compose.Button

object SaButton {

    enum class Variant {
        PRIMARY, PRIMARY_OUTLINE, SECONDARY, TEXT, DANGER, DANGER_OUTLINE
    }

    enum class ButtonSize(val height: Float, val fontSize: Float, val paddingH: Float, val radius: Float) {
        SMALL(32f, 14f, 12f, SaUIRadius.Small),
        MEDIUM(40f, 16f, 16f, SaUIRadius.Medium),
        LARGE(48f, 16f, 24f, SaUIRadius.Medium)
    }

    fun build(
        text: String,
        variant: Variant = Variant.PRIMARY,
        size: ButtonSize = ButtonSize.MEDIUM,
        disabled: Boolean = false,
        block: Boolean = false,
        icon: String? = null,
        onClick: () -> Unit = {}
    ): ViewBuilder = {
        Button {
            attr {
                if (block) {
                    flex(1f)
                }
                height(size.height)
                borderRadius(size.radius)
                padding(left = size.paddingH, right = size.paddingH)

                val colors = resolveColors(variant, disabled)

                backgroundColor(Color.parseString16ToLong(colors.bg))
                highlightBackgroundColor(Color(Color.parseString16ToLong(colors.highlightBg)))

                if (colors.border != null) {
                    border(Border(1f, BorderStyle.SOLID, Color(Color.parseString16ToLong(colors.border))))
                }

                titleAttr {
                    text(if (icon != null) "$icon $text" else text)
                    fontSize(size.fontSize)
                    color(Color.parseString16ToLong(colors.text))
                    fontWeightMedium()
                }
            }
            event {
                click {
                    if (!disabled) onClick()
                }
            }
        }
    }

    private data class ButtonColors(
        val bg: String,
        val highlightBg: String,
        val text: String,
        val border: String?
    )

    private fun resolveColors(variant: Variant, disabled: Boolean): ButtonColors {
        if (disabled) {
            return ButtonColors(
                bg = SaUIColors.BgComponent,
                highlightBg = SaUIColors.BgComponent,
                text = SaUIColors.TextDisabledSolid,
                border = null
            )
        }

        return when (variant) {
            Variant.PRIMARY -> ButtonColors(
                bg = SaUIColors.BrandPrimary,
                highlightBg = "0xFF003CAB",
                text = SaUIColors.TextAnti,
                border = null
            )
            Variant.PRIMARY_OUTLINE -> ButtonColors(
                bg = SaUIColors.BrandFocus,
                highlightBg = "0xFFCCDDFF",
                text = SaUIColors.BrandPrimary,
                border = SaUIColors.BrandPrimary
            )
            Variant.SECONDARY -> ButtonColors(
                bg = SaUIColors.BgComponent,
                highlightBg = SaUIColors.BgComponentActive,
                text = SaUIColors.TextPrimarySolid,
                border = null
            )
            Variant.TEXT -> ButtonColors(
                bg = SaUIColors.Transparent,
                highlightBg = SaUIColors.BgComponent,
                text = SaUIColors.BrandPrimary,
                border = null
            )
            Variant.DANGER -> ButtonColors(
                bg = SaUIColors.Error,
                highlightBg = "0xFFC9353F",
                text = SaUIColors.TextAnti,
                border = null
            )
            Variant.DANGER_OUTLINE -> ButtonColors(
                bg = SaUIColors.ErrorLight,
                highlightBg = "0xFFFAD4D7",
                text = SaUIColors.Error,
                border = SaUIColors.Error
            )
        }
    }
}
