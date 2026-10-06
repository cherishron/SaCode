package core

import std.collection.*
import stdx.crypto.crypto.*
import stdx.crypto.digest.*

// 迁移包 `secret-bundle` 的加密封装（规格 §8.2、§8.5；验收断言 26–30）。
//
// 为什么是这个构造、而不是「更体面」的那个——由实测决定，不由偏好决定。本栈
// （Cangjie 1.1.3 + stdx 1.1.3.1）的现场记录在 docs/evidence/model-center-b0-2026-10-05.md：
// 唯一可用的分组密码是 SM4，可用模式只有 CBC/CTR，GCM 四种参数组合在运行期一律失败
// （libcrypto 里 SM4-GCM 在算法表里，是 stdx 的调用路径拿不到 tag）。所以一律用
// 「已 vetted 的原语组合」补齐认证加密：
//
//   保密   SM4-CTR（16 字节 IV，实测密文长度 = 明文长度，不做额外填充）
//   认证   HMAC-SHA256 覆盖 `信封头 ‖ IV ‖ 密文`，encrypt-then-MAC，标签 32 字节随包存
//   派生   自建 PBKDF2-HMAC-SHA256，只构建在 stdx 的 HMAC(key, SHA256) 之上
//   子密钥 同一 (口令, 盐) 跑两次派生，上下文串不同：`sacode-migrate/1|enc` 出 16 字节
//          SM4 密钥、`sacode-migrate/1|mac` 出 32 字节 HMAC 密钥——一把密钥两用是已知误用面
//   随机   salt 与 IV 全部来自 SecureRandom.nextBytes，不用时钟或计数器凑
//
// 安全强度如实写明是 **128 位**（SM4 分组与密钥各 128 位 + HMAC-SHA256 标签 256 位），
// 不是 AES-256：全栈 0 处 AES，这里也不假装有。
//
// 校验顺序是硬约束，不是实现细节：解包必须先做算法预检 → 再算 MAC → 定长时间比较
// （逐字节异或累积、不提前返回）→ 通过后才派生解密密钥、才构造分组密码。本模块
// **结构上不提供**「跳过校验继续导入」的开关（没有 skipVerify / allowTampered /
// best-effort 一类参数），所以密文、IV 或信封头被改动一位只能整条拒绝，没有降级通路可走。
//
// 口令只以参数形式进出：不落盘、不进日志、不进任何回执字段（断言 29）。
//
// 算法敏捷性写进格式（断言 30）：信封头逐字段记录算法标识与各长度，将来 SDK 出现可用 AEAD
// 或真实 KDF 时按头部换档；无法识别的标识**直接拒**，绝不按当前实现硬猜旧包参数。
//
// 分层：`sealSecretBundle`/`openSecretBundle` 是口令路径（含 KDF 与迭代下限），
// `*WithKeys` 是显式密钥的信封层（已被口令路径复用）。分两层是为了让「信封语义」与
// 「口令派生」各自可被独立钉住，而不是让测试去跑 600k 次迭代来证明一个 AAD 绑定。
//
// 本文件只负责 `secret-bundle` 的加密封装。§8.1 的包级信封（条目摘要、kind 的业务含义）
// 与导入差异预览属于 B5 装配层，不在这里重复实现。

// 包格式标识：与 §8.1 的 `MigrationBundle` 信封同一个 format 串。
public const SECRET_BUNDLE_FORMAT: String = "sacode-migrate/1"
// kind 的两个取值：`config` 结构上没有承载明文的槽位，`secret-bundle` 才有。
public const SECRET_BUNDLE_KIND_CONFIG: String = "config"
public const SECRET_BUNDLE_KIND_SECRET: String = "secret-bundle"
// 算法标识：只认这四个字面量，换档必须同时改这里与 algorithmRejection()。
public const SECRET_BUNDLE_CIPHER: String = "SM4-CTR"
public const SECRET_BUNDLE_MAC: String = "HMAC-SHA256"
public const SECRET_BUNDLE_COMPOSE: String = "ETM"
public const SECRET_BUNDLE_KDF: String = "PBKDF2-HMAC-SHA256"
public const SECRET_BUNDLE_SCHEMA_VERSION: Int64 = 1
// 迭代次数下限：不低于 600k（§8.2）。这是**写包侧**的下限——封包时低于它直接拒。
// 读包侧不拿它当认证判据：迭代数在 MAC 覆盖范围之内，改它必然破坏 MAC；这里不把
// 「认证失败」伪装成「参数太弱」。
public const SECRET_BUNDLE_MIN_ITERATIONS: Int64 = 600000
// 迭代次数上限：解包要先读头里的迭代数才能派生 MAC 密钥，所以头是一个**未认证**的输入。
// 不设上限等于让一个畸形包让我们白烧 CPU（DoS）。取值远超当前档位、但仍能算完。
public const SECRET_BUNDLE_MAX_ITERATIONS: Int64 = 10000000
// 各段长度：写进信封头，解包按头里的值切分并逐段核对。
public const SECRET_BUNDLE_SALT_LEN: Int64 = 16
public const SECRET_BUNDLE_IV_LEN: Int64 = 16
public const SECRET_BUNDLE_TAG_LEN: Int64 = 32
public const SECRET_BUNDLE_ENC_KEY_LEN: Int64 = 16
public const SECRET_BUNDLE_MAC_KEY_LEN: Int64 = 32

