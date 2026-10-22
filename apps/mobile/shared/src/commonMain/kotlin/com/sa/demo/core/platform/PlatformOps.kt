package  com.sa.demo.core.platform

/**
 * Platform-specific operations declared via expect/actual.
 * Each platform provides its own implementation.
 */
expect class PlatformContext

expect fun getPlatformContext(): PlatformContext

/**
 * Show a short toast message on the current platform.
 */
expect fun PlatformContext.showToast(message: String)
