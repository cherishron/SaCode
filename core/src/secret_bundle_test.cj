package core

import std.collection.*
import std.fs.*
import std.unittest.*
import stdx.encoding.hex.*

// 迁移包加密封装的验收用例（规格 §11 断言 26–30）。
//
// 期望值来源纪律：PBKDF2 的期望 hex 不是「跑一遍自己的实现再抄回来」，而是外部对照面
//  - Node v22 `crypto.pbkdf2Sync`（底层 OpenSSL）逐条生成；
//  - 其中 P="passwd"/c=1/dkLen=64 与 P="Password"/c=80000/dkLen=64 两条与 **RFC 7914 §11
//    公布的 PBKDF2-HMAC-SHA256 向量**逐字节一致（这是公开可查的外部锚点，证明对照面本身没错）；
//  - 另三条与 docs/evidence/model-center-b0-2026-10-05.md 里「仓颉侧 × Node 侧逐字节一致」
//    的记录同值。
//
// 用例内的 ETM 回环/篡改/口令错这些语义用例走**显式密钥**的封装层（seal/openSecretBundleWithKeys），
// 因为它们要证的是信封语义，不需要 KDF 的硬度；迭代次数下限与生产档回环由
// productionIterationsFloorIsEnforcedAndRecorded 用**默认参数**单独钉住——下限只写在写包侧。

// 每个用例只准用自己独立的文件名；本文件只有 wrongPassphrase... 一条会落盘。
let sbPersistFile = "core-test-secret-bundle-persist.bin"

func sbTestHex(bytes: Array<Byte>): String {
    return toHexString(bytes)
}

func sbTestCat(a: Array<Byte>, b: Array<Byte>): Array<Byte> {
    let out = ArrayList<Byte>()
    for (x in a) {
        out.add(x)
    }
    for (x in b) {
        out.add(x)
    }
    return out.toArray()
}

func sbTestSlice(src: Array<Byte>, from: Int64, until: Int64): Array<Byte> {
    let out = ArrayList<Byte>()
    var i = from
    while (i < until) {
        out.add(src[i])
        i += 1
    }
    return out.toArray()
}

func sbTestRepeat(n: Int64, v: UInt8): Array<Byte> {
    return Array<Byte>(n, repeat: v)
}

// 只动一位：用来做「密文/IV 改一字节」的篡改夹具。
func sbTestFlip(src: Array<Byte>, index: Int64): Array<Byte> {
    let out = Array<Byte>(src.size, repeat: 0)
    var i: Int64 = 0
    while (i < src.size) {
        out[i] = src[i]
        i += 1
    }
    out[index] = out[index] ^ UInt8(1)
    return out.toArray()
}

// 在字节流里找子串：判断「落盘形态/回执里有没有口令或明文」用。
func sbTestContains(hay: Array<Byte>, needle: Array<Byte>): Bool {
    if (needle.size == 0) {
        return true
    }
    if (needle.size > hay.size) {
        return false
    }
    var i: Int64 = 0
    while (i + needle.size <= hay.size) {
        var same = true
        var j: Int64 = 0
        while (j < needle.size) {
            if (hay[i + j] != needle[j]) {
                same = false
                break
            }
            j += 1
        }
        if (same) {
            return true
        }
        i += 1
    }
    return false
}

// 头部改字段的夹具：只动指定字段，其余原样保留（用来做 AAD 绑定与未知算法标识）。
func sbTestHeader(h: SecretBundleHeader, kind!: String = "", cipher!: String = "",
                  mac!: String = "", compose!: String = "", kdf!: String = "",
                  schemaVersion!: Int64 = -1, generatedAt!: Int64 = -1,
                  iterations!: Int64 = -1, ivLen!: Int64 = -1, tagLen!: Int64 = -1): SecretBundleHeader {
    let k = if (kind.size > 0) { kind } else { h.kind }
    let c = if (cipher.size > 0) { cipher } else { h.cipher }
    let m = if (mac.size > 0) { mac } else { h.mac }
    let cp = if (compose.size > 0) { compose } else { h.compose }
    let kd = if (kdf.size > 0) { kdf } else { h.kdf }
    let sv = if (schemaVersion >= 0) { schemaVersion } else { h.schemaVersion }
    let ga = if (generatedAt >= 0) { generatedAt } else { h.generatedAt }
    let it = if (iterations >= 0) { iterations } else { h.iterations }
    let iv = if (ivLen >= 0) { ivLen } else { h.ivLen }
    let tg = if (tagLen >= 0) { tagLen } else { h.tagLen }
    return SecretBundleHeader(h.format, k, sv, ga, c, m, cp, kd, it, h.saltLen, iv, tg)
}