// 拒绝码是闭集，调用方按码分诊，不解析文案。
public const SECRET_BUNDLE_MALFORMED: String = "secret-bundle-malformed"
public const SECRET_BUNDLE_UNKNOWN_ALGORITHM: String = "secret-bundle-unknown-algorithm"
public const SECRET_BUNDLE_UNOPENABLE: String = "secret-bundle-unopenable"
public const SECRET_BUNDLE_WEAK_KDF: String = "secret-bundle-weak-kdf"
// 认证失败只有一句人话，且**口令错与包被改动共用同一句**：分开报就等于给出
// 「哪一半错了」的预言机（断言 27、29）。
public const SECRET_BUNDLE_UNOPENABLE_DETAIL: String = "口令不对或迁移包已被改动，解不开"

// 子密钥派生的域分隔上下文串（§8.2）：与盐拼接后作为 PBKDF2 的盐输入。
let SECRET_BUNDLE_ENC_CONTEXT: String = "sacode-migrate/1|enc"
let SECRET_BUNDLE_MAC_CONTEXT: String = "sacode-migrate/1|mac"

// 信封头的 12 个字段按固定顺序、固定键名序列化。这个字节串有三重身份：
// 落盘形态、MAC 覆盖的 AAD、以及将来换算法档时唯一的自描述依据。
public class SecretBundleHeader {
    public let format: String
    public let kind: String
    public let schemaVersion: Int64
    public let generatedAt: Int64
    public let cipher: String
    public let mac: String
    public let compose: String
    public let kdf: String
    public let iterations: Int64
    public let saltLen: Int64
    public let ivLen: Int64
    public let tagLen: Int64

    public init(format: String, kind: String, schemaVersion: Int64, generatedAt: Int64,
                cipher: String, mac: String, compose: String, kdf: String,
                iterations: Int64, saltLen: Int64, ivLen: Int64, tagLen: Int64) {
        this.format = format
        this.kind = kind
        this.schemaVersion = schemaVersion
        this.generatedAt = generatedAt
        this.cipher = cipher
        this.mac = mac
        this.compose = compose
        this.kdf = kdf
        this.iterations = iterations
        this.saltLen = saltLen
        this.ivLen = ivLen
        this.tagLen = tagLen
    }

    // 唯一序列化：固定顺序、固定键名、无尾随换行。parser 按同一顺序逐行核对，
    // 多一行、少一行、换序、未知键名都算畸形——不做「忽略未知字段继续解」。
    public func toBytes(): Array<Byte> {
        var text = "format=${format}\n"
        text += "kind=${kind}\n"
        text += "schemaVersion=${schemaVersion}\n"
        text += "generatedAt=${generatedAt}\n"
        text += "cipher=${cipher}\n"
        text += "mac=${mac}\n"
        text += "compose=${compose}\n"
        text += "kdf=${kdf}\n"
        text += "iterations=${iterations}\n"
        text += "saltLen=${saltLen}\n"
        text += "ivLen=${ivLen}\n"
        text += "tagLen=${tagLen}"
        return text.toArray()
    }

    // 读面摘要：只有算法标识与长度，没有盐/IV/密文/标签，也没有口令与明文。
    public func safeSummary(): String {
        return "format=${format} kind=${kind} schemaVersion=${schemaVersion} cipher=${cipher}"
            + " mac=${mac} compose=${compose} kdf=${kdf} iterations=${iterations}"
            + " saltLen=${saltLen} ivLen=${ivLen} tagLen=${tagLen}"
    }

