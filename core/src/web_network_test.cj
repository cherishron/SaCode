package core

import std.unittest.*

@Test
func webDnsPolicyRejectsMixedPublicAndPrivateResolution() {
    var rejected = false
    try { webCheckResolvedAddresses(["8.8.8.8", "127.0.0.1"]) }
    catch (_: Exception) { rejected = true }
    @Expect(rejected, true)
    @Expect(webCheckResolvedAddresses(["8.8.8.8", "1.1.1.1"]).size, Int64(2))
    rejected = false
    try { webCheckResolvedAddresses(Array<String>()) } catch (_: Exception) { rejected = true }
    @Expect(rejected, true)
}

@Test
func webPublicPolicyRejectsLocalAndReservedIpv4() {
    for (address in ["0.0.0.0", "10.1.2.3", "127.0.0.1", "169.254.169.254", "172.16.0.1", "192.168.1.1", "100.64.0.1", "198.18.0.1", "224.0.0.1", "255.255.255.255"]) {
        @Expect(webIsPublicAddress(address), false)
    }
    @Expect(webIsPublicAddress("8.8.8.8"), true)
    @Expect(webIsPublicAddress("1.1.1.1"), true)
}

@Test
func webPublicPolicyRejectsIpv6LocalAndEmbeddedIpv4() {
    for (address in ["::", "::1", "fc00::1", "fd00::1", "fe80::1", "ff02::1", "::ffff:127.0.0.1", "::ffff:7f00:1", "64:ff9b::7f00:1", "2001:db8::1"]) {
        @Expect(webIsPublicAddress(address), false)
    }
    @Expect(webIsPublicAddress("2606:4700:4700::1111"), true)
    @Expect(webIsPublicAddress("not-an-address"), false)
}

@Test
func webPublicPolicyRejectsCredentialsAndNonHttpUrls() {
    for (url in ["file:///etc/passwd", "javascript:alert(1)", "http://user:password@example.com/", "http://localhost/", "http://127.0.0.1/", "http://[::1]/", "http://example.com\\@127.0.0.1/", "http://example.com/\r\nInjected: yes"]) {
        @Expect(webUrlAllowed(url), false)
    }
    @Expect(webUrlAllowed("https://example.com/path?q=中文#section"), true)
}
