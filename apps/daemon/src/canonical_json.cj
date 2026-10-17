package daemon
import core.*

import std.collection.*
import stdx.encoding.json.*

// 幂等账的「规范化内容」真源：把 JSON 值压成一串带类型标签与字节长度前缀的帧，
// 再取 sha256。为什么不能直接把 params 原文拿去摘要——
//   1) 客户端只是换了字段顺序就会算出另一个摘要，同键同内容被误判成「同键不同内容」而拒；
//   2) 数字 1 与 1.0 在 JSON 里是同一个数，序列化形态不同不该是两个意图。
// 长度前缀分帧保证边界无歧义：("a","b|c") 这类拼串伪造会得到不同的帧序列。
// 排序只靠 add 与下标读，不用 ArrayList.insert——本机 cjc 未确证过那个成员名。

public func canonicalDigest(node: JsonValue): String {
    let out = ArrayList<Byte>()
    canonicalBytes(node, out)
    return sha256Hex(out.toArray())
}

func putRaw(out: ArrayList<Byte>, s: String): Unit {
    for (b in s.toArray()) { out.add(b) }
}

// 先写十进制字节数再写正文：正文含冒号、零字节或换行都不会移动边界。
func putFramed(out: ArrayList<Byte>, s: String): Unit {
    putRaw(out, "${s.toArray().size}:")
    putRaw(out, s)
}

func canonicalBytes(node: JsonValue, out: ArrayList<Byte>): Unit {
    if (let JsonKind.JsObject <- node.kind()) {
        putRaw(out, "o")
        let names = ArrayList<String>()
        let vals = HashMap<String, JsonValue>()
        for ((key, field) in node.asObject().getFields()) {
            names.add(key)
            vals.add(key, field)
        }
        for (name in sortedUnique(names)) {
            putFramed(out, name)
            canonicalBytes(vals.get(name).getOrThrow(), out)
        }
        return
    }
    if (let JsonKind.JsArray <- node.kind()) {
        putRaw(out, "a")
        let arr = node.asArray()
        var index = Int64(0)
        while (let Some(item) <- arr.get(index)) {
            canonicalBytes(item, out)
            index += 1
        }
        return
    }
    if (let JsonKind.JsString <- node.kind()) {
        putRaw(out, "s")
        putFramed(out, node.asString().getValue())
        return
    }
    if (let JsonKind.JsInt <- node.kind()) {
        putRaw(out, "n")
        putFramed(out, node.asInt().getValue().toString())
        return
    }
    if (let JsonKind.JsFloat <- node.kind()) {
        putRaw(out, "n")
        putFramed(out, floatText(node.asFloat().getValue()))
        return
    }
    if (let JsonKind.JsBool <- node.kind()) {
        putRaw(out, if (node.asBool().getValue()) { "t" } else { "f" })
        return
    }
    putRaw(out, "z")
}

// 整值浮点按十进制整数出帧，和 JsInt 落到同一份内容上；
// 超出 Int64 安全范围的大值不走这条捷径（转换溢出会把两个不同的数并成一个）。
func floatText(f: Float64): String {
    if (f > -9.223372036854776e18 && f < 9.223372036854776e18) {
        let i = Int64(f)
        if (Float64(i) == f) { return i.toString() }
    }
    return f.toString()
}

// 同一层重复键只留一份（后写的值生效，与 JsonObject 的 get 语义一致）。
func sortedUnique(src: ArrayList<String>): ArrayList<String> {
    let out = ArrayList<String>()
    var pool = ArrayList<String>()
    for (s in src) { pool.add(s) }
    while (Int64(pool.size) > 0) {
        var best: Int64 = 0
        var i: Int64 = 1
        while (i < Int64(pool.size)) {
            if (pool[i] < pool[best]) { best = i }
            i += 1
        }
        let chosen = pool[best]
        out.add(chosen)
        let rest = ArrayList<String>()
        for (s in pool) { if (s != chosen) { rest.add(s) } }
        pool = rest
    }
    return out
}
