package com.sa.demo.core.platform

actual fun remoteHttpExecuteBlocking(request: HttpRequest): HttpResponse {
    throw UnsupportedOperationException("OHOS Agent HTTP 尚未接入")
}

actual fun remoteWait(delayMs: Long, token: CancelToken): Boolean {
    throw UnsupportedOperationException("OHOS 后台可取消等待尚未接入")
}

actual fun postToKuikly(block: () -> Unit) {
    throw UnsupportedOperationException("OHOS Kuikly 线程桥尚未接入")
}

actual fun remoteStreamSse(request: HttpRequest, token: CancelToken, onLine: (String) -> Unit) {
    throw UnsupportedOperationException("OHOS Agent SSE 尚未接入")
}
