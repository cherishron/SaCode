package com.sa.demo.core.platform

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.util.Base64
import android.util.Log
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import java.security.SecureRandom

object AndroidPlatform {
    @Volatile
    lateinit var appContext: Context
        private set

    fun init(context: Context) {
        appContext = context.applicationContext
    }
}

actual fun sha256(data: ByteArray): ByteArray =
    MessageDigest.getInstance("SHA-256").digest(data)

actual fun base64UrlEncode(data: ByteArray): String =
    Base64.encodeToString(data, Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING)

actual fun randomBytes(size: Int): ByteArray =
    ByteArray(size).also { SecureRandom().nextBytes(it) }

actual fun urlEncode(value: String): String =
    java.net.URLEncoder.encode(value, Charsets.UTF_8.name())

actual fun httpExecuteBlocking(request: HttpRequest): HttpResponse {
    val conn = openConnection(request)
    try {
        val code = conn.responseCode
        val stream = if (code >= 400) conn.errorStream else conn.inputStream
        val text = stream?.bufferedReader()?.use { it.readText() } ?: ""
        Log.d("SaAppHttp", "${request.method} ${request.url} -> $code")
        return HttpResponse(code, text)
    } finally {
        conn.disconnect()
    }
}

actual fun httpStreamSse(request: HttpRequest, token: CancelToken, onLine: (String) -> Unit) {
    if (token.isCancelled) return
    val conn = openConnection(request)
    // 取消时 disconnect 可让阻塞中的 readLine() 立刻抛 IOException 退出，
    // 否则要等到服务端下发下一行才生效。
    token.onCancel { runCatching { conn.disconnect() } }
    try {
        val code = conn.responseCode
        if (code >= 400) {
            val err = conn.errorStream?.bufferedReader()?.use { it.readText() } ?: ""
            throw IllegalStateException("SSE HTTP $code: ${err.take(300)}")
        }
        conn.inputStream?.bufferedReader()?.use { reader ->
            var line = reader.readLine()
            while (line != null && !token.isCancelled) {
                if (line.isNotBlank()) onLine(line)
                line = reader.readLine()
            }
        }
    } catch (t: Throwable) {
        // 取消导致的断开属于预期路径，不向上抛
        if (!token.isCancelled) throw t
    } finally {
        conn.disconnect()
    }
}

private fun openConnection(request: HttpRequest): HttpURLConnection {
    val conn = URL(request.url).openConnection() as HttpURLConnection
    conn.requestMethod = request.method
    conn.connectTimeout = 15_000
    conn.readTimeout = 120_000
    conn.instanceFollowRedirects = request.headers.keys.none { it.equals("Authorization", ignoreCase = true) }
    request.headers.forEach { (k, v) -> conn.setRequestProperty(k, v) }
    val body = request.body
    if (body != null) {
        conn.doOutput = true
        conn.outputStream.use { it.write(body.encodeToByteArray()) }
    }
    return conn
}

actual fun <T> asyncRun(work: () -> T, onDone: (Result<T>) -> Unit) {
    Thread {
        val result = try {
            Result.success(work())
        } catch (t: Throwable) {
            Result.failure(t)
        }
        Handler(Looper.getMainLooper()).post { onDone(result) }
    }.start()
}

actual fun postToMain(block: () -> Unit) {
    if (Looper.myLooper() == Looper.getMainLooper()) {
        block()
    } else {
        Handler(Looper.getMainLooper()).post { block() }
    }
}

actual fun openUrlInBrowser(url: String) {
    val intent = Intent(Intent.ACTION_VIEW, Uri.parse(url)).apply {
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    }
    AndroidPlatform.appContext.startActivity(intent)
}

actual fun copyToClipboard(label: String, text: String): Boolean = runCatching {
    val ctx = AndroidPlatform.appContext
    val cm = ctx.getSystemService(Context.CLIPBOARD_SERVICE) as? ClipboardManager ?: return false
    cm.setPrimaryClip(ClipData.newPlainText(label, text))
    true
}.getOrElse {
    Log.w("SaApp", "copyToClipboard failed: ${it.message}")
    false
}

actual fun navigateToPage(pageName: String) {
    // 优先宿主桥；shared 不依赖 framework，兜底打日志
    val nav = PageRouterBridge.navigate
    if (nav != null) {
        nav(pageName)
    } else {
        Log.w("SaApp", "PageRouterBridge.navigate not set; cannot open $pageName")
    }
}

actual fun currentTimeMillis(): Long = System.currentTimeMillis()