func sbTestCleanup(path: String): Unit {
    if (exists(path)) {
        try {
            removeIfExists(path, recursive: false)
        } catch (e: Exception) {
        }
    }
}

// 回环等价：解密结果与明文逐字节相同，且 CTR 不填充（密文长度 = 明文长度）。
func sbTestRoundTrip(encKey: Array<Byte>, macKey: Array<Byte>, payload: Array<Byte>): Bool {
    let sealed = sealSecretBundleWithKeys(encKey, macKey, payload, 1759600000, 2)
    if (sealed.ciphertext.size != payload.size) {
        return false
    }
    if (sealed.salt.size != 16 || sealed.iv.size != 16 || sealed.tag.size != 32) {
        return false
    }
    let reparsed = SecretBundle.parse(sealed.toBytes())
    if (reparsed.isNone()) {
        return false
    }
    let opened = openSecretBundleWithKeys(encKey, macKey, reparsed.getOrThrow())
    if (!opened.isOpen()) {
        return false
    }
    return sbTestHex(opened.plaintext.getOrThrow()) == sbTestHex(payload)
}

// 断言 26：PBKDF2-HMAC-SHA256 逐条命中 RFC 6070 形态向量（c=1/2/4096；dkLen=1/2/8/32/40/64，
// 含 `passwordPASSWORDpassword` 的 dkLen=40 多块用例与 `pass\0word` 的 NUL 截断用例）。
@Test
func pbkdf2Sha256MatchesRfc6070Vectors() {
    // c=1、dkLen=1：边界最小档
    @Expect(sbTestHex(pbkdf2Sha256("password".toArray(), "salt".toArray(), 1, 1)), "12")
    // c=2、dkLen=2
    @Expect(sbTestHex(pbkdf2Sha256("password".toArray(), "salt".toArray(), 2, 2)), "ae4d")
    // c=4096、dkLen=8
    @Expect(sbTestHex(pbkdf2Sha256("password".toArray(), "salt".toArray(), 4096, 8)),
        "c5e478d59288c841")
    // c=4096、dkLen=32（单块整取）
    @Expect(sbTestHex(pbkdf2Sha256("password".toArray(), "salt".toArray(), 4096, 32)),
        "c5e478d59288c841aa530db6845c4c8d962893a001ce4e11a4963873aa98134a")
    // c=1、dkLen=32
    @Expect(sbTestHex(pbkdf2Sha256("password".toArray(), "salt".toArray(), 1, 32)),
        "120fb6cffcf8b32c43e7225256c4f837a86548c92ccc35480805987cb70be17b")
    // c=4096、dkLen=40：跨多块（第二块的计数器拼接错位就会在这里现形）
    @Expect(sbTestHex(pbkdf2Sha256("passwordPASSWORDpassword".toArray(),
        "saltSALTsaltSALTsaltSALTsaltSALTsalt".toArray(), 4096, 40)),
        "348c89dbcbd32b2f32d814b8116e84cf2b17347ebc1800181c4e2a1fb8dd53e1c635518c7dac47e9")
    // c=1、dkLen=40：多块但只迭代一轮（B0 现场与 Node 逐字节对照过的那条）
    @Expect(sbTestHex(pbkdf2Sha256("passwordPASSWORDpassword".toArray(),
        "saltSALTsaltSALTsaltSALTsaltSALTsalt".toArray(), 1, 40)),
        "051e945b44155846de9d879b8c062eee1f5fc6ef37e33c8a8ee0a770d45be8da441d1113172e4b85")
    // NUL 截断用例：口令与盐里各含一个 0 字节，实现不得在 0 处截断
    let nulPw = sbTestCat(sbTestCat("pass".toArray(), [UInt8(0)]), "word".toArray())
    let nulSalt = sbTestCat(sbTestCat("sa".toArray(), [UInt8(0)]), "lt".toArray())
    @Expect(sbTestHex(pbkdf2Sha256(nulPw, nulSalt, 4096, 16)), "89b69d0516f829893c696226650a8687")
    // RFC 7914 §11 公布向量一：P="passwd"、S="salt"、c=1、dkLen=64
    @Expect(sbTestHex(pbkdf2Sha256("passwd".toArray(), "salt".toArray(), 1, 64)),
        "55ac046e56e3089fec1691c22544b605f94185216dde0465e68b9d57c20dacbc49ca9cccf179b645991664b39d77ef317c71b845b1e30bd509112041d3a19783")
    // RFC 7914 §11 公布向量二：P="Password"、S="NaCl"、c=80000、dkLen=64
    @Expect(sbTestHex(pbkdf2Sha256("Password".toArray(), "NaCl".toArray(), 80000, 64)),
        "4ddcd8f60b98be21830cee5ef22701f9641a4418d04c0414aeff08876b34ab56a1d425a1225833549adb841b51c9b3176a272bdebba1d078478f62b397f33c8d")
}

