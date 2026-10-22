package com.sa.demo.core.platform

expect fun sha256(data: ByteArray): ByteArray

expect fun base64UrlEncode(data: ByteArray): String

expect fun randomBytes(size: Int): ByteArray

/** application/x-www-form-urlencoded 与 query 用的百分号编码。 */
expect fun urlEncode(value: String): String
