package core

import std.collection.*
import std.fs.*
import std.sync.*
import std.time.*
import stdx.crypto.crypto.*
import stdx.encoding.hex.*
import stdx.encoding.json.*

// 远程设备身份与令牌存储：daemon 内置接入的身份/授权基座。
//
// 契约（对应 docs/superpowers/specs/2026-10-10-unified-remote-mobile-design.md §4）：
//   - 设备凭据 32 字节随机（≥ 256 bit），服务端只存 sha256Hex 摘要，不存原文
//   - 登记秘密 16 字节随机（≥ 128 bit），一次消费，5 分钟失效
//   - 访问令牌 32 字节随机，最长 15 分钟
//   - 撤销版本每次吊销递增：旧版本令牌与旧凭据立即失效
//   - 凭据校验走 secretBundleConstTimeEquals 定长时间比较，不提前返回
//
// 时间口径：store 内部用 `MonoTime.now()` 换算 Int64 毫秒「store 建立起的相对时间」，
// 到期判断走 `expiresAt - nowMs()`。测试用 `expireToken` / `expireEnrollmentSecret`
// 直接把 `expiresAt` 改写为过去值，不依赖真实时钟。生产接入时（任务 6 收尾）
// 换成 `cangjie-injectable-clock-seam` 的注入形态。

public class DeviceCredential {
    public let value: String        // 原文，只在返回给调用方那一刻存在
    public let digest: String       // sha256Hex，服务端存储形态
    public init(value: String, digest: String) {
        this.value = value
        this.digest = digest
    }
}

public class EnrollmentSecret {
    public let value: String
    public let principalId: String
    public var consumed = false
    public var expiresAt: Int64
    public init(value: String, principalId: String, expiresAt: Int64) {
        this.value = value
        this.principalId = principalId
        this.expiresAt = expiresAt
    }
}

public class DeviceRecord {
    public let deviceId: String
    public let principalId: String
    // 轮换凭据会改写这一位，所以它不能是 let（设计 §4「设备凭据轮换与撤销独立」）。
    public var credentialDigest: String
    public let kind: String
    // 注册响应一次性交付给调用方的凭据原文；store 内部不落这个字段，
    // 只落 credentialDigest。生产路径由 TLS 客户端注册通道原样送出。
    public let credential: String
    public var revoked: Bool = false
    // 显式授予的能力面（§4「具有显式管理权限的认证 RPC」）。默认空集=零权限：
    // 没有任何设备天生能管设备，授权只来自本机受保护管理入口的 grantScope。
    public var scopes = HashSet<String>()
    public init(deviceId: String, principalId: String, credentialDigest: String, kind: String, credential: String) {
        this.deviceId = deviceId
        this.principalId = principalId
        this.credentialDigest = credentialDigest
        this.kind = kind
        this.credential = credential
    }
}

public class AccessToken {
    public let value: String
    public let deviceId: String
    public let revocationVersion: Int64
    public var expiresAt: Int64
    public init(value: String, deviceId: String, revocationVersion: Int64, expiresAt: Int64) {
        this.value = value
        this.deviceId = deviceId
        this.revocationVersion = revocationVersion
        this.expiresAt = expiresAt
    }
}

// 设备清单的投影形状：本地管理入口要把它整段打到 stdout，所以这一层
// 刻意不含 credentialDigest / credential——摘要进日志等于把校验面暴露给
// 任何能看到终端回滚的人（离线字典攻击的入口）。
public class DeviceSummary {
    public let deviceId: String
    public let principalId: String
    public let kind: String
    public let revoked: Bool
    // 桌面「已登记设备」面板要显示这台到底有没有管理能力，所以投影里必须带这一位。
    public let scopes: HashSet<String>
    public init(deviceId!: String, principalId!: String, kind!: String, revoked!: Bool,
                scopes!: HashSet<String> = HashSet<String>()) {
        this.deviceId = deviceId
        this.principalId = principalId
        this.kind = kind
        this.revoked = revoked
        this.scopes = scopes
    }
}