// 断言 26（补）：跨块输出必须满足前缀一致——第 2 块不能是第 1 块的重放，
// 末块截断也不能改前面已产出的字节。这条钉的是 dkLen 有多块时的拼接与截断。
@Test
func pbkdf2Sha256PrefixIsStableAcrossBlockBoundaries() {
    let pw = "password".toArray()
    let salt = "salt".toArray()
    let full = pbkdf2Sha256(pw, salt, 2, 64)
    @Expect(sbTestHex(sbTestSlice(full, 0, 32)), sbTestHex(pbkdf2Sha256(pw, salt, 2, 32)))
    @Expect(sbTestHex(sbTestSlice(full, 0, 40)), sbTestHex(pbkdf2Sha256(pw, salt, 2, 40)))
    @Expect(sbTestHex(sbTestSlice(full, 0, 63)), sbTestHex(pbkdf2Sha256(pw, salt, 2, 63)))
    let full3 = pbkdf2Sha256(pw, salt, 2, 96)
    @Expect(sbTestHex(sbTestSlice(full3, 0, 64)), sbTestHex(full))
    // 第 2 块不是第 1 块的复制
    @Expect(sbTestHex(sbTestSlice(full, 32, 64)) == sbTestHex(sbTestSlice(full, 0, 32)), false)
}

// 断言 27（回环半）：ETM 封装回环等价；SM4-CTR 不填充（密文长度 = 明文长度）；
// 盐与 IV 来自 SecureRandom（两次封包的随机材料必须不同，计数器/时钟凑不出来）。
@Test
func etmSealOpenRoundTripsByteEquivalently() {
    let encKey = sbTestRepeat(16, 7)
    let macKey = sbTestRepeat(32, 9)
    // 非块对齐、空串、UTF-8 中文、较长正文各一条
    @Expect(sbTestRoundTrip(encKey, macKey, Array<Byte>(0, repeat: 0)), true)
    @Expect(sbTestRoundTrip(encKey, macKey, "0123456789012345678901234567890".toArray()), true)
    @Expect(sbTestRoundTrip(encKey, macKey, "sk-上游密钥-abc-123".toArray()), true)
    @Expect(sbTestRoundTrip(encKey, macKey, sbTestRepeat(300, 65)), true)
    // 随机材料：同一明文、同一密钥、同一时刻连封两次，盐/IV/密文都不得相同
    let a = sealSecretBundleWithKeys(encKey, macKey, "同一段明文".toArray(), 1759600000, 2)
    let b = sealSecretBundleWithKeys(encKey, macKey, "同一段明文".toArray(), 1759600000, 2)
    @Expect(sbTestHex(a.salt) == sbTestHex(b.salt), false)
    @Expect(sbTestHex(a.iv) == sbTestHex(b.iv), false)
    @Expect(sbTestHex(a.ciphertext) == sbTestHex(b.ciphertext), false)
    // 两次都能开到同一段明文
    @Expect(sbTestHex(openSecretBundleWithKeys(encKey, macKey, a).plaintext.getOrThrow()),
        sbTestHex(openSecretBundleWithKeys(encKey, macKey, b).plaintext.getOrThrow()))
}

