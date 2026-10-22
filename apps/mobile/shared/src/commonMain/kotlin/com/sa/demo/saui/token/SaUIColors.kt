package com.sa.demo.saui.token

/**
 * SaUI 颜色令牌。
 *
 * ⚠️ 格式约定（与 Kuikly 版本强相关，务必遵守）：
 * Kuikly 的 `Color.parseString16ToLong()` 最终走 `ConvertUtil.parseString16ToLong`
 * → `parseMd5L16ToLong`，它**只接受 0-9a-f 字符**，仅剥离 `0x` 前缀，且**不会自动补 alpha**。
 *
 * 实测结果：
 * - `"#F5F5F5"`    → `#` 为非法字符，抛异常 → `Color.parseString16ToLong` 回退默认值 `0xFF0000FF`（纯蓝）
 * - `"F5F5F5"`     → 解析成 `0x00F5F5F5`，alpha = 0 → 全透明
 * - `"0xFFF5F5F5"` → ✅ 正确（不透明）
 *
 * 因此所有颜色令牌统一写成 `0xAARRGGBB`。
 */
object SaUIColors {
    // Brand
    const val BrandPrimary = "0xFF0052D9"
    const val BrandLight = "0xFF366EF4"
    const val BrandFocus = "0xFFE0EBFF"
    const val BrandDisabled = "0xFFB8D3FF"

    // Functional
    const val Success = "0xFF00A870"
    const val SuccessLight = "0xFFE8F8F2"
    const val Warning = "0xFFED7B2F"
    const val WarningLight = "0xFFFEF3E6"
    const val Error = "0xFFE34D59"
    const val ErrorLight = "0xFFFDECEE"
    const val Info = "0xFF0052D9"

    // Text
    const val TextPrimary = "0xFF000000"
    const val TextPrimaryAlpha = 0.9f
    const val TextSecondary = "0xFF000000"
    const val TextSecondaryAlpha = 0.6f
    const val TextPlaceholder = "0xFF000000"
    const val TextPlaceholderAlpha = 0.4f
    const val TextDisabled = "0xFF000000"
    const val TextDisabledAlpha = 0.26f
    const val TextAnti = "0xFFFFFFFF"

    // Text opaque versions for Kuikly（已自带 alpha，不需再叠加透明度）
    const val TextPrimarySolid = "0xFF1A1A1A"
    const val TextSecondarySolid = "0xFF999999"
    const val TextPlaceholderSolid = "0xFFBBBBBB"
    const val TextDisabledSolid = "0xFFC8C8C8"

    // Background
    const val BgPage = "0xFFF5F5F5"
    const val BgContainer = "0xFFFFFFFF"
    const val BgComponent = "0xFFE7E7E7"
    const val BgComponentActive = "0xFFDCDCDC"

    // Border
    const val BorderLevel1 = "0xFFE7E7E7"
    const val BorderLevel2 = "0xFFDCDCDC"

    // Shadow
    const val ShadowLight = "0xFF000000"
    const val ShadowRegular = "0xFF000000"
    const val ShadowHeavy = "0xFF000000"

    // Overlay
    const val Overlay = "0xFF000000"
    const val OverlayAlpha = 0.6f

    /** 完全透明：替代非法字面量 "transparent" */
    const val Transparent = "0x00000000"
}