public class AuthenticationContext {
    public let deviceId: String
    public let principalId: String
    public let revocationVersion: Int64
    // 认证时从设备记录复制出来的能力面。gate 用它构造授权视图——
    // 在此之前视图恒为零 scope，认证 RPC 管理面在语义上根本不可达。
    public let scopes: HashSet<String>
    public init(deviceId: String, principalId: String, revocationVersion: Int64,
                scopes!: HashSet<String> = HashSet<String>()) {
        this.deviceId = deviceId
        this.principalId = principalId
        this.revocationVersion = revocationVersion
        this.scopes = scopes
    }
}

// 常量：一次消费登记秘密 5 分钟；令牌 15 分钟。毫秒单位。
let ENROLLMENT_TTL_MS: Int64 = 5 * 60 * 1000
let TOKEN_TTL_MS: Int64 = 15 * 60 * 1000

func randomHex(byteLen: Int64): String {
    let r = SecureRandom()
    let bytes = Array<Byte>(byteLen, repeat: 0)
    r.nextBytes(bytes)
    return toHexString(bytes)
}

public class RemoteIdentityStore {
    let base = MonoTime.now()
    let lock = Mutex()
    // 登记秘密按 **摘要** 索引：兑换时把提交值做 sha256Hex 再查。
    // 若按原文索引，store 生命周期内就一直持有可还原的登记秘密，
    // 既违反本模块「服务端只存摘要」的契约，也无法安全落盘。
    let enrollments = HashMap<String, EnrollmentSecret>()
    // 设备按 deviceId 索引；credentialDigest 用于验证兑换请求的凭据原文。
    let devices = HashMap<String, DeviceRecord>()
    // 令牌同样按 **摘要** 索引，理由同上。
    let tokens = HashMap<String, AccessToken>()
    // 撤销版本号：每次 revokeDevice 递增；旧版本令牌一律拒绝。
    var revocationVersion: Int64 = 1
    var nextDeviceId: Int64 = 1
    // 最近一次从磁盘读到的快照原文。refreshFromDisk 用它做「有没有变」的比对，
    // 免得每个认证请求都解析一遍 JSON。
    var snapshotCacheText = ""

    public init() {}

    func nowMs(): Int64 {
        return (MonoTime.now() - base).toMilliseconds()
    }

    // 摘要即键：原文只在参数里存在到本函数返回为止。
    static func secretKey(secret: String): String {
        return sha256Hex(secret.toArray())
    }

    // 跨进程票据用**绝对 unix 毫秒**表达到期：store 内部的 nowMs() 是「本 store
    // 建立以来的相对毫秒」，管理入口进程与 daemon 进程的两个 base 不同，
    // 把相对值直接写进快照，恢复端会算错剩余窗口（可能把已过期票据当有效）。
    static func wallNowMs(): Int64 {
        return DateTime.nowUTC().toUnixTimeStamp().toMilliseconds()
    }

    // 恢复时把绝对 unix 毫秒换算回本 store 的相对刻度；可为负（即已过期）。
    func toStoreRelative(absoluteUnixMs: Int64): Int64 {
        return absoluteUnixMs - RemoteIdentityStore.wallNowMs() + nowMs()
    }

    func toAbsoluteUnixMs(relativeMs: Int64): Int64 {
        return relativeMs + RemoteIdentityStore.wallNowMs() - nowMs()
    }

    // 生成 256-bit 设备凭据。value 只在返回给调用方的一刻存在，store 不落任何原文。
    public func generateCredential(): DeviceCredential {
        let value = randomHex(32)
        let digest = sha256Hex(value.toArray())
        return DeviceCredential(value, digest)
    }

    // 生成 128-bit 一次性登记秘密，5 分钟有效。principalId 是本实例内的授权主体。
    public func createEnrollmentSecret(principalId: String): EnrollmentSecret {
        lock.lock()
        let secret = EnrollmentSecret(randomHex(16), principalId, nowMs() + ENROLLMENT_TTL_MS)
        enrollments.add(secretKey(secret.value), secret)
        lock.unlock()
        return secret
    }