    // 算法敏捷性的唯一闸门：认不出就拒，空串表示四个标识与本实现相符。
    // 这一步必须在任何密码学动作之前（断言 30）——先派生再校验，回执就会把
    // 「算法不认识」说成「解不开」。
    public func algorithmRejection(): String {
        if (format != SECRET_BUNDLE_FORMAT) { return SECRET_BUNDLE_UNKNOWN_ALGORITHM }
        if (schemaVersion != SECRET_BUNDLE_SCHEMA_VERSION) { return SECRET_BUNDLE_UNKNOWN_ALGORITHM }
        if (cipher != SECRET_BUNDLE_CIPHER) { return SECRET_BUNDLE_UNKNOWN_ALGORITHM }
        if (mac != SECRET_BUNDLE_MAC) { return SECRET_BUNDLE_UNKNOWN_ALGORITHM }
        if (compose != SECRET_BUNDLE_COMPOSE) { return SECRET_BUNDLE_UNKNOWN_ALGORITHM }
        if (kdf != SECRET_BUNDLE_KDF) { return SECRET_BUNDLE_UNKNOWN_ALGORITHM }
        return ""
    }

    // 标识认识之后才核参数：长度与迭代数必须落在本实现能执行的范围内，否则算畸形。
    // （将来换 AEAD 档时，IV/标签长度要求随 algorithmRejection 一起换。）
    public func parameterRejection(): String {
        if (saltLen <= 0 || ivLen != SECRET_BUNDLE_IV_LEN || tagLen != SECRET_BUNDLE_TAG_LEN) {
            return SECRET_BUNDLE_MALFORMED
        }
        if (iterations < 1 || iterations > SECRET_BUNDLE_MAX_ITERATIONS) {
            return SECRET_BUNDLE_MALFORMED
        }
        return ""
    }

    // 只做**结构**解析：行数、键名顺序、十进制合法性、非负性、长度为正。
    // 算法标识在这里不判——不认识的标识要报「不认识」，不能报成「结构坏了」。
    public static func parse(bytes: Array<Byte>): Option<SecretBundleHeader> {
        var text = ""
        try {
            text = String.fromUtf8(bytes)
        } catch (e: Exception) {
            return None
        }
        let lines = text.split("\n")
        if (lines.size != 12) {
            return None
        }
        let format = sbField(lines, 0, "format") ?? ""
        let kind = sbField(lines, 1, "kind") ?? ""
        let schemaRaw = sbField(lines, 2, "schemaVersion") ?? ""
        let generatedRaw = sbField(lines, 3, "generatedAt") ?? ""
        let cipher = sbField(lines, 4, "cipher") ?? ""
        let mac = sbField(lines, 5, "mac") ?? ""
        let compose = sbField(lines, 6, "compose") ?? ""
        let kdf = sbField(lines, 7, "kdf") ?? ""
        let iterRaw = sbField(lines, 8, "iterations") ?? ""
        let saltRaw = sbField(lines, 9, "saltLen") ?? ""
        let ivRaw = sbField(lines, 10, "ivLen") ?? ""
        let tagRaw = sbField(lines, 11, "tagLen") ?? ""
        if (format.size == 0 || kind.size == 0 || cipher.size == 0 || mac.size == 0
            || compose.size == 0 || kdf.size == 0) {
            return None
        }
        let schemaVersion = sbParseInt64(schemaRaw) ?? Int64(-1)
        let generatedAt = sbParseInt64(generatedRaw) ?? Int64(-1)
        let iterations = sbParseInt64(iterRaw) ?? Int64(-1)
        let saltLen = sbParseInt64(saltRaw) ?? Int64(-1)
        let ivLen = sbParseInt64(ivRaw) ?? Int64(-1)
        let tagLen = sbParseInt64(tagRaw) ?? Int64(-1)
        if (schemaVersion < 1 || generatedAt < 0 || iterations < 1 || saltLen <= 0 || ivLen <= 0
            || tagLen <= 0) {
            return None
        }
        return Some(SecretBundleHeader(format, kind, schemaVersion, generatedAt, cipher, mac,
            compose, kdf, iterations, saltLen, ivLen, tagLen))
    }
}