// 断言 27（拒绝半）：密文、IV、信封头各改一处 → 整条拒绝，且**不产出明文**。
// 三处的失败码与人话必须完全一致：分开报就等于告诉攻击者「哪一半错了」。
@Test
func tamperedCiphertextIvOrHeaderIsRejectedWithoutPlaintext() {
    let encKey = sbTestRepeat(16, 7)
    let macKey = sbTestRepeat(32, 9)
    let payload = "sk-凭证值-不应泄露-4f2c".toArray()
    let sealed = sealSecretBundleWithKeys(encKey, macKey, payload, 1759600000, 2)
    // 对照组：原封不动必须能开
    @Expect(openSecretBundleWithKeys(encKey, macKey, sealed).isOpen(), true)
    // 密文改一字节
    let badCt = SecretBundle(sealed.header, sealed.salt, sealed.iv,
        sbTestFlip(sealed.ciphertext, 0), sealed.tag)
    let rCt = openSecretBundleWithKeys(encKey, macKey, badCt)
    // IV 改一字节
    let badIv = SecretBundle(sealed.header, sealed.salt, sbTestFlip(sealed.iv, 15),
        sealed.ciphertext, sealed.tag)
    let rIv = openSecretBundleWithKeys(encKey, macKey, badIv)
    // 信封头改一个字段（generatedAt 加一秒），标签原样保留
    let badHdr = SecretBundle(sbTestHeader(sealed.header, generatedAt: 1759600001), sealed.salt,
        sealed.iv, sealed.ciphertext, sealed.tag)
    let rHdr = openSecretBundleWithKeys(encKey, macKey, badHdr)
    // 三条都必须失败
    @Expect(rCt.isOpen(), false)
    @Expect(rIv.isOpen(), false)
    @Expect(rHdr.isOpen(), false)
    // 失败一律不回吐任何部分明文
    @Expect(rCt.plaintext.isNone(), true)
    @Expect(rIv.plaintext.isNone(), true)
    @Expect(rHdr.plaintext.isNone(), true)
    // 拒绝码同族，且人话逐字相同——不按位置给预言机
    @Expect(rCt.code, SECRET_BUNDLE_UNOPENABLE)
    @Expect(rIv.code, SECRET_BUNDLE_UNOPENABLE)
    @Expect(rHdr.code, SECRET_BUNDLE_UNOPENABLE)
    @Expect(rCt.detail, SECRET_BUNDLE_UNOPENABLE_DETAIL)
    @Expect(rIv.detail, rCt.detail)
    @Expect(rHdr.detail, rCt.detail)
    // 回执里不许夹带明文片段
    @Expect(sbTestContains(rCt.detail.toArray(), "sk-凭证值".toArray()), false)
    @Expect(sbTestContains(rIv.detail.toArray(), "不应泄露".toArray()), false)
}

// 断言 28：AAD 绑头部——把头里 kind 从 `secret-bundle` 改成 `config` 后解密失败。
@Test
func headerKindSwapToConfigIsRejected() {
    let encKey = sbTestRepeat(16, 3)
    let macKey = sbTestRepeat(32, 5)
    let payload = "sk-换机迁移凭证".toArray()
    let sealed = sealSecretBundleWithKeys(encKey, macKey, payload, 1759600000, 2,
        kind: SECRET_BUNDLE_KIND_SECRET)
    @Expect(sealed.header.kind, SECRET_BUNDLE_KIND_SECRET)
    @Expect(openSecretBundleWithKeys(encKey, macKey, sealed).isOpen(), true)
    // 只把 kind 换成 config，盐/IV/密文/标签全部原样
    let forged = SecretBundle(sbTestHeader(sealed.header, kind: SECRET_BUNDLE_KIND_CONFIG),
        sealed.salt, sealed.iv, sealed.ciphertext, sealed.tag)
    let res = openSecretBundleWithKeys(encKey, macKey, forged)
    @Expect(res.isOpen(), false)
    @Expect(res.code, SECRET_BUNDLE_UNOPENABLE)
    @Expect(res.plaintext.isNone(), true)
    // 字节形态同样拒（走 parse → open 的完整通路）
    let resBytes = openSecretBundleWithKeys(encKey, macKey, SecretBundle.parse(forged.toBytes()).getOrThrow())
    @Expect(resBytes.isOpen(), false)
    // 对照：kind 没被改的那份，串成字节后照样能开
    @Expect(openSecretBundleWithKeys(encKey, macKey,
        SecretBundle.parse(sealed.toBytes()).getOrThrow()).isOpen(), true)
}