    // 测试辅助：把指定登记秘密的到期时间改到过去。
    public func expireEnrollmentSecret(value: String): Unit {
        lock.lock()
        if (let Some(s) <- enrollments.get(secretKey(value))) {
            s.expiresAt = nowMs() - Int64(1)
        }
        lock.unlock()
    }

    // 用登记秘密兑换设备记录：一次性消费 + 5 分钟窗口 + 服务端生成设备凭据。
    // 返回的 DeviceRecord 里 credentialDigest 是服务端存储形态；对应原文
    // 只在调用返回那一刻在 record.credential 里出现一次，不参与摘要校验也不落盘。
    public func enroll(secretValue: String, deviceName: String, kind: String): DeviceRecord {
        lock.lock()
        if (let Some(enrollment) <- enrollments.get(secretKey(secretValue))) {
            if (enrollment.consumed) {
                lock.unlock()
                throw Exception("enrollment-consumed")
            }
            if (enrollment.expiresAt <= nowMs()) {
                lock.unlock()
                throw Exception("enrollment-expired")
            }
            enrollment.consumed = true
            let cred = generateCredential()
            let deviceId = "${deviceName}-${nextDeviceId}"
            nextDeviceId += 1
            let record = DeviceRecord(deviceId, enrollment.principalId, cred.digest, kind, cred.value)
            devices.add(deviceId, record)
            lock.unlock()
            return record
        }
        lock.unlock()
        throw Exception("enrollment-not-found")
    }

    // 兑换临时访问令牌：验凭据摘要，签发 access token，绑撤销版本。
    public func exchangeToken(deviceId: String, credential: String): AccessToken {
        lock.lock()
        if (let Some(device) <- devices.get(deviceId)) {
            if (device.revoked) {
                lock.unlock()
                throw Exception("device-revoked")
            }
            let presentedDigest = sha256Hex(credential.toArray())
            let cmp = secretBundleConstTimeEquals(
                presentedDigest.toArray(),
                device.credentialDigest.toArray()
            )
            if (!cmp.equal) {
                lock.unlock()
                throw Exception("credential-mismatch")
            }
            let token = AccessToken(
                randomHex(32),
                deviceId,
                revocationVersion,
                nowMs() + TOKEN_TTL_MS
            )
            tokens.add(secretKey(token.value), token)
            lock.unlock()
            return token
        }
        lock.unlock()
        throw Exception("device-not-found")
    }

    // 令牌剩余窗口必须由 **store 自己的钟**算。引导层（HTTP 端点）另有 MonoTime 基准，
    // 两个基准差 1 毫秒就会把「还剩多久」报成比名义 TTL 还长（实测 900001），
    // 客户端据此安排的续期点会晚于真实失效点。
    public func tokenRemainingMs(token: AccessToken): Int64 {
        lock.lock()
        let left = token.expiresAt - nowMs()
        lock.unlock()
        return if (left < Int64(0)) { Int64(0) } else { left }
    }

    // 测试辅助：把令牌到期时间改到过去。
    public func expireToken(value: String): Unit {
        lock.lock()
        if (let Some(t) <- tokens.get(secretKey(value))) {
            t.expiresAt = nowMs() - Int64(1)
        }
        lock.unlock()
    }

    // 撤销设备：标记 revoked，递增全局撤销版本；旧版本令牌立刻失效。
    // 撤销要能如实报告「这台设备不存在」：管理入口敲错 id 时，
    // 「打印了 revoked 但什么都没发生」比报错难诊断得多。
    // 撤销水位只在真撤销掉一台设备时递增——凭空递增会把所有在线令牌打挂。
    public func revokeDevice(deviceId: String): Bool {
        lock.lock()
        var hit = false
        if (let Some(d) <- devices.get(deviceId)) {
            d.revoked = true
            hit = true
        }
        if (hit) { revocationVersion += 1 }
        lock.unlock()
        return hit
    }

