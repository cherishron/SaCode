package core

import std.collection.*
import std.sync.*
import std.time.*
import stdx.crypto.crypto.*
import stdx.encoding.hex.*

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
    public let credentialDigest: String
    public let kind: String
    // 注册响应一次性交付给调用方的凭据原文；store 内部不落这个字段，
    // 只落 credentialDigest。生产路径由 TLS 客户端注册通道原样送出。
    public let credential: String
    public var revoked: Bool = false
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

public class AuthenticationContext {
    public let deviceId: String
    public let principalId: String
    public let revocationVersion: Int64
    public init(deviceId: String, principalId: String, revocationVersion: Int64) {
        this.deviceId = deviceId
        this.principalId = principalId
        this.revocationVersion = revocationVersion
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
    // 登记秘密按 value 索引；兑换后 consumed=true 或 expiresAt 在过去即失效。
    let enrollments = HashMap<String, EnrollmentSecret>()
    // 设备按 deviceId 索引；credentialDigest 用于验证兑换请求的凭据原文。
    let devices = HashMap<String, DeviceRecord>()
    // 令牌按 value 索引；authenticate 检查过期、revocationVersion 与设备状态。
    let tokens = HashMap<String, AccessToken>()
    // 撤销版本号：每次 revokeDevice 递增；旧版本令牌一律拒绝。
    var revocationVersion: Int64 = 1
    var nextDeviceId: Int64 = 1

    public init() {}

    func nowMs(): Int64 {
        return (MonoTime.now() - base).toMilliseconds()
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
        enrollments.add(secret.value, secret)
        lock.unlock()
        return secret
    }

    // 测试辅助：把指定登记秘密的到期时间改到过去。
    public func expireEnrollmentSecret(value: String): Unit {
        lock.lock()
        if (let Some(s) <- enrollments.get(value)) {
            s.expiresAt = nowMs() - Int64(1)
        }
        lock.unlock()
    }

    // 用登记秘密兑换设备记录：一次性消费 + 5 分钟窗口 + 服务端生成设备凭据。
    // 返回的 DeviceRecord 里 credentialDigest 是服务端存储形态；对应原文
    // 只在调用返回那一刻在 DeviceCredential.value 里出现一次，不再落盘。
    public func enroll(secretValue: String, deviceName: String, kind: String): DeviceRecord {
        lock.lock()
        if (let Some(enrollment) <- enrollments.get(secretValue)) {
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
            tokens.add(token.value, token)
            lock.unlock()
            return token
        }
        lock.unlock()
        throw Exception("device-not-found")
    }

    // 测试辅助：把令牌到期时间改到过去。
    public func expireToken(value: String): Unit {
        lock.lock()
        if (let Some(t) <- tokens.get(value)) {
            t.expiresAt = nowMs() - Int64(1)
        }
        lock.unlock()
    }

    // 撤销设备：标记 revoked，递增全局撤销版本；旧版本令牌立刻失效。
    public func revokeDevice(deviceId: String): Unit {
        lock.lock()
        if (let Some(d) <- devices.get(deviceId)) {
            d.revoked = true
        }
        revocationVersion += 1
        lock.unlock()
    }

    // 认证：返回给请求处理器的最小上下文。任何一步不通过都返回 None，
    // 不区分原因（不泄漏「设备存在但被撤销」这类状态）。
    public func authenticate(tokenValue: String): Option<AuthenticationContext> {
        lock.lock()
        if (let Some(token) <- tokens.get(tokenValue)) {
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
                let ctx = AuthenticationContext(token.deviceId, device.principalId, revocationVersion)
                lock.unlock()
                return Some(ctx)
            }
        }
        lock.unlock()
        return None
    }
}