// 断言 29：错误口令只报「口令不对/解不开」，不回吐任何部分明文，也不落口令。
// 走**口令路径**并且用默认迭代数（600k），顺带把生产档的封包/解包跑通一次。
@Test
func wrongPassphraseIsRejectedWithoutPlaintextOrEcho() {
    let payload = "sk-migrate-sentinel-9f3a-上游密钥".toArray()
    let right = "迁移口令-正确-7Kx"
    let wrong = "迁移口令-错误-7Kx"
    let sealed = sealSecretBundle(right, payload, 1759600000)
    let env = sealed.toBytes()
    // 正确口令能开（对照组）
    let good = openSecretBundle(right, env)
    @Expect(good.isOpen(), true)
    @Expect(sbTestHex(good.plaintext.getOrThrow()), sbTestHex(payload))
    // 错误口令：失败、无明文、只报同一句话。这条走的就是 MAC 校验不通过那一支，
    // 回执里的那一句与篡改包失败时逐字相同（篡改三类同码同话已在
    // tamperedCiphertextIvOrHeaderIsRejectedWithoutPlaintext 里逐类证过，
    // 这里不再为一句话多烧一轮 600k）。
    let bad = openSecretBundle(wrong, env)
    @Expect(bad.isOpen(), false)
    @Expect(bad.plaintext.isNone(), true)
    @Expect(bad.code, SECRET_BUNDLE_UNOPENABLE)
    @Expect(bad.detail, SECRET_BUNDLE_UNOPENABLE_DETAIL)
    // 口令不落盘、不进回执、不进读面摘要：先扫内存里的落盘形态与回执
    @Expect(sbTestContains(env, right.toArray()), false)
    @Expect(sbTestContains(env, wrong.toArray()), false)
    @Expect(sbTestContains(env, "sk-migrate-sentinel".toArray()), false)
    @Expect(sbTestContains(bad.detail.toArray(), right.toArray()), false)
    @Expect(sbTestContains(sealed.safeSummary().toArray(), right.toArray()), false)
    @Expect(sbTestContains(sealed.safeSummary().toArray(), "sk-migrate-sentinel".toArray()), false)
    // 再扫一遍真正落盘的那份字节（本用例独占一个文件名）
    sbTestCleanup(sbPersistFile)
    File.writeTo(sbPersistFile, env)
    let onDisk = File.readFrom(sbPersistFile)
    @Expect(sbTestContains(onDisk, right.toArray()), false)
    @Expect(sbTestContains(onDisk, wrong.toArray()), false)
    @Expect(sbTestContains(onDisk, "sk-migrate-sentinel".toArray()), false)
    // 失败路径不得留下任何残留文件
    sbTestCleanup(sbPersistFile)
    @Expect(exists(sbPersistFile), false)
}