    // 显式授予能力面（§4）。三条拒绝：设备不存在、设备已撤销、scope 名为空。
    // 已撤销的设备不能被「顺手授权」复活；空 scope 名会留下一条永远匹配不上的记录，
    // 让审计里看起来授过而实际谁都拿不到。
    public func grantScope(deviceId!: String, scope!: String): Bool {
        if (scope.size == 0) { return false }
        lock.lock()
        var ok = false
        if (let Some(d) <- devices.get(deviceId)) {
            if (!d.revoked) {
                d.scopes.add(scope)
                ok = true
            }
        }
        lock.unlock()
        return ok
    }

    // 凭据轮换（§4「设备凭据轮换与撤销独立」）：换摘要、不动撤销版本。
    // 不动版本是刻意的——抬版本会把这台设备的全部在途访问令牌一次性打掉，
    // 客户端就没法在保住当前连接的前提下换一份新凭据。
    // 已撤销的设备拒换：一把作废的设备不能靠换凭据复活。
    public func rotateCredential(deviceId: String): DeviceCredential {
        lock.lock()
        if (let Some(d) <- devices.get(deviceId)) {
            if (d.revoked) {
                lock.unlock()
                throw Exception("device-revoked")
            }
            let cred = generateCredential()
            d.credentialDigest = cred.digest
            lock.unlock()
            return cred
        }
        lock.unlock()
        throw Exception("device-not-found")
    }

    static func copyScopes(source: HashSet<String>): HashSet<String> {
        let out = HashSet<String>()
        for (k in source) { out.add(k) }
        return out
    }

    // 设备清单（给本地管理入口用）。只回投影，摘要与凭据原文都不出这一层。
    public func listDevices(): ArrayList<DeviceSummary> {
        lock.lock()
        let out = ArrayList<DeviceSummary>()
        for ((deviceId, d) in devices) {
            out.add(DeviceSummary(
                deviceId: deviceId, principalId: d.principalId,
                kind: d.kind, revoked: d.revoked, scopes: copyScopes(d.scopes)))
        }
        lock.unlock()
        return out
    }

    // 认证：返回给请求处理器的最小上下文。任何一步不通过都返回 None，
    // 不区分原因（不泄漏「设备存在但被撤销」这类状态）。
    public func authenticate(tokenValue: String): Option<AuthenticationContext> {
        lock.lock()
        if (let Some(token) <- tokens.get(secretKey(tokenValue))) {
            if (token.expiresAt <= nowMs()) {
                lock.unlock()
                return None
            }
            if (token.revocationVersion < revocationVersion) {
                lock.unlock()
                return None
            }
            if (let Some(device) <- devices.get(token.deviceId)) {
                if (device.revoked) {
                    lock.unlock()
                    return None
                }
                let ctx = AuthenticationContext(token.deviceId, device.principalId, revocationVersion,
                    scopes: copyScopes(device.scopes))
                lock.unlock()
                return Some(ctx)
            }
        }
        lock.unlock()
        return None
    }

    // ==== 持久面（设计 §4.1：实例身份与已登记设备重启不变）====
    //
    // 只落「无到期语义」的记录：设备（含凭据摘要）、撤销版本、设备序号水位。
    // 两类东西明确不落：
    //   - 访问令牌：本就 ≤15 分钟，落盘只是多一处长期可用的凭据；重启后设备
    //     用凭据摘要重新兑换即可，这正是短期令牌应有的行为。
    //   - 登记秘密：5 分钟一次性票据，跨进程的创建/确认属本地管理入口的职责，
    //     落盘会让一个未消费的票据在磁盘上留到不知什么时候。
    // 所以快照里既没有 token/credential 原文，也没有登记秘密原文——
    // enrollments/tokens 现在按摘要索引，就算想落也不必修时钟口径就能落。

