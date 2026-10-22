package com.sa.demo.auth

import com.sa.demo.core.platform.base64UrlEncode
import com.sa.demo.core.platform.randomBytes
import com.sa.demo.core.platform.sha256

/** RFC 7636 PKCE（S256）。 */
data class Pkce(
    val verifier: String,
    val challenge: String,
    val state: String,
    val method: String = "S256",
) {
    companion object {
        fun generate(): Pkce {
            val verifier = base64UrlEncode(randomBytes(32))
            val challenge = base64UrlEncode(sha256(verifier.encodeToByteArray()))
            val state = base64UrlEncode(randomBytes(24))
            return Pkce(verifier = verifier, challenge = challenge, state = state)
        }
    }
}