// 断言 30：信封头自描述（cipher/kdf/迭代数/各长度逐字段可回读），未知算法标识直接拒。
// 拒绝必须发生在任何密码学动作**之前**：传一个错误口令去开「cipher=AES-256-GCM」的包，
// 若实现先派生再校验，回的就是「解不开」；回到「标识不认识」才证明预检在派生之前。
@Test
func headerIsSelfDescribingAndUnknownAlgorithmsAreRejected() {
    let encKey = sbTestRepeat(16, 3)
    let macKey = sbTestRepeat(32, 5)
    let payload = "sk-算法敏捷性夹具".toArray()
    let sealed = sealSecretBundleWithKeys(encKey, macKey, payload, 1759600000,
        SECRET_BUNDLE_MIN_ITERATIONS)
    let h = sealed.header
    // 自描述：头部逐字段写明算法与长度，不靠实现里的记忆
    @Expect(h.format, "sacode-migrate/1")
    @Expect(h.kind, "secret-bundle")
    @Expect(h.cipher, "SM4-CTR")
    @Expect(h.mac, "HMAC-SHA256")
    @Expect(h.compose, "ETM")
    @Expect(h.kdf, "PBKDF2-HMAC-SHA256")
    @Expect(h.schemaVersion, 1)
    @Expect(h.iterations, SECRET_BUNDLE_MIN_ITERATIONS)
    @Expect(h.saltLen, 16)
    @Expect(h.ivLen, 16)
    @Expect(h.tagLen, 32)
    @Expect((String.fromUtf8(h.toBytes()).indexOf("cipher=SM4-CTR") ?? Int64(-1)) >= 0, true)
    // 头部字节可重新解析且逐字段等值
    let reparsed = SecretBundleHeader.parse(h.toBytes())
    @Expect(reparsed.isNone(), false)
    @Expect(reparsed.getOrThrow().safeSummary(), h.safeSummary())
    // 未知算法标识逐个拒；口令故意给错的，用来证明「拒绝早于派生与 MAC」
    let asAes = sbTestHeader(h, cipher: "AES-256-GCM")
    let rAes = openSecretBundle("随便一个口令", SecretBundle(asAes, sealed.salt, sealed.iv,
        sealed.ciphertext, sealed.tag).toBytes())
    @Expect(rAes.isOpen(), false)
    @Expect(rAes.code, SECRET_BUNDLE_UNKNOWN_ALGORITHM)
    @Expect(rAes.plaintext.isNone(), true)
    let rGcm = openSecretBundle("随便一个口令", SecretBundle(sbTestHeader(h, compose: "GCM"),
        sealed.salt, sealed.iv, sealed.ciphertext, sealed.tag).toBytes())
    @Expect(rGcm.code, SECRET_BUNDLE_UNKNOWN_ALGORITHM)
    let rScrypt = openSecretBundle("随便一个口令", SecretBundle(sbTestHeader(h, kdf: "scrypt"),
        sealed.salt, sealed.iv, sealed.ciphertext, sealed.tag).toBytes())
    @Expect(rScrypt.code, SECRET_BUNDLE_UNKNOWN_ALGORITHM)
    let rMd5 = openSecretBundle("随便一个口令", SecretBundle(sbTestHeader(h, mac: "HMAC-MD5"),
        sealed.salt, sealed.iv, sealed.ciphertext, sealed.tag).toBytes())
    @Expect(rMd5.code, SECRET_BUNDLE_UNKNOWN_ALGORITHM)
    let rV2 = openSecretBundle("随便一个口令", SecretBundle(sbTestHeader(h, schemaVersion: 2),
        sealed.salt, sealed.iv, sealed.ciphertext, sealed.tag).toBytes())
    @Expect(rV2.code, SECRET_BUNDLE_UNKNOWN_ALGORITHM)
    // 长度参数与当前算法不符：算畸形，不算未知算法
    let rIv = openSecretBundle("随便一个口令", SecretBundle(sbTestHeader(h, ivLen: 12),
        sealed.salt, sealed.iv, sealed.ciphertext, sealed.tag).toBytes())
    @Expect(rIv.code, SECRET_BUNDLE_MALFORMED)
    // 对照：标识齐全的那份用同样（错）口令去开，回的是「解不开」——两句话不能混。
    // 这里另封一条低迭代数的包，只为把「认证失败」这一档跑出来，不必再烧一遍 600k。
    let cheap = sealSecretBundleWithKeys(encKey, macKey, payload, 1759600000, 2)
    let rOk = openSecretBundle("随便一个口令", cheap.toBytes())
    @Expect(rOk.code, SECRET_BUNDLE_UNOPENABLE)
}

// 断言 26/30 的生产侧：默认档就是 ≥600k，且低于下限一律拒（不给「先导出来再说」留通路）。
@Test
func productionIterationsFloorIsEnforcedAndRecorded() {
    let payload = "sk-production-floor-check".toArray()
    let sealed = sealSecretBundle("生产口令-1", payload, 1759600000)
    @Expect(sealed.header.iterations, SECRET_BUNDLE_MIN_ITERATIONS)
    @Expect(sealed.header.iterations >= 600000, true)
    @Expect(sealed.header.kind, "secret-bundle")
    @Expect((sealed.safeSummary().indexOf("600000") ?? Int64(-1)) >= 0, true)
    // 生产档回环：默认参数封的包，用同一口令能逐字节开回来
    let opened = openSecretBundle("生产口令-1", sealed.toBytes())
    @Expect(opened.isOpen(), true)
    @Expect(sbTestHex(opened.plaintext.getOrThrow()), sbTestHex(payload))
    // 迭代数写死为 1 或低于下限：写包侧直接拒
    var weak = ""
    try {
        sealSecretBundle("生产口令-1", payload, 1759600000, iterations: 1)
    } catch (e: Exception) {
        weak = e.message
    }
    @Expect(weak, SECRET_BUNDLE_WEAK_KDF)
    var weakEdge = ""
    try {
        sealSecretBundle("生产口令-1", payload, 1759600000, iterations: SECRET_BUNDLE_MIN_ITERATIONS - 1)
    } catch (e: Exception) {
        weakEdge = e.message
    }
    @Expect(weakEdge, SECRET_BUNDLE_WEAK_KDF)
    // 下限本身不被误拒：默认参数就是 MIN，上面那次默认封包成功即已证明「== MIN 放行」，
    // 不另跑一次 600k 的冗余封包
    @Expect(SECRET_BUNDLE_MIN_ITERATIONS, 600000)
}

