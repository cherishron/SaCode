// 传输层：目标地址校验 + 服务端证书指纹绑定。
//
// 设计 §4「所有网络，包括内网，都禁止明文 bearer」——所以拒绝明文不是「配置项」，
// 而是这一层唯一能存在的形态：任何 bearer 在离开进程前都要先过 validatedBase。
// 指纹绑定按**服务端实际出示的那张叶子证书**算，不看 CA 链：自签与内部 CA 都同样成立，
// 而「换个受信 CA 的证书」也不会被误接受。
package sacode

import java.io.FileInputStream
import java.net.URI
import java.net.http.HttpClient
import java.security.MessageDigest
import java.security.cert.CertificateException
import java.security.cert.CertificateFactory
import java.security.cert.X509Certificate
import java.time.Duration
import java.util.Base64
import javax.net.ssl.SSLContext
import javax.net.ssl.X509TrustManager

class PlaintextTarget(message: String) : IllegalArgumentException(message)

fun validatedBase(url: String): String {
    val uri = try { URI.create(url) } catch (e: Exception) { throw PlaintextTarget("target-unparseable") }
    if (uri.scheme != "https") throw PlaintextTarget("target-scheme-must-be-https")
    if (uri.host == null || uri.host.isEmpty()) throw PlaintextTarget("target-host-missing")
    if (uri.userInfo != null) throw PlaintextTarget("target-userinfo-forbidden")
    return url.trimEnd('/')
}

class SecureTransport(private val pinSha256Hex: String) {

    fun client(): HttpClient {
        val ctx = SSLContext.getInstance("TLS")
        ctx.init(null, arrayOf(PinnedTrustManager(pinSha256Hex)), null)
        return HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(8))
            .followRedirects(HttpClient.Redirect.NEVER)
            .sslContext(ctx)
            .build()
    }

    companion object {
        fun fingerprintOfPem(path: String): String {
            val der = pemToDer(FileInputStream(path).readBytes())
            val cf = CertificateFactory.getInstance("X.509")
            val cert = cf.generateCertificate(java.io.ByteArrayInputStream(der)) as X509Certificate
            return hex(MessageDigest.getInstance("SHA-256").digest(cert.encoded))
        }

        fun pemToDer(bytes: ByteArray): ByteArray {
            val text = String(bytes, Charsets.UTF_8)
            val body = text.lines()
                .filter { it.isNotBlank() && !it.startsWith("-----") }
                .joinToString("")
            return Base64.getDecoder().decode(body)
        }

        fun hex(bytes: ByteArray): String {
            val sb = StringBuilder()
            for (b in bytes) sb.append("%02x".format(b.toInt() and 0xff))
            return sb.toString()
        }
    }
}

internal class PinnedTrustManager(private val pin: String) : X509TrustManager {
    override fun checkClientTrusted(chain: Array<X509Certificate>, authType: String) {}

    override fun checkServerTrusted(chain: Array<X509Certificate>, authType: String) {
        if (chain.isEmpty()) throw CertificateException("empty-cert-chain")
        val actual = SecureTransport.hex(
            MessageDigest.getInstance("SHA-256").digest(chain[0].encoded)
        )
        if (!actual.equals(pin.replace(":", ""), ignoreCase = true)) {
            throw CertificateException("pin-mismatch expected=$pin actual=$actual")
        }
    }

    override fun getAcceptedIssuers(): Array<X509Certificate> = arrayOf()
}