    // 快照文本（测试直接扫它断言无明文；生产走 saveSnapshot 落盘）。
    public func snapshotText(): String {
        lock.lock()
        var devicesJson = "["
        var comma = ""
        for ((deviceId, d) in devices) {
            devicesJson += "${comma}{\"deviceId\":\"${jsonEscape(d.deviceId)}\""
            devicesJson += ",\"principalId\":\"${jsonEscape(d.principalId)}\""
            devicesJson += ",\"credentialDigest\":\"${jsonEscape(d.credentialDigest)}\""
            devicesJson += ",\"kind\":\"${jsonEscape(d.kind)}\""
            devicesJson += ",\"revoked\":${if (d.revoked) { "true" } else { "false" }}"
            var scopesJson = "["
            var scopeComma = ""
            for (scope in d.scopes) {
                scopesJson += "${scopeComma}\"${jsonEscape(scope)}\""
                scopeComma = ","
            }
            scopesJson += "]"
            devicesJson += ",\"scopes\":${scopesJson}"
            devicesJson += "}"
            comma = ","
        }
        devicesJson += "]"
        // 票据只以摘要键 + 绝对到期出现：管理入口创建的票据必须能被
        // daemon 进程看到，否则 `/auth/enroll` 永远拿不到有效票据。
        var ticketJson = "["
        comma = ""
        for ((digest, e) in enrollments) {
            ticketJson += "${comma}{\"digest\":\"${jsonEscape(digest)}\""
            ticketJson += ",\"principalId\":\"${jsonEscape(e.principalId)}\""
            ticketJson += ",\"expiresAtUnixMs\":${toAbsoluteUnixMs(e.expiresAt)}"
            ticketJson += ",\"consumed\":${if (e.consumed) { "true" } else { "false" }}"
            ticketJson += "}"
            comma = ","
        }
        ticketJson += "]"
        let rv = revocationVersion
        let nid = nextDeviceId
        lock.unlock()
        var out = "{\"snapshotVersion\":2"
        out += ",\"revocationVersion\":${rv}"
        out += ",\"nextDeviceId\":${nid}"
        out += ",\"devices\":${devicesJson}"
        out += ",\"enrollments\":${ticketJson}}"
        return out
    }

    // 原子落盘：先写临时文件再改名，读者永远看不到半截快照。
    public func saveSnapshot(path: String): Bool {
        let text = snapshotText()
        let target = Path(path)
        let parent = if (target.parent == Path("")) { Path("./") } else { target.parent }
        return try {
            let staging = File.createTemp(parent)
            let stagingPath = staging.info.path
            staging.write(text.toArray())
            staging.close()
            rename(stagingPath, to: target, overwrite: true)
            true
        } catch (_: Exception) { false }
    }

    // 从快照恢复设备与撤销水位。设备凭据只恢复摘要——恢复后的 store 里
    // 不存在任何凭据原文，兑换靠 presented 值的 sha256Hex 与摘要定长比对。
    // 返回 false 表示文件缺失/不可解析，调用方按「无历史」继续而不是假成功。
    public func loadSnapshot(path: String): Bool {
        let p = Path(path)
        if (!exists(p)) { return false }
        let text = try { String.fromUtf8(File.readFrom(p)) } catch (_: Exception) { return false }
        let root = try { JsonValue.fromStr(text).asObject() } catch (_: Exception) { return false }
        lock.lock()
        // 持锁段内一律不 return：早退会漏 unlock，之后整台 daemon 的认证都卡在锁上。
        let seen = mergeDevicesLocked(root, propagateRevoked: false)
        if (seen >= Int64(0)) {
            snapshotCacheText = text
            mergeEnrollmentsLocked(root)
            if (let Some(node) <- root.get("revocationVersion")) {
                let v = try { node.asInt().getValue() } catch (_: Exception) { revocationVersion }
                if (v > revocationVersion) { revocationVersion = v }
            }
            if (let Some(node) <- root.get("nextDeviceId")) {
                let v = try { node.asInt().getValue() } catch (_: Exception) { nextDeviceId }
                if (v > nextDeviceId) { nextDeviceId = v }
            }
        }
        lock.unlock()
        // 「没有 devices 数组」按「无可恢复历史」处理并返回 false：调用方据此知道
        // 快照形状不对，而不是拿到一个「看起来恢复成功」的空 store。
        return seen >= Int64(0)
    }