// 一条 `secret-bundle` 记录的完整封装形态。
// 落盘布局（大端）：u32 头部长度 ‖ 头部 ‖ 盐 ‖ IV ‖ 密文 ‖ 标签。
// 密文长度不单独存：它由总长减去其余各段推出，各段长度都在头部里，从而只有一种解释。
public class SecretBundle {
    public let header: SecretBundleHeader
    public let salt: Array<Byte>
    public let iv: Array<Byte>
    public let ciphertext: Array<Byte>
    public let tag: Array<Byte>

    public init(header: SecretBundleHeader, salt: Array<Byte>, iv: Array<Byte>,
                ciphertext: Array<Byte>, tag: Array<Byte>) {
        this.header = header
        this.salt = salt
        this.iv = iv
        this.ciphertext = ciphertext
        this.tag = tag
    }

    // MAC 覆盖范围：`信封头 ‖ IV ‖ 密文`（§8.2 原文）。
    // 盐不在这段里，但它是 MAC 密钥的派生输入——动一个字节就换掉整把 MAC 密钥，
    // 校验必然不过，所以盐是被密码学地绑住的，不是漏掉。
    public func macInput(): Array<Byte> {
        return sbMacInput(header.toBytes(), iv, ciphertext)
    }

    // 读面摘要：不含盐/IV/密文/标签内容，也不含口令与明文。
    public func safeSummary(): String {
        return "${header.safeSummary()} saltBytes=${salt.size} ivBytes=${iv.size}"
            + " ctBytes=${ciphertext.size} tagBytes=${tag.size}"
    }

    public func toBytes(): Array<Byte> {
        let hb = header.toBytes()
        let out = ArrayList<Byte>()
        for (b in sbBe32(hb.size)) {
            out.add(b)
        }
        for (b in hb) {
            out.add(b)
        }
        for (b in salt) {
            out.add(b)
        }
        for (b in iv) {
            out.add(b)
        }
        for (b in ciphertext) {
            out.add(b)
        }
        for (b in tag) {
            out.add(b)
        }
        return out.toArray()
    }

    public static func parse(bytes: Array<Byte>): Option<SecretBundle> {
        if (bytes.size < 4) {
            return None
        }
        var headerLen: Int64 = 0
        var i: Int64 = 0
        while (i < 4) {
            headerLen = (headerLen << 8) | Int64(bytes[i])
            i += 1
        }
        if (headerLen <= 0 || 4 + headerLen > bytes.size) {
            return None
        }
        let headerBytes = sbSlice(bytes, 4, 4 + headerLen)
        let parsed = SecretBundleHeader.parse(headerBytes)
        if (parsed.isNone()) {
            return None
        }
        let header = parsed.getOrThrow()
        let fixed = 4 + headerLen + header.saltLen + header.ivLen + header.tagLen
        if (fixed > bytes.size) {
            return None
        }
        let ctLen = bytes.size - fixed
        let saltFrom = 4 + headerLen
        let ivFrom = saltFrom + header.saltLen
        let ctFrom = ivFrom + header.ivLen
        let tagFrom = ctFrom + ctLen
        let salt = sbSlice(bytes, saltFrom, ivFrom)
        let iv = sbSlice(bytes, ivFrom, ctFrom)
        let ciphertext = sbSlice(bytes, ctFrom, tagFrom)
        let tag = sbSlice(bytes, tagFrom, bytes.size)
        return Some(SecretBundle(header, salt, iv, ciphertext, tag))
    }
}

// 解包结果。失败时 `plaintext` 必须为 None——**不回吐任何部分明文**（断言 29），
// 连「已解出多少字节」这种长度信息也不回。
public class SecretBundleOpenResult {
    public let plaintext: Option<Array<Byte>>
    public let code: String
    public let detail: String

    public init(plaintext: Option<Array<Byte>>, code: String, detail: String) {
        this.plaintext = plaintext
        this.code = code
        this.detail = detail
    }

    public func isOpen(): Bool {
        return plaintext.isSome()
    }
}

// 子密钥对。用类而不是元组，是为了让「哪把是哪把」在调用点就看得见，
// 不靠位置记忆（encKey / macKey 互换过一次就是灾难）。
public class SecretBundleKeys {
    public let encKey: Array<Byte>
    public let macKey: Array<Byte>

    public init(encKey: Array<Byte>, macKey: Array<Byte>) {
        this.encKey = encKey
        this.macKey = macKey
    }
}

