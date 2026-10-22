package com.sa.demo.core.platform

/** 新接入页面回调专用：投递到 Kuikly 执行队列，不是 Android 主线程。页面仍须检查自身 epoch。 */
object KuiklyThreadBridge {
    @Volatile var dispatch: ((() -> Unit) -> Unit)? = null
}

expect fun postToKuikly(block: () -> Unit)

/** 设备秘密请求不允许跟随重定向；响应体最多 1 MiB。 */
expect fun remoteHttpExecuteBlocking(request: HttpRequest): HttpResponse

/** 后台可取消等待；false 表示取消，禁止在 UI 队列调用。 */
expect fun remoteWait(delayMs: Long, token: CancelToken): Boolean

/** Agent 专用 SSE：保留空行，校验状态/媒体类型，禁止重定向，支持取消。后台阻塞调用。 */
expect fun remoteStreamSse(request: HttpRequest, token: CancelToken, onLine: (String) -> Unit)

/** 不公开任意响应体，避免认证材料进入异常日志。 */
class RemoteStreamException(val status: Int, reason: String) : Exception(reason)