    // 设备行合入（须持锁调用）。返回看到的设备行数；-1 表示设备节点缺失或某行形状不合，
    // 调用方据此判「这份快照不可信」，不往里合任何状态。
    // 设备表只增不删、revoked 只能 false→true，所以内存里刚登记、磁盘还没写的设备
    // 不会被另一份旧快照回退掉。propagateRevoked 为 true 时磁盘上的撤销位才落到内存——
    // 这是带外管理入口（--manage revoke-device）能在跑的 daemon 上生效的唯一通路。
    func mergeDevicesLocked(root: JsonObject, propagateRevoked!: Bool): Int64 {
        if (let Some(node) <- root.get("devices")) {
            var arr = JsonArray()
            let isArr = try { arr = node.asArray(); true } catch (_: Exception) { false }
            if (!isArr) { return -1 }
            var seen: Int64 = 0
            var i: Int64 = 0
            while (i < arr.size()) {
                seen += 1
                if (let Some(item) <- arr.get(i)) {
                    if (let Some(o) <- RemoteIdentityStore.objectOf(item)) {
                        let deviceId = RemoteIdentityStore.strField(o, "deviceId")
                        let digest = RemoteIdentityStore.strField(o, "credentialDigest")
                        let diskRevoked = RemoteIdentityStore.boolField(o, "revoked")
                        if (deviceId.size > 0 && digest.size > 0) {
                            if (let Some(scopes) <- RemoteIdentityStore.stringSetField(o, "scopes")) {
                                if (let Some(existing) <- devices.get(deviceId)) {
                                    if (propagateRevoked && diskRevoked) { existing.revoked = true }
                                    // 权限只经显式授予增加；旧快照不能删除已授 scope。
                                    for (scope in scopes) { existing.scopes.add(scope) }
                                } else {
                                    let record = DeviceRecord(
                                        deviceId, RemoteIdentityStore.strField(o, "principalId"), digest,
                                        RemoteIdentityStore.strField(o, "kind"), "")
                                    record.revoked = diskRevoked
                                    for (scope in scopes) { record.scopes.add(scope) }
                                    devices.add(deviceId, record)
                                }
                            } else {
                                // scopes 缺失兼容旧 v2 快照；存在但形状错误则拒绝该快照。
                                return -1
                            }
                        }
                    } else {
                        return -1
                    }
                }
                i += 1
            }
            return seen
        }
        return -1
    }

    // 带外改动后的增量刷新：磁盘快照内容真变过才解析，稳态下每次认证只多读一个小文件。
    // 返回 true 表示「读了并合进了新内容」。
    public func refreshFromDisk(path: String): Bool {
        if (path.size == 0) { return false }
        let p = Path(path)
        if (!exists(p)) { return false }
        let text = try { String.fromUtf8(File.readFrom(p)) } catch (_: Exception) { return false }
        if (text == snapshotCacheText) { return false }
        let root = try { JsonValue.fromStr(text).asObject() } catch (_: Exception) { return false }
        lock.lock()
        let seen = mergeDevicesLocked(root, propagateRevoked: true)
        var diskVersion = revocationVersion
        if (let Some(node) <- root.get("revocationVersion")) {
            diskVersion = try { node.asInt().getValue() } catch (_: Exception) { revocationVersion }
        }
        if (diskVersion > revocationVersion) { revocationVersion = diskVersion }
        if (seen >= Int64(0)) { snapshotCacheText = text }
        lock.unlock()
        return seen >= Int64(0)
    }

