package com.sa.demo.env

/**
 * saai 产品线移动端接入配置。
 * 本地开发 issuer/gateway 必须使用 127.0.0.1 字面量，与 sa-idp JWT iss / 冒烟脚本一致。
 */
data class SaaiEnv(
    val issuer: String,
    val gatewayUrl: String,
    val clientId: String,
    val redirectUri: String,
    val scope: String = "openid profile email phone",
) {
    val authorizeUrl: String get() = "${issuer.trimEnd('/')}/oauth/authorize"
    val tokenUrl: String get() = "${issuer.trimEnd('/')}/oauth/token"
    val exchangeUrl: String get() = "${gatewayUrl.trimEnd('/')}/api/auth/exchange"
    val modelsUrl: String get() = "${gatewayUrl.trimEnd('/')}/v1/models"

    companion object {
        /** 本地联调默认环境（IdP :8080 · gateway-rs :8090）。 */
        val Dev = SaaiEnv(
            issuer = "http://127.0.0.1:8080",
            gatewayUrl = "http://127.0.0.1:8090",
            clientId = "saapp",
            redirectUri = "saapp://oauth/callback",
        )

        @Volatile
        var current: SaaiEnv = Dev
    }
}
