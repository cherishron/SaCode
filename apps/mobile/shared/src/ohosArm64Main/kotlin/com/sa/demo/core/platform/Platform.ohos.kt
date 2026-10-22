package com.sa.demo.core.platform

import io.github.aakira.napier.Napier

// OHOS M1：契约与桩实现齐备，真机 HTTP/安全存储在 M4 接入。

actual fun sha256(data: ByteArray): ByteArray =
    throw UnsupportedOperationException("OHOS sha256 待 M4 接入")

actual fun base64UrlEncode(data: ByteArray): String =
    throw UnsupportedOperationException("OHOS base64 待 M4 接入")

actual fun randomBytes(size: Int): ByteArray =
    throw UnsupportedOperationException("OHOS random 待 M4 接入")

actual fun urlEncode(value: String): String =
    value.map { c ->
        when {
            c.isLetterOrDigit() || c in "-._~" -> c.toString()
            else -> "%" + c.code.toString(16).uppercase().padStart(2, '0')
        }
    }.joinToString("")

actual fun httpExecuteBlocking(request: HttpRequest): HttpResponse =
    throw UnsupportedOperationException("OHOS HTTP 待 M4 接入：${request.url}")

actual fun httpStreamSse(request: HttpRequest, token: CancelToken, onLine: (String) -> Unit) {
    throw UnsupportedOperationException("OHOS SSE 待 M4 接入：${request.url}")
}

actual fun <T> asyncRun(work: () -> T, onDone: (Result<T>) -> Unit) {
    onDone(
        try {
            Result.success(work())
        } catch (t: Throwable) {
            Result.failure(t)
        }
    )
}

actual fun postToMain(block: () -> Unit) {
    block()
}

actual fun openUrlInBrowser(url: String) {
    Napier.w { "OHOS openUrl 待接入: $url" }
}

actual fun copyToClipboard(label: String, text: String): Boolean {
    // 鸿蒙需 @ohos.multimedia.image / pasteboard Kit，M4 一并接入
    Napier.w { "OHOS copyToClipboard 待 M4 接入" }
    return false
}

actual fun navigateToPage(pageName: String) {
    Napier.w { "OHOS navigateToPage 待接入: $pageName" }
}

actual fun currentTimeMillis(): Long =
    kotlin.time.TimeSource.Monotonic.markNow().elapsedNow().inWholeMilliseconds
