package core

import std.unittest.*

@Test
func webQueryEncodingPreservesUnreservedAndEscapesSeparators() {
    @Expect(webUrlEncode("Az09-._~"), "Az09-._~")
    @Expect(webUrlEncode("a b+c&d=e/f?x%"), "a%20b%2Bc%26d%3De%2Ff%3Fx%25")
    @Expect(webUrlEncode(""), "")
}

@Test
func webQueryEncodingUsesUtf8BytesAndPaddedUppercaseHex() {
    @Expect(webUrlEncode("中文"), "%E4%B8%AD%E6%96%87")
    @Expect(webUrlEncode("\n\t"), "%0A%09")
}
