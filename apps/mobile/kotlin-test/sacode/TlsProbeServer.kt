// 只在测试里用的本机 HTTPS 探针：把客户端**真的发出去的请求头**记下来。
//
// 为什么需要它：Last-Event-ID 这类「客户端有没有带上游标」的断言，对着 daemon 跑
// 拿不到可观察面（服务端接受任意游标值，不会因为头缺失而报错），只读客户端构造好的
// HttpRequest 又等于自证。所以起一个真 TLS 服务，让帧从真 socket 上过一遍。
package sacode

import com.sun.net.httpserver.HttpsConfigurator
import com.sun.net.httpserver.HttpsServer
import java.io.FileInputStream
import java.net.InetSocketAddress
import java.security.KeyFactory
import java.security.KeyStore
import java.security.cert.CertificateFactory
import java.security.cert.X509Certificate
import java.security.spec.PKCS8EncodedKeySpec
import javax.net.ssl.KeyManagerFactory
import javax.net.ssl.SSLContext

class TlsProbeServer(private val certPemPath: String, private val keyPemPath: String) {
    private val seen = HashMap<String, String>()
    private var server: HttpsServer? = null
    var requests: Int = 0

    @Synchronized
    fun header(name: String): String? = seen.entries
        .firstOrNull { it.key.equals(name, ignoreCase = true) }?.value

    fun start(): Int {
        val cert = CertificateFactory.getInstance("X.509")
            .generateCertificate(FileInputStream(certPemPath)) as X509Certificate
        val keyDer = SecureTransport.pemToDer(FileInputStream(keyPemPath).readBytes())
        val key = KeyFactory.getInstance("RSA").generatePrivate(PKCS8EncodedKeySpec(keyDer))
        val store = KeyStore.getInstance("PKCS12")
        store.load(null, null)
        store.setKeyEntry("probe", key, CharArray(0), arrayOf(cert))
        val kmf = KeyManagerFactory.getInstance(KeyManagerFactory.getDefaultAlgorithm())
        kmf.init(store, CharArray(0))
        val ctx = SSLContext.getInstance("TLS")
        ctx.init(kmf.keyManagers, null, null)

        val created = HttpsServer.create(InetSocketAddress("127.0.0.1", 0), 0)
        created.httpsConfigurator = HttpsConfigurator(ctx)
        created.createContext("/sse") { exchange ->
            val snapshot = HashMap<String, String>()
            for ((k, v) in exchange.requestHeaders) snapshot[k] = v.joinToString(",")
            synchronized(this) {
                seen.clear()
                seen.putAll(snapshot)
                requests += 1
            }
            val body = ": connected\n\n".toByteArray(Charsets.UTF_8)
            exchange.responseHeaders.add("Content-Type", "text/event-stream")
            exchange.sendResponseHeaders(200, body.size.toLong())
            exchange.responseBody.use { it.write(body) }
            exchange.close()
        }
        created.start()
        server = created
        return created.address.port
    }

    fun stop() {
        server?.stop(0)
        server = null
    }
}
