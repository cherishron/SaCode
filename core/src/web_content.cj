package core

import std.collection.*

public func webDecodeContent(bytes: Array<Byte>, contentType: String, truncated: Bool): String {
    let parts = contentType.toAsciiLower().split(";")
    let mime = parts[0].trimAscii()
    if (!(mime.startsWith("text/") || mime == "application/json" || mime == "application/xml" ||
        mime == "application/xhtml+xml" || mime.endsWith("+json") || mime.endsWith("+xml"))) {
        throw Exception("web-unsupported-content-type")
    }
    var charset = "utf-8"
    for (part in parts) {
        let value = part.trimAscii()
        if (value.startsWith("charset=")) { charset = value[8..].replace("\"", "").replace("'", "").trimAscii() }
    }
    if (charset == "iso-8859-1" || charset == "latin1" || charset == "latin-1") {
        let output = ArrayList<Byte>()
        for (byte in bytes) {
            if (byte < 128) { output.add(byte) }
            else { output.add(UInt8(192 + Int64(byte) / 64)); output.add(UInt8(128 + Int64(byte) % 64)) }
        }
        return String.fromUtf8(output.toArray())
    }
    if (charset != "utf-8" && charset != "utf8" && charset != "us-ascii") { throw Exception("web-unsupported-charset") }
    if (charset == "us-ascii") {
        for (byte in bytes) { if (byte >= 128) { throw Exception("web-invalid-encoding") } }
    }
    var length = bytes.size
    while (true) {
        try { return String.fromUtf8(bytes[0..length]) }
        catch (_: Exception) {
            if (!truncated || length == 0 || bytes.size - length >= 3) { throw Exception("web-invalid-encoding") }
            length -= 1
        }
    }
    throw Exception("web-invalid-encoding")
}

func webHtmlAttribute(tag: String, name: String): String {
    let lower = tag.toAsciiLower()
    var position: Int64 = 0
    while (position < tag.size) {
        let found = lower[position..].indexOf(name) ?? Int64(-1)
        if (found < 0) { return "" }
        position += found
        if (position > 0 && lower[position - 1] != 32 && lower[position - 1] != 9 && lower[position - 1] != 10) {
            position += name.size
            continue
        }
        var valueStart = position + name.size
        while (valueStart < tag.size && tag[valueStart] == 32) { valueStart += 1 }
        if (valueStart >= tag.size || tag[valueStart] != 61) { position += name.size; continue }
        valueStart += 1
        while (valueStart < tag.size && tag[valueStart] == 32) { valueStart += 1 }
        if (valueStart >= tag.size) { return "" }
        let delimiterByte = tag[valueStart]
        if (delimiterByte == 34 || delimiterByte == 39) {
            var end = valueStart + 1
            while (end < tag.size && tag[end] != delimiterByte) { end += 1 }
            return tag[(valueStart + 1)..end]
        }
        var end = valueStart
        while (end < tag.size && tag[end] != 32 && tag[end] != 62) { end += 1 }
        return tag[valueStart..end]
    }
    return ""
}

public func webHtmlToMarkdown(html: String): String {
    var output = ""
    var position: Int64 = 0
    let links = ArrayList<String>()
    var depth: Int64 = 0
    while (position < html.size) {
        let start = html[position..].indexOf("<") ?? Int64(-1)
        if (start < 0) { output += html[position..]; break }
        output += html[position..(position + start)]
        position += start
        let endOffset = html[position..].indexOf(">") ?? Int64(-1)
        if (endOffset < 0) { output += html[position..]; break }
        let raw = html[(position + 1)..(position + endOffset)].trimAscii()
        position += endOffset + 1
        let lower = raw.toAsciiLower()
        let closing = lower.startsWith("/")
        let token = if (closing) { lower[1..] } else { lower }
        let name = token.split(" ")[0].split("\n")[0].split("\t")[0].replace("/", "")
        if (name.size == 0 || name.startsWith("!")) { continue }
        if (!closing && !lower.endsWith("/") && name != "br" && name != "hr" && name != "img" && name != "meta" && name != "input") { depth += 1 }
        if (closing) { depth = max(Int64(0), depth - 1) }
        if (depth > 512) { return "[网页结构过深，正文已省略]" }
        let hidden = lower.contains(" hidden") || webHtmlAttribute(raw, "aria-hidden") == "true" ||
            webHtmlAttribute(raw, "style").toAsciiLower().replace(" ", "").contains("display:none")
        if (!closing && (name == "head" || name == "script" || name == "style" || name == "iframe" || name == "noscript" || hidden)) {
            let marker = "</${name}"
            let closeOffset = html[position..].toAsciiLower().indexOf(marker) ?? Int64(-1)
            if (closeOffset < 0) { break }
            position += closeOffset
            let closeEnd = html[position..].indexOf(">") ?? Int64(-1)
            if (closeEnd < 0) { break }
            position += closeEnd + 1
            depth = max(Int64(0), depth - 1)
            continue
        }
        if (name == "p" || name == "div" || name == "section" || name == "article" || name == "tr") { output += "\n\n" }
        else if (name == "br" || name == "hr") { output += "\n" }
        else if (name == "strong" || name == "b") { output += "**" }
        else if (name == "em" || name == "i") { output += "*" }
        else if (name == "code") { output += "`" }
        else if (name == "pre") { output += "\n```\n" }
        else if (name == "li") { output += if (closing) { "\n" } else { "\n- " } }
        else if (name == "a") {
            if (!closing) { links.add(webHtmlAttribute(raw, "href")); output += "[" }
            else if (links.size > 0) {
                let href = links.remove(at: links.size - 1)
                output += if (href.startsWith("https://") || href.startsWith("http://") || href.startsWith("/") || href.startsWith("#")) { "](${href})" } else { "]" }
            }
        } else if (name.size == 2 && name.startsWith("h") && name[1] >= 49 && name[1] <= 54) {
            output += "\n\n"
            if (!closing) { for (_ in 0..(Int64(name[1]) - 48)) { output += "#" }; output += " " }
        }
    }
    output = output.replace("&lt;", "<").replace("&gt;", ">").replace("&quot;", "\"")
        .replace("&#39;", "'").replace("&nbsp;", " ").replace("&amp;", "&")
    while (output.contains("\n\n\n")) { output = output.replace("\n\n\n", "\n\n") }
    return output.trimAscii()
}
