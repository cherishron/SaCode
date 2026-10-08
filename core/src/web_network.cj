package core

import std.net.*
import std.convert.*

public func webCheckResolvedAddresses(addresses: Array<String>): Array<String> {
    if (addresses.size == 0) { throw Exception("web-dns-empty") }
    for (address in addresses) {
        if (!webIsPublicAddress(address)) { throw Exception("web-private-address") }
    }
    return addresses
}

public func webIsPublicAddress(text: String): Bool {
    try {
        let address = IPAddress.parse(text)
        if (!address.isGlobalUnicast() || address.isLoopback() || address.isPrivate() || address.isMulticast()) {
            return false
        }
        let excluded = if (address.isIPv4()) {
            ["0.0.0.0/8", "10.0.0.0/8", "100.64.0.0/10", "127.0.0.0/8", "169.254.0.0/16", "172.16.0.0/12", "192.0.0.0/24", "192.0.2.0/24", "192.168.0.0/16", "198.18.0.0/15", "198.51.100.0/24", "203.0.113.0/24", "224.0.0.0/4", "240.0.0.0/4"]
        } else {
            ["::/96", "::ffff:0:0/96", "64:ff9b::/96", "64:ff9b:1::/48", "100::/64", "2001::/23", "2001:db8::/32", "2002::/16", "fc00::/7", "fe80::/10", "ff00::/8"]
        }
        for (prefix in excluded) {
            if (IPPrefix.parse(prefix).contains(address)) { return false }
        }
        return true
    } catch (_: Exception) { return false }
}

public class WebUrlTarget {
    public let scheme: String
    public let host: String
    public let port: UInt16
    public let origin: String

    public init(url: String) {
        if (url.size == 0 || url.size > 2048) { throw Exception("web-bad-url") }
        for (byte in url.toArray()) {
            if (byte <= 32 || byte == 127 || byte == 92) { throw Exception("web-bad-url") }
        }
        let separator = url.indexOf("://") ?? Int64(-1)
        if (separator < 0) { throw Exception("web-bad-url") }
        this.scheme = url[0..separator].toAsciiLower()
        if (scheme != "http" && scheme != "https") { throw Exception("web-bad-scheme") }
        let remainder = url[(separator + 3)..]
        var end = remainder.size
        for (delimiter in ["/", "?", "#"]) {
            if (let Some(position) <- remainder.indexOf(delimiter)) { end = min(end, position) }
        }
        let authority = remainder[0..end]
        if (authority.size == 0 || authority.contains("@") || authority.contains("%")) {
            throw Exception("web-bad-authority")
        }
        var hostname = authority
        var portText = ""
        if (authority.startsWith("[")) {
            let close = authority.indexOf("]") ?? Int64(-1)
            if (close < 0) { throw Exception("web-bad-authority") }
            hostname = authority[1..close]
            let suffix = authority[(close + 1)..]
            if (suffix.size > 0) {
                if (!suffix.startsWith(":")) { throw Exception("web-bad-authority") }
                portText = suffix[1..]
                if (portText.size == 0) { throw Exception("web-bad-port") }
            }
            if (!IPAddress.parse(hostname).isIPv6()) { throw Exception("web-bad-authority") }
        } else {
            if (let Some(colon) <- authority.indexOf(":")) {
                hostname = authority[0..colon]
                portText = authority[(colon + 1)..]
                if (portText.size == 0 || portText.contains(":")) { throw Exception("web-bad-port") }
            }
            for (byte in hostname.toArray()) {
                if (!((byte >= 65 && byte <= 90) || (byte >= 97 && byte <= 122) ||
                    (byte >= 48 && byte <= 57) || byte == 45 || byte == 46)) {
                    throw Exception("web-bad-host")
                }
            }
        }
        if (hostname.size == 0) { throw Exception("web-bad-host") }
        this.host = hostname.toAsciiLower()
        if (portText.size > 0) {
            for (byte in portText.toArray()) {
                if (byte < 48 || byte > 57) { throw Exception("web-bad-port") }
            }
        }
        this.port = if (portText.size == 0) { if (scheme == "https") { UInt16(443) } else { UInt16(80) } }
            else { UInt16.parse(portText) }
        if (port == 0) { throw Exception("web-bad-port") }
        this.origin = "${scheme}://${host}:${port}"
    }
}

public func webUrlAllowed(url: String): Bool {
    try {
        let target = WebUrlTarget(url)
        let host = target.host
        if (host == "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) {
            return false
        }
        if (let Some(_) <- IPAddress.tryParse(host)) { return webIsPublicAddress(host) }
        if (!host.contains(".") || host.startsWith(".") || host.endsWith(".") || host.contains("..")) {
            return false
        }
        return true
    } catch (_: Exception) { return false }
}
