// 凭据面：票据登记 → 兑换令牌 → 只在内存里持有 Bearer。
//
// 两条硬约束写在这里而不是写在调用方：① 任何一次网络请求都先过 validatedBase，
// 明文目标在拿到凭据之前就炸；② 异常里只带 HTTP 状态，不带响应正文——登记响应正文
// 就是那 32 字节凭据明文，把它拼进错误消息等于把凭据写进日志。
package sacode

class StoredCredential(val deviceId: String, val accessToken: String, val expiresAtMillis: Long) {
    override fun toString(): String =
        "StoredCredential(deviceId=$deviceId, accessToken=<redacted>, expiresAtMillis=$expiresAtMillis)"
}

class CredentialStore(private val transport: SecureTransport) {
    private var held: StoredCredential? = null

    fun bootstrap(base: String, ticket: String, deviceName: String, kind: String): StoredCredential {
        val root = validatedBase(base)
        if (ticket.isBlank()) throw IllegalArgumentException("enrollment-ticket-required")
        if (deviceName.isBlank()) throw IllegalArgumentException("device-name-required")
        val enrollBody = Json.stringify(
            linkedMapOf<String, Any?>("enrollmentSecret" to ticket, "deviceName" to deviceName, "kind" to kind)
        )
        val enrolled = transport.client().post("$root/auth/enroll", enrollBody, null)
        if (enrolled.first != 200) throw IllegalStateException("enroll-http-${enrolled.first}")
        val o = Json.obj(Json.parse(enrolled.second))
        val deviceId = field(o, "deviceId")
        val credential = field(o, "credential")

        val tokenBody = Json.stringify(linkedMapOf<String, Any?>("deviceId" to deviceId, "credential" to credential))
        val exchanged = transport.client().post("$root/auth/token", tokenBody, null)
        if (exchanged.first != 200) throw IllegalStateException("token-http-${exchanged.first}")
        val t = Json.obj(Json.parse(exchanged.second))
        val access = field(t, "accessToken")
        if (field(t, "tokenType") != "Bearer") throw IllegalStateException("token-type-not-bearer")
        val expiresIn = t["expiresInMs"] as? Long ?: throw IllegalStateException("token-expiry-missing")
        if (expiresIn <= 0L) throw IllegalStateException("token-expiry-nonpositive")

        val stored = StoredCredential(deviceId, access, System.currentTimeMillis() + expiresIn)
        held = stored
        return stored
    }

    fun bearer(): String {
        val c = held ?: throw IllegalStateException("credential-absent")
        if (c.expiresAtMillis <= System.currentTimeMillis()) throw IllegalStateException("credential-expired")
        return "Bearer ${c.accessToken}"
    }

    fun current(): StoredCredential? = held

    // 只给测试用：过期窗口是服务端给的 15 分钟，没有注入通道就只能干等，
    // 而「过期后还发不发 bearer」这条不能靠等出来的绿算证据。
    internal fun inject(credential: StoredCredential) {
        held = credential
    }

    private fun field(o: Map<String, Any?>, key: String): String {
        val raw = o[key] ?: throw IllegalStateException("auth-response-missing-$key")
        if (raw !is String) throw IllegalStateException("auth-response-field-not-string-$key")
        if (raw.isEmpty()) throw IllegalStateException("auth-response-field-blank-$key")
        return raw
    }
}