// 定长时间比较的读数。`comparedBytes` 是这条性质的**可检形式**：比较步数必须与
// 「第几个字节起不同」无关，否则「不提前返回」只是注释里的一句话，没法防回归。
public class ConstantTimeCompare {
    public let equal: Bool
    public let comparedBytes: Int64

    public init(equal: Bool, comparedBytes: Int64) {
        this.equal = equal
        this.comparedBytes = comparedBytes
    }
}

// PBKDF2-HMAC-SHA256（RFC 2898 的 dkLen 语义）。
// 只构建在 stdx 已 vetted 的 HMAC 之上，不手写分组密码、不手写哈希混淆冒充 KDF。
// 逐条命中 RFC 6070 形态向量（含 c=4096、dkLen=40 的多块用例与 `pass\0word` 的 NUL 截断
// 用例），并与 RFC 7914 §11 公布的两条 PBKDF2-HMAC-SHA256 向量逐字节一致——见
// secret_bundle_test.cj 的 pbkdf2Sha256MatchesRfc6070Vectors。
public func pbkdf2Sha256(password: Array<Byte>, salt: Array<Byte>, iterations: Int64,
                         dkLen: Int64): Array<Byte> {
    if (iterations < 1) {
        throw Exception("pbkdf2-bad-iterations")
    }
    if (dkLen < 1) {
        throw Exception("pbkdf2-bad-length")
    }
    // 一个 HMAC 上下文复用整轮派生：stdx 每次新建 HMAC 都要重做一遍密钥调度与上下文分配，
    // 600k 轮下那是主成本。复用**不改变结果**——RFC 6070 形态向量与 RFC 7914 向量逐条钉住这一点。
    let prf = HMAC(password, HashType.SHA256)
    let out = ArrayList<Byte>()
    var block: Int64 = 1
    while (Int64(out.size) < dkLen) {
        // U1 = PRF(P, S ‖ INT_32_BE(i))
        prf.reset()
        prf.write(sbConcat(salt, sbBe32(block)))
        var u = prf.finish()
        // acc 必须是 u 的副本：下面每轮都会重绑 u，别名会让累加全错
        let acc = sbCopyBytes(u)
        var k: Int64 = 1
        while (k < iterations) {
            prf.reset()
            prf.write(u)
            u = prf.finish()
            var i: Int64 = 0
            while (i < acc.size) {
                acc[i] = acc[i] ^ u[i]
                i += 1
            }
            k += 1
        }
        // 末块按剩余长度截断：dkLen 不是 32 的整数倍时，多出的字节一个都不能带出去
        var i: Int64 = 0
        while (i < acc.size) {
            if (Int64(out.size) < dkLen) {
                out.add(acc[i])
            }
            i += 1
        }
        block += 1
    }
    return out.toArray()
}

// 同一 (口令, 盐) 两次派生，上下文串不同 → 一把加密、一把 MAC（§8.2 子密钥分离）。
public func deriveSecretBundleKeys(passphrase: Array<Byte>, salt: Array<Byte>,
                                   iterations: Int64): SecretBundleKeys {
    // 上下文串拼在盐后面，而不是拼在口令前面：口令只作为 PRF 的 key 出现一次，
    // 两个域之间唯一的差别就是盐输入，改这里等于换整套密钥。
    let encKey = pbkdf2Sha256(passphrase, sbConcat(salt, SECRET_BUNDLE_ENC_CONTEXT.toArray()),
        iterations, SECRET_BUNDLE_ENC_KEY_LEN)
    let macKey = pbkdf2Sha256(passphrase, sbConcat(salt, SECRET_BUNDLE_MAC_CONTEXT.toArray()),
        iterations, SECRET_BUNDLE_MAC_KEY_LEN)
    return SecretBundleKeys(encKey, macKey)
}

// 定长时间比较：逐字节异或累积，**不提前返回**（§8.2 硬约束）。
// 长度不同时也只比公共前缀那么多字节，然后整体判不等——不因长度先返回。
public func secretBundleConstTimeEquals(a: Array<Byte>, b: Array<Byte>): ConstantTimeCompare {
    let n = if (a.size < b.size) { a.size } else { b.size }
    let zero: Byte = 0
    var diff: Byte = zero
    var i: Int64 = 0
    // 循环次数只由长度决定：差异出现在第 1 个字节还是最后一个字节，走的都是同一段
    while (i < n) {
        diff = diff ^ (a[i] ^ b[i])
        i += 1
    }
    var equal = a.size == b.size
    if (diff != zero) {
        equal = false
    }
    return ConstantTimeCompare(equal, n)
}

