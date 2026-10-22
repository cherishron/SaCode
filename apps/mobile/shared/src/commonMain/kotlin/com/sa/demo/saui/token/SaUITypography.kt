package com.sa.demo.saui.token

object SaUITypography {

    enum class FontSize(val size: Float) {
        XXS(10f),
        XS(12f),
        S(14f),
        M(16f),
        L(18f),
        XL(20f),
        XXL(24f),
        XXXL(28f)
    }

    object Heading {
        const val H1 = 28f
        const val H2 = 24f
        const val H3 = 20f
        const val H4 = 18f
    }

    object Body {
        const val Large = 16f
        const val Medium = 14f
        const val Small = 12f
    }

    object Caption {
        const val Regular = 12f
        const val Small = 10f
    }

    const val LineHeightTight = 1.2f
    const val LineHeightNormal = 1.5f
    const val LineHeightLoose = 1.8f
}