// 断言 27 的机制面：MAC 比较必须逐字节异或累积、不提前返回。
// 这条性质只能靠「比较步数与差异出现的位置无关」来防回归，所以比较函数把步数读出来。
@Test
func macComparisonIsIndependentOfDifferencePosition() {
    let base = sbTestRepeat(32, 0)
    var i: Int64 = 0
    while (i < base.size) {
        base[i] = UInt8(17 + i)
        i += 1
    }
    let same = sbTestCopy(base)
    let cSame = secretBundleConstTimeEquals(base, same)
    @Expect(cSame.equal, true)
    @Expect(cSame.comparedBytes, 32)
    // 第一个字节就不同
    let early = sbTestFlip(base, 0)
    let cEarly = secretBundleConstTimeEquals(base, early)
    @Expect(cEarly.equal, false)
    // 最后一个字节才不同
    let late = sbTestFlip(base, 31)
    let cLate = secretBundleConstTimeEquals(base, late)
    @Expect(cLate.equal, false)
    // 关键读数：两种位置的比较步数相同，且都等于全长——提前返回会让这两个数不等
    @Expect(cEarly.comparedBytes, cLate.comparedBytes)
    @Expect(cEarly.comparedBytes, 32)
    @Expect(cLate.comparedBytes, 32)
    // 长度不同：整体判不等，但也不因为长度先返回（比完公共前缀）
    let short = sbTestSlice(base, 0, 31)
    let cShort = secretBundleConstTimeEquals(base, short)
    @Expect(cShort.equal, false)
    @Expect(cShort.comparedBytes, 31)
}

// 比较用的副本：不改原数组（Array 是引用类型，直接传同一个对象测不出东西）。
func sbTestCopy(src: Array<Byte>): Array<Byte> {
    let out = Array<Byte>(src.size, repeat: 0)
    var i: Int64 = 0
    while (i < src.size) {
        out[i] = src[i]
        i += 1
    }
    return out.toArray()
}

// 断言 26 的子密钥分离：同一 (口令, 盐) 两次派生必须走不同的上下文串，
// 一把密钥同时做加密与 MAC 是已知误用面。
@Test
func encryptionAndMacSubkeysAreDomainSeparated() {
    let pw = "口令-domain-sep".toArray()
    let salt = sbTestRepeat(16, 7)
    let keys = deriveSecretBundleKeys(pw, salt, 2)
    // 长度：SM4 密钥 16 字节、HMAC 密钥 32 字节
    @Expect(keys.encKey.size, 16)
    @Expect(keys.macKey.size, 32)
    // 两把密钥不得相同（哪怕只比前 16 字节）
    @Expect(sbTestHex(keys.encKey) == sbTestHex(sbTestSlice(keys.macKey, 0, 16)), false)
    // 上下文串确实进了派生输入：去掉它得到的完全是另一个值
    @Expect(sbTestHex(keys.encKey) == sbTestHex(pbkdf2Sha256(pw, salt, 2, 16)), false)
    @Expect(sbTestHex(keys.macKey) == sbTestHex(pbkdf2Sha256(pw, salt, 2, 32)), false)
    // 确定性：同一输入两次派生同值（不是随机凑的）
    let again = deriveSecretBundleKeys(pw, salt, 2)
    @Expect(sbTestHex(again.encKey), sbTestHex(keys.encKey))
    @Expect(sbTestHex(again.macKey), sbTestHex(keys.macKey))
}