// 信封层封包（显式密钥）：不做 KDF，所以不设迭代下限；`iterations` 只作为
// 「这条记录声明自己是用多少轮派生的」写进头部，保证头部不撒谎。
// 盐与 IV 一律走 SecureRandom。
public func sealSecretBundleWithKeys(encKey: Array<Byte>, macKey: Array<Byte>,
                                     payload: Array<Byte>, generatedAt: Int64, iterations: Int64,
                                     kind!: String = SECRET_BUNDLE_KIND_SECRET): SecretBundle {
    sbCheckKeyLengths(encKey, macKey)
    let header = sbHeader(iterations, generatedAt, kind)
    let rnd = SecureRandom()
    let salt = Array<Byte>(SECRET_BUNDLE_SALT_LEN, repeat: 0)
    let iv = Array<Byte>(SECRET_BUNDLE_IV_LEN, repeat: 0)
    rnd.nextBytes(salt)
    rnd.nextBytes(iv)
    return sbSeal(encKey, macKey, payload, header, salt, iv)
}

// 口令路径封包：派生两把子密钥后交给信封层。写包侧在这里执行迭代次数下限——
// 低于 600k 直接拒，不给「先导出来再说」留通路（§8.5）。
public func sealSecretBundle(passphrase: String, payload: Array<Byte>, generatedAt: Int64,
                             iterations!: Int64 = SECRET_BUNDLE_MIN_ITERATIONS,
                             kind!: String = SECRET_BUNDLE_KIND_SECRET): SecretBundle {
    // 写包侧下限：弱参数包在本实现里根本产不出来（读包侧再判就成了「认证失败」误报）
    if (iterations < SECRET_BUNDLE_MIN_ITERATIONS) {
        throw Exception(SECRET_BUNDLE_WEAK_KDF)
    }
    let header = sbHeader(iterations, generatedAt, kind)
    let rnd = SecureRandom()
    let salt = Array<Byte>(SECRET_BUNDLE_SALT_LEN, repeat: 0)
    let iv = Array<Byte>(SECRET_BUNDLE_IV_LEN, repeat: 0)
    rnd.nextBytes(salt)
    rnd.nextBytes(iv)
    let keys = deriveSecretBundleKeys(passphrase.toArray(), salt, iterations)
    return sbSeal(keys.encKey, keys.macKey, payload, header, salt, iv)
}

// 信封层解包（显式密钥）。顺序：算法预检 → 参数与长度核对 → **先 MAC** →
// 定长时间比较 → 通过后才构造分组密码解密。MAC 不过时既不派生子密钥也不碰密文。
public func openSecretBundleWithKeys(encKey: Array<Byte>, macKey: Array<Byte>,
                                     bundle: SecretBundle): SecretBundleOpenResult {
    // ① 算法预检：不认识的标识到此为止，一步密码学动作都不做
    let alg = bundle.header.algorithmRejection()
    if (alg.size > 0) {
        return SecretBundleOpenResult(None, alg, sbRejectDetail(alg))
    }
    // ② 参数与长度：头部声明的值必须与本实现能执行的范围、以及实际字节数三方一致，
    //    不一致就是畸形包——不按「实际有多长就解多长」凑合
    let par = bundle.header.parameterRejection()
    if (par.size > 0) {
        return SecretBundleOpenResult(None, par, sbRejectDetail(par))
    }
    if (bundle.salt.size != bundle.header.saltLen || bundle.iv.size != bundle.header.ivLen
        || bundle.tag.size != bundle.header.tagLen) {
        return SecretBundleOpenResult(None, SECRET_BUNDLE_MALFORMED,
            sbRejectDetail(SECRET_BUNDLE_MALFORMED))
    }
    sbCheckKeyLengths(encKey, macKey)
    // ③④ 认证 → 解密：顺序只在 sbOpenVerified 一处定义（先 MAC，通过后才解密）。
    //    把解密挪到校验之前，就是把篡改过的密文交给明文处理路径（§8.2 硬约束）。
    return sbOpenVerified(macKey, { => encKey }, bundle)
}

