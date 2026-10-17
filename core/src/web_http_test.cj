package core

import std.unittest.*

@Test
func webHttpRejectsPrivateTargetBeforeConnection() {
    var rejected = false
    try { WebHttpTransport().request("http://127.0.0.1:1/", "GET", "", "", TurnToken()) }
    catch (_: Exception) { rejected = true }
    @Expect(rejected, true)
}

@Test
func webHttpHonorsCancellationBeforeDnsResolution() {
    let token = TurnToken()
    token.cancel()
    var message = ""
    try { WebHttpTransport().request("https://example.com/", "GET", "", "", token) }
    catch (error: Exception) { message = error.message }
    @Expect(message, "web-cancelled")
}
