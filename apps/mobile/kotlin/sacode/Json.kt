// 移动客户端接入逻辑层的最小 JSON 值模型：只解析这一层真正需要的形状。
// 数字按「整数→Long、其余→Double」分，因为 JSON-RPC 的 id 与 error.code 要精确比较。
//
// 为什么不用现成库：本机没有 gradle，也就没有依赖解析通道；这一层将来落进 Kuikly
// 工程时同样只依赖 stdlib + JDK，两个入口的依赖面保持一致。
package sacode

object Json {
    fun parse(text: String): Any? {
        val p = Parser(text)
        p.skipWs()
        val v = p.value()
        p.skipWs()
        if (!p.atEnd()) throw IllegalArgumentException("trailing-json-at-${p.index}")
        return v
    }

    @Suppress("UNCHECKED_CAST")
    fun obj(v: Any?): Map<String, Any?> =
        v as? Map<String, Any?> ?: throw IllegalArgumentException("value-is-not-object")

    @Suppress("UNCHECKED_CAST")
    fun arr(v: Any?): List<Any?> = v as? List<Any?> ?: throw IllegalArgumentException("value-is-not-array")

    fun str(v: Any?, field: String): String {
        if (v !is String) throw IllegalArgumentException("field-not-string:$field")
        return v
    }

    fun stringify(v: Any?): String = when (v) {
        null -> "null"
        is String -> quote(v)
        is Boolean -> v.toString()
        is Long -> v.toString()
        is Int -> v.toString()
        is Double -> v.toString()
        is Map<*, *> -> v.entries.joinToString(",", "{", "}") { (k, e) -> quote(k.toString()) + ":" + stringify(e) }
        is List<*> -> v.joinToString(",", "[", "]") { stringify(it) }
        else -> throw IllegalArgumentException("unstringifiable:${v.javaClass.simpleName}")
    }

    private fun quote(s: String): String {
        val sb = StringBuilder("\"")
        for (c in s) {
            when (c) {
                '"' -> sb.append("\\\"")
                '\\' -> sb.append("\\\\")
                '\n' -> sb.append("\\n")
                '\r' -> sb.append("\\r")
                '\t' -> sb.append("\\t")
                else -> if (c < ' ') sb.append("\\u%04x".format(c.code)) else sb.append(c)
            }
        }
        return sb.append("\"").toString()
    }

    private class Parser(val text: String) {
        var index = 0
        fun atEnd(): Boolean = index >= text.length
        fun skipWs() { while (index < text.length && text[index].isWhitespace()) index += 1 }

        fun value(): Any? {
            if (atEnd()) throw IllegalArgumentException("json-ended")
            val c = text[index]
            return when {
                c == '{' -> objectValue()
                c == '[' -> arrayValue()
                c == '"' -> stringValue()
                c == 't' -> literal("true", true)
                c == 'f' -> literal("false", false)
                c == 'n' -> literal("null", null)
                else -> numberValue()
            }
        }

        private fun literal(word: String, v: Any?): Any? {
            if (!text.startsWith(word, index)) throw IllegalArgumentException("json-bad-literal")
            index += word.length
            return v
        }

        private fun numberValue(): Any? {
            val start = index
            if (index < text.length && (text[index] == '-' || text[index] == '+')) index += 1
            var isFloat = false
            while (index < text.length) {
                val c = text[index]
                if (c.isDigit()) { index += 1; continue }
                if (c == '.' || c == 'e' || c == 'E' || c == '-' || c == '+') { if (c == '.') isFloat = true; index += 1; continue }
                break
            }
            val raw = text.substring(start, index)
            if (raw.isEmpty()) throw IllegalArgumentException("json-bad-number")
            return if (isFloat) raw.toDouble() else raw.toLongOrNull() ?: raw.toDouble()
        }

        private fun objectValue(): Map<String, Any?> {
            val out = LinkedHashMap<String, Any?>()
            index += 1
            skipWs()
            if (peek('}')) { index += 1; return out }
            while (true) {
                skipWs()
                val k = stringValue()
                skipWs()
                if (!peek(':')) throw IllegalArgumentException("json-expected-colon")
                index += 1
                out[k] = value()
                skipWs()
                if (peek(',')) { index += 1; continue }
                if (peek('}')) { index += 1; return out }
                throw IllegalArgumentException("json-expected-comma-or-brace")
            }
        }

        private fun arrayValue(): List<Any?> {
            val out = ArrayList<Any?>()
            index += 1
            skipWs()
            if (peek(']')) { index += 1; return out }
            while (true) {
                out.add(value())
                skipWs()
                if (peek(',')) { index += 1; continue }
                if (peek(']')) { index += 1; return out }
                throw IllegalArgumentException("json-expected-comma-or-bracket")
            }
        }

        private fun peek(c: Char): Boolean = index < text.length && text[index] == c

        private fun stringValue(): String {
            if (!peek('"')) throw IllegalArgumentException("json-expected-quote")
            index += 1
            val sb = StringBuilder()
            while (true) {
                if (atEnd()) throw IllegalArgumentException("json-unterminated-string")
                val c = text[index]
                if (c == '"') { index += 1; return sb.toString() }
                if (c == '\\') {
                    index += 1
                    val e = text[index]
                    sb.append(
                        when (e) {
                            'n' -> '\n'
                            't' -> '\t'
                            'r' -> '\r'
                            'b' -> '\b'
                            '"' -> '"'
                            '\\' -> '\\'
                            '/' -> '/'
                            'u' -> {
                                val hex = text.substring(index + 1, index + 5)
                                index += 4
                                hex.toInt(16).toChar()
                            }
                            else -> throw IllegalArgumentException("json-bad-escape-$e")
                        }
                    )
                    index += 1
                    continue
                }
                sb.append(c)
                index += 1
            }
        }
    }
}
