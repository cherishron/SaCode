package com.sa.demo.saui.token

import com.tencent.kuikly.core.base.BoxShadow
import com.tencent.kuikly.core.base.Color

object SaUIShadow {
    data class ShadowSpec(
        val offsetX: Float = 0f,
        val offsetY: Float = 0f,
        val blur: Float = 0f,
        val color: String,
        val alpha: Float = 0f
    )

    val LightSpec = listOf(
        ShadowSpec(offsetX = 0f, offsetY = 1f, blur = 2f, color = SaUIColors.ShadowLight, alpha = 0.05f),
        ShadowSpec(offsetX = 0f, offsetY = 1f, blur = 6f, color = SaUIColors.ShadowLight, alpha = 0.03f)
    )

    val RegularSpec = listOf(
        ShadowSpec(offsetX = 0f, offsetY = 2f, blur = 4f, color = SaUIColors.ShadowRegular, alpha = 0.08f),
        ShadowSpec(offsetX = 0f, offsetY = 4f, blur = 16f, color = SaUIColors.ShadowRegular, alpha = 0.06f)
    )

    val HeavySpec = listOf(
        ShadowSpec(offsetX = 0f, offsetY = 4f, blur = 8f, color = SaUIColors.ShadowHeavy, alpha = 0.12f),
        ShadowSpec(offsetX = 0f, offsetY = 8f, blur = 24f, color = SaUIColors.ShadowHeavy, alpha = 0.08f)
    )

    fun toBoxShadow(spec: ShadowSpec): BoxShadow {
        return BoxShadow(
            offsetX = spec.offsetX,
            offsetY = spec.offsetY,
            shadowRadius = spec.blur,
            shadowColor = Color(Color.parseString16ToLong(spec.color))
        )
    }

    fun toBoxShadows(specs: List<ShadowSpec>): List<BoxShadow> {
        return specs.map { toBoxShadow(it) }
    }
}