// 口令路径解包：先做算法与参数预检（**在派生之前**），再按头部迭代数派生子密钥。
public func openSecretBundleObject(passphrase: String,
                                   bundle: SecretBundle): SecretBundleOpenResult {
    // 预检必须在派生之前：一个声明 `cipher=AES-256-GCM` 的包，回执要说「算法不认识」，
    // 而不是先烧掉 600k 轮 PBKDF2 再回一句「解不开」（断言 30 的可检形式）
    let alg = bundle.header.algorithmRejection()
    if (alg.size > 0) {
        return SecretBundleOpenResult(None, alg, sbRejectDetail(alg))
    }
    let par = bundle.header.parameterRejection()
    if (par.size > 0) {
        return SecretBundleOpenResult(None, par, sbRejectDetail(par))
    }
    if (bundle.salt.size != bundle.header.saltLen) {
        return SecretBundleOpenResult(None, SECRET_BUNDLE_MALFORMED,
            sbRejectDetail(SECRET_BUNDLE_MALFORMED))
    }
    // 迭代数取自头部：它已在 MAC 覆盖范围之内，改它必然破坏标签，所以这里不需要
    // 再拿「不低于 600k」当认证判据。上限由 parameterRejection 挡（未认证输入的 DoS 面）。
    // 先只派生 MAC 密钥：验签不过就到此为止，解密密钥连派生都不发生（口令错/包被改
    // 这类失败路径因此只花一轮 KDF，也不会把解密密钥送进内存）。
    let macKey = pbkdf2Sha256(passphrase.toArray(),
        sbConcat(bundle.salt, SECRET_BUNDLE_MAC_CONTEXT.toArray()), bundle.header.iterations,
        SECRET_BUNDLE_MAC_KEY_LEN)
    let passBytes = passphrase.toArray()
    let saltBytes = bundle.salt
    let rounds = bundle.header.iterations
    return sbOpenVerified(macKey, { =>
        pbkdf2Sha256(passBytes, sbConcat(saltBytes, SECRET_BUNDLE_ENC_CONTEXT.toArray()), rounds,
            SECRET_BUNDLE_ENC_KEY_LEN)
    }, bundle)
}

// 解包（字节形态）：先解析结构，再走口令路径的认证 → 解密硬顺序。
public func openSecretBundle(passphrase: String, envelope: Array<Byte>): SecretBundleOpenResult {
    let parsed = SecretBundle.parse(envelope)
    if (parsed.isNone()) {
        return SecretBundleOpenResult(None, SECRET_BUNDLE_MALFORMED, "迁移包结构不完整，解不开")
    }
    return openSecretBundleObject(passphrase, parsed.getOrThrow())
}

// —— 以下为包内私有小工具 ——

// 12 个头部字段按固定下标取；键名不对、行数不对都在上层判成畸形。
func sbField(lines: Array<String>, index: Int64, name: String): Option<String> {
    if (index < 0 || index >= lines.size) {
        return None
    }
    let prefix = "${name}="
    let line = lines[index]
    if (!line.startsWith(prefix)) {
        return None
    }
    if (line.size <= prefix.size) {
        return Some("")
    }
    return Some(line[prefix.size..line.size])
}

// 只认 ASCII 十进制、拒绝负号与前导零以外的花活；不借 std.convert，避免解析语义随版本漂移。
func sbParseInt64(text: String): Option<Int64> {
    if (text.size == 0) {
        return None
    }
    let bs = text.toArray()
    var v: Int64 = 0
    var i: Int64 = 0
    while (i < bs.size) {
        let b = bs[i]
        if (b < 48 || b > 57) {
            return None
        }
        v = v * 10 + Int64(b - 48)
        i += 1
    }
    return Some(v)
}

func sbConcat(a: Array<Byte>, b: Array<Byte>): Array<Byte> {
    let out = ArrayList<Byte>()
    for (x in a) {
        out.add(x)
    }
    for (x in b) {
        out.add(x)
    }
    return out.toArray()
}

func sbSlice(src: Array<Byte>, from: Int64, until: Int64): Array<Byte> {
    let out = ArrayList<Byte>()
    var i = from
    while (i < until) {
        out.add(src[i])
        i += 1
    }
    return out.toArray()
}

func sbBe32(v: Int64): Array<Byte> {
    let out = ArrayList<Byte>()
    out.add(UInt8((v >> 24) & 255))
    out.add(UInt8((v >> 16) & 255))
    out.add(UInt8((v >> 8) & 255))
    out.add(UInt8(v & 255))
    return out.toArray()
}

