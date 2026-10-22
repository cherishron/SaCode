package com.sa.demo.core.platform

/**
 * HarmonyOS (ohosArm64) 平台实现
 * PlatformContext 为无平台依赖的标记类
 * showToast 首版空实现（登记差异：SaUICatalogPage Demo 未使用 toast）
 */
actual class PlatformContext

actual fun getPlatformContext(): PlatformContext {
    throw IllegalStateException("Must be initialized before use on HarmonyOS")
}

actual fun PlatformContext.showToast(message: String) {
    // 首版空实现：鸿蒙侧无宿主 Toast 通道
    // 日志可观测性由 KRLogAdapter → hilog 承担
    // 已登记差异：docs/ohos-known-differences.md
}