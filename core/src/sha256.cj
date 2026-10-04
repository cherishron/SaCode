package core
import std.collection.*
import std.overflow.*

// 内容寻址用的 SHA-256 纯实现。
//
// 为什么不用现成的库：本机唯一的摘要实现是 `stdx.crypto.digest`，它底层绑
// OpenSSL 3 动态库，而 stdx 发行包内并不带 libssl/libcrypto——接进核心等于让
// 没装 OpenSSL 的机器连附件都存不了。附件引用要的是内容寻址与完整性复核，
// 不是保密原语，所以这里自带一份，并用外部实现算出的定长向量钉住
// （见 sha256_test.cj：长度 0/3/55/56/63/64/65/127/128/129/1000，
// 覆盖 padding 的每个分支与多块主循环）。
//
// 所有加法都走 `wrappingAdd`：SHA-256 的 32 位加法本就必须回绕，写出来而不是
// 依赖编译器的默认溢出档位。
//
// K 与 H0 是 FIPS 180-4 的常量表（第 t 个素数立方根小数部分的前 32 位）。
// 手抄错过 9 个，是向量用例钉出来的——改这张表必须跑 sha256_test.cj。
let SHA256_K = [
    UInt32(0x428a2f98), UInt32(0x71374491), UInt32(0xb5c0fbcf), UInt32(0xe9b5dba5),
    UInt32(0x3956c25b), UInt32(0x59f111f1), UInt32(0x923f82a4), UInt32(0xab1c5ed5),
    UInt32(0xd807aa98), UInt32(0x12835b01), UInt32(0x243185be), UInt32(0x550c7dc3),
    UInt32(0x72be5d74), UInt32(0x80deb1fe), UInt32(0x9bdc06a7), UInt32(0xc19bf174),
    UInt32(0xe49b69c1), UInt32(0xefbe4786), UInt32(0x0fc19dc6), UInt32(0x240ca1cc),
    UInt32(0x2de92c6f), UInt32(0x4a7484aa), UInt32(0x5cb0a9dc), UInt32(0x76f988da),
    UInt32(0x983e5152), UInt32(0xa831c66d), UInt32(0xb00327c8), UInt32(0xbf597fc7),
    UInt32(0xc6e00bf3), UInt32(0xd5a79147), UInt32(0x06ca6351), UInt32(0x14292967),
    UInt32(0x27b70a85), UInt32(0x2e1b2138), UInt32(0x4d2c6dfc), UInt32(0x53380d13),
    UInt32(0x650a7354), UInt32(0x766a0abb), UInt32(0x81c2c92e), UInt32(0x92722c85),
    UInt32(0xa2bfe8a1), UInt32(0xa81a664b), UInt32(0xc24b8b70), UInt32(0xc76c51a3),
    UInt32(0xd192e819), UInt32(0xd6990624), UInt32(0xf40e3585), UInt32(0x106aa070),
    UInt32(0x19a4c116), UInt32(0x1e376c08), UInt32(0x2748774c), UInt32(0x34b0bcb5),
    UInt32(0x391c0cb3), UInt32(0x4ed8aa4a), UInt32(0x5b9cca4f), UInt32(0x682e6ff3),
    UInt32(0x748f82ee), UInt32(0x78a5636f), UInt32(0x84c87814), UInt32(0x8cc70208),
    UInt32(0x90befffa), UInt32(0xa4506ceb), UInt32(0xbef9a3f7), UInt32(0xc67178f2)
]

let SHA256_H0 = [
    UInt32(0x6a09e667), UInt32(0xbb67ae85), UInt32(0x3c6ef372), UInt32(0xa54ff53a),
    UInt32(0x510e527f), UInt32(0x9b05688c), UInt32(0x1f83d9ab), UInt32(0x5be0cd19)
]

func rotr32(x: UInt32, n: Int64): UInt32 {
    return (x >> n) | (x << (32 - n))
}

func ch32(x: UInt32, y: UInt32, z: UInt32): UInt32 {
    return (x & y) ^ ((x ^ UInt32(0xffffffff)) & z)
}

func maj32(x: UInt32, y: UInt32, z: UInt32): UInt32 {
    return (x & y) ^ (x & z) ^ (y & z)
}

func bigSigma0(x: UInt32): UInt32 {
    return rotr32(x, 2) ^ rotr32(x, 13) ^ rotr32(x, 22)
}

func bigSigma1(x: UInt32): UInt32 {
    return rotr32(x, 6) ^ rotr32(x, 11) ^ rotr32(x, 25)
}

func smallSigma0(x: UInt32): UInt32 {
    return rotr32(x, 7) ^ rotr32(x, 18) ^ (x >> 3)
}

func smallSigma1(x: UInt32): UInt32 {
    return rotr32(x, 17) ^ rotr32(x, 19) ^ (x >> 10)
}

// 补位：0x80 后填零到「长度为 56 mod 64」，尾 8 字节是消息比特数的 64 位大端。
func sha256Pad(data: Array<Byte>): ArrayList<Byte> {
    let out = ArrayList<Byte>()
    for (b in data) {
        out.add(b)
    }
    let bitLen = UInt64(data.size) * UInt64(8)
    out.add(UInt8(0x80))
    while (Int64(out.size) % 64 != 56) {
        out.add(UInt8(0))
    }
    var shift = UInt64(56)
    while (true) {
        out.add(UInt8((bitLen >> shift) & UInt64(0xff)))
        if (shift == UInt64(0)) { break }
        shift -= UInt64(8)
    }
    return out
}

public func sha256Digest(data: Array<Byte>): Array<Byte> {
    let msg = sha256Pad(data)
    let h = ArrayList<UInt32>()
    for (v in SHA256_H0) {
        h.add(v)
    }
    let w = Array<UInt32>(64, repeat: UInt32(0))
    var block = Int64(0)
    while (block < Int64(msg.size)) {
        for (t in 0..16) {
            let base = block + t * 4
            w[t] = (UInt32(msg[base]) << 24) | (UInt32(msg[base + 1]) << 16)
                | (UInt32(msg[base + 2]) << 8) | UInt32(msg[base + 3])
        }
        for (t in 16..64) {
            w[t] = smallSigma1(w[t - 2]).wrappingAdd(w[t - 7])
                .wrappingAdd(smallSigma0(w[t - 15])).wrappingAdd(w[t - 16])
        }
        var a = h[0]
        var b = h[1]
        var c = h[2]
        var d = h[3]
        var e = h[4]
        var f = h[5]
        var g = h[6]
        var k = h[7]
        for (t in 0..64) {
            let t1 = k.wrappingAdd(bigSigma1(e)).wrappingAdd(ch32(e, f, g))
                .wrappingAdd(SHA256_K[t]).wrappingAdd(w[t])
            let t2 = bigSigma0(a).wrappingAdd(maj32(a, b, c))
            k = g
            g = f
            f = e
            e = d.wrappingAdd(t1)
            d = c
            c = b
            b = a
            a = t1.wrappingAdd(t2)
        }
        h[0] = h[0].wrappingAdd(a)
        h[1] = h[1].wrappingAdd(b)
        h[2] = h[2].wrappingAdd(c)
        h[3] = h[3].wrappingAdd(d)
        h[4] = h[4].wrappingAdd(e)
        h[5] = h[5].wrappingAdd(f)
        h[6] = h[6].wrappingAdd(g)
        h[7] = h[7].wrappingAdd(k)
        block += 64
    }
    let out = ArrayList<Byte>()
    for (word in h) {
        out.add(UInt8((word >> 24) & UInt32(255)))
        out.add(UInt8((word >> 16) & UInt32(255)))
        out.add(UInt8((word >> 8) & UInt32(255)))
        out.add(UInt8(word & UInt32(255)))
    }
    return out.toArray()
}

public func sha256Hex(data: Array<Byte>): String {
    let hex = "0123456789abcdef".toArray()
    let out = ArrayList<Byte>()
    for (b in sha256Digest(data)) {
        let n = Int64(b)
        out.add(hex[n / 16])
        out.add(hex[n % 16])
    }
    return String.fromUtf8(out.toArray())
}