    // 票据合入（须持锁调用）。同键已存在时 consumed 只单调地从 false 变 true，
    // 不会因为另一进程手上的旧快照把已消费票据复活。
    func mergeEnrollmentsLocked(root: JsonObject): Unit {
        if (let Some(node) <- root.get("enrollments")) {
            var arr = JsonArray()
            let isArr = try { arr = node.asArray(); true } catch (_: Exception) { false }
            if (isArr) {
                var j: Int64 = 0
                while (j < arr.size()) {
                    if (let Some(item) <- arr.get(j)) {
                        if (let Some(o) <- RemoteIdentityStore.objectOf(item)) {
                            let digest = RemoteIdentityStore.strField(o, "digest")
                            if (digest.size > 0) {
                                let absExpiry = try {
                                    o.get("expiresAtUnixMs").getOrThrow().asInt().getValue()
                                } catch (_: Exception) { Int64(0) }
                                let consumed = RemoteIdentityStore.boolField(o, "consumed")
                                if (let Some(existing) <- enrollments.get(digest)) {
                                    if (consumed) { existing.consumed = true }
                                } else {
                                    let restored = EnrollmentSecret("",
                                        RemoteIdentityStore.strField(o, "principalId"),
                                        toStoreRelative(absExpiry))
                                    restored.consumed = consumed
                                    enrollments.add(digest, restored)
                                }
                            }
                        }
                    }
                    j += 1
                }
            }
        }
    }

    // 受理登记前把本地管理入口新建的票据读进来。只合入票据，不动设备与令牌，
    // 因此不会把 daemon 自己刚发的设备状态回退成旧快照的样子。
    public func reloadTicketsFrom(path: String): Unit {
        let p = Path(path)
        if (!exists(p)) { return }
        let text = try { String.fromUtf8(File.readFrom(p)) } catch (_: Exception) { return }
        let root = try { JsonValue.fromStr(text).asObject() } catch (_: Exception) { return }
        lock.lock()
        mergeEnrollmentsLocked(root)
        lock.unlock()
    }

    // 本地管理入口（设计 §4.2：由目标端本地管理入口创建登记秘密）。
    // 建票 + 落盘一次做完；返回值里的 secret 原文只在这里出现一次，
    // 快照里存的是它的摘要。落盘失败要抛——「票据只在内存里、
    // daemon 永远看不见」比直接报错更难诊断。
    public func createTicketForManagement(principalId: String, path: String): EnrollmentSecret {
        let secret = createEnrollmentSecret(principalId)
        if (!saveSnapshot(path)) { throw Exception("enrollment-ticket-unpersistable") }
        return secret
    }

    // asObject() 对非对象形状是**抛异常**而不是回 Option，快照里一行坏了不该
    // 让整份恢复崩掉，所以收成 Option 由调用方决定是「跳过」还是「判整份不可用」。
    static func objectOf(item: JsonValue): Option<JsonObject> {
        var out: Option<JsonObject> = None
        let parsed = try { out = Some(item.asObject()); true } catch (_: Exception) { false }
        return if (parsed) { out } else { None }
    }

    static func strField(obj: JsonObject, name: String): String {
        if (let Some(v) <- obj.get(name)) {
            return try { v.asString().getValue() } catch (_: Exception) { "" }
        }
        return ""
    }

    // 旧 v2 设备行没有 scopes 时按零权限恢复；字段存在时必须是非空字符串数组，
    // 避免把损坏的授权快照误读成权限或静默丢弃配置。
    static func stringSetField(obj: JsonObject, name: String): Option<HashSet<String>> {
        let out = HashSet<String>()
        if (let Some(node) <- obj.get(name)) {
            var arr = JsonArray()
            let isArr = try { arr = node.asArray(); true } catch (_: Exception) { false }
            if (!isArr) { return None }
            var i: Int64 = 0
            while (i < arr.size()) {
                if (let Some(item) <- arr.get(i)) {
                    var scope = ""
                    let isString = try { scope = item.asString().getValue(); true } catch (_: Exception) { false }
                    if (!isString || scope.size == 0) { return None }
                    out.add(scope)
                } else { return None }
                i += 1
            }
        }
        return Some(out)
    }

    static func boolField(obj: JsonObject, name: String): Bool {
        if (let Some(v) <- obj.get(name)) {
            return try { v.asBool().getValue() } catch (_: Exception) { false }
        }
        return false
    }
}