func sbHmacSha256(key: Array<Byte>, msg: Array<Byte>): Array<Byte> {
    let h = HMAC(key, HashType.SHA256)
    h.write(msg)
    return h.finish()
}

// MAC 覆盖范围的唯一定义处：`信封头 ‖ IV ‖ 密文`。封包与解包共用它，
// 免得两处各写一遍、某天只改了其中一边。
func sbMacInput(headerBytes: Array<Byte>, iv: Array<Byte>, ct: Array<Byte>): Array<Byte> {
    return sbConcat(sbConcat(headerBytes, iv), ct)
}

func sbCopyBytes(src: Array<Byte>): Array<Byte> {
    let out = Array<Byte>(src.size, repeat: 0)
    var i: Int64 = 0
    while (i < src.size) {
        out[i] = src[i]
        i += 1
    }
    return out.toArray()
}

// 拒绝码 → 人话。认证失败那档必须与口令无关，所以不进任何动态信息。
func sbRejectDetail(code: String): String {
    if (code == SECRET_BUNDLE_UNKNOWN_ALGORITHM) {
        return "迁移包用了本栈不认识的算法标识，拒收"
    }
    if (code == SECRET_BUNDLE_MALFORMED) {
        return "迁移包结构不完整或参数超出可执行范围，解不开"
    }
    return SECRET_BUNDLE_UNOPENABLE_DETAIL
}

func sbHeader(iterations: Int64, generatedAt: Int64, kind: String): SecretBundleHeader {
    return SecretBundleHeader(SECRET_BUNDLE_FORMAT, kind, SECRET_BUNDLE_SCHEMA_VERSION, generatedAt,
        SECRET_BUNDLE_CIPHER, SECRET_BUNDLE_MAC, SECRET_BUNDLE_COMPOSE, SECRET_BUNDLE_KDF,
        iterations, SECRET_BUNDLE_SALT_LEN, SECRET_BUNDLE_IV_LEN, SECRET_BUNDLE_TAG_LEN)
}

// 密钥长度是构造参数错误（fail-loud），不是「包坏了」：SM4 只吃 128 位密钥，
// 长度不对就让 SDK 抛在深层，不如在这里说清楚。
func sbCheckKeyLengths(encKey: Array<Byte>, macKey: Array<Byte>): Unit {
    if (encKey.size != SECRET_BUNDLE_ENC_KEY_LEN) {
        throw Exception("secret-bundle-bad-enc-key-length")
    }
    if (macKey.size != SECRET_BUNDLE_MAC_KEY_LEN) {
        throw Exception("secret-bundle-bad-mac-key-length")
    }
}

// 信封层的认证 → 解密顺序，只此一处：先算 MAC → 定长时间比较 → **通过后**才向
// `encKeyFactory` 要加密密钥并解密。工厂是惰性的，所以「验签不通过就不派生解密密钥」
// 是结构上的事实，不是注释里的承诺。
func sbOpenVerified(macKey: Array<Byte>, encKeyFactory: () -> Array<Byte>,
                    bundle: SecretBundle): SecretBundleOpenResult {
    let want = sbHmacSha256(macKey, bundle.macInput())
    if (!secretBundleConstTimeEquals(want, bundle.tag).equal) {
        return SecretBundleOpenResult(None, SECRET_BUNDLE_UNOPENABLE, SECRET_BUNDLE_UNOPENABLE_DETAIL)
    }
    let encKey = encKeyFactory()
    sbCheckKeyLengths(encKey, macKey)
    let cipher = SM4(OperationMode.CTR, encKey, iv: bundle.iv)
    return SecretBundleOpenResult(Some(cipher.decrypt(bundle.ciphertext)), "", "")
}

// 封包的信封层主体：加密后立刻算标签（encrypt-then-MAC）。
func sbSeal(encKey: Array<Byte>, macKey: Array<Byte>, payload: Array<Byte>,
            header: SecretBundleHeader, salt: Array<Byte>, iv: Array<Byte>): SecretBundle {
    let cipher = SM4(OperationMode.CTR, encKey, iv: iv)
    let ct = cipher.encrypt(payload)
    let tag = sbHmacSha256(macKey, sbMacInput(header.toBytes(), iv, ct))
    return SecretBundle(header, salt, iv, ct, tag)
}
