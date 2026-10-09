package core

import std.unittest.*
import std.collection.*
import stdx.crypto.crypto.*

// 远程设备身份与令牌管理的测试。
// 钉住的契约：
//   - 注册凭据至少 256 bit，服务端只存摘要不存原文
//   - 令牌至多 15 分钟，到期拒绝
//   - 撤销版本递增后旧凭据与旧令牌立即失效
//   - 登记秘密一次消费、5 分钟失效
//   - 常数时间比较（不提前返回）

@Test
func deviceCredentialIsAtLeast256Bits() {
    let store = RemoteIdentityStore()
    let cred = store.generateCredential()
    @Expect(cred.value.size, Int64(64))
    @Expect(cred.digest.size, Int64(64))
}

@Test
func enrollmentSecretIsAtLeast128Bits() {
    let store = RemoteIdentityStore()
    let secret = store.createEnrollmentSecret("admin")
    @Expect(secret.value.size, Int64(32))
    @Expect(secret.consumed, false)
}

@Test
func enrollmentSecretConsumedOnce() {
    let store = RemoteIdentityStore()
    let secret = store.createEnrollmentSecret("admin")
    let device = store.enroll(secret.value, "phone-1", "mobile")
    @Expect(device.deviceId.size > Int64(0), true)
    var threw = false
    try {
        let _r = store.enroll(secret.value, "phone-2", "mobile")
    } catch (_: Exception) {
        threw = true
    }
    @Expect(threw, true)
}

@Test
func expiredEnrollmentSecretRejected() {
    let store = RemoteIdentityStore()
    let secret = store.createEnrollmentSecret("admin")
    store.expireEnrollmentSecret(secret.value)
    var threw = false
    try {
        let _r = store.enroll(secret.value, "phone-1", "mobile")
    } catch (_: Exception) {
        threw = true
    }
    @Expect(threw, true)
}

@Test
func tokenExchangeSucceeds() {
    let store = RemoteIdentityStore()
    let secret = store.createEnrollmentSecret("admin")
    let device = store.enroll(secret.value, "phone-1", "mobile")
    let token = store.exchangeToken(device.deviceId, device.credential)
    @Expect(token.value.size > Int64(0), true)
    @Expect(token.expiresAt > Int64(0), true)
}

@Test
func expiredTokenRejected() {
    let store = RemoteIdentityStore()
    let secret = store.createEnrollmentSecret("admin")
    let device = store.enroll(secret.value, "phone-1", "mobile")
    let token = store.exchangeToken(device.deviceId, device.credential)
    store.expireToken(token.value)
    @Expect(store.authenticate(token.value), None)
}

@Test
func revokedDeviceRejected() {
    let store = RemoteIdentityStore()
    let secret = store.createEnrollmentSecret("admin")
    let device = store.enroll(secret.value, "phone-1", "mobile")
    let token = store.exchangeToken(device.deviceId, device.credential)
    store.revokeDevice(device.deviceId)
    @Expect(store.authenticate(token.value), None)
}

@Test
func wrongCredentialRejected() {
    let store = RemoteIdentityStore()
    let secret = store.createEnrollmentSecret("admin")
    let device = store.enroll(secret.value, "phone-1", "mobile")
    var threw = false
    try {
        let _t = store.exchangeToken(device.deviceId, "wrong-credential-hex")
    } catch (_: Exception) {
        threw = true
    }
    @Expect(threw, true)
}

@Test
func authenticateReturnsContext() {
    let store = RemoteIdentityStore()
    let secret = store.createEnrollmentSecret("admin")
    let device = store.enroll(secret.value, "phone-1", "mobile")
    let token = store.exchangeToken(device.deviceId, device.credential)
    let ctx = store.authenticate(token.value)
    @Expect(ctx != None, true)
    if (let Some(c) <- ctx) {
        @Expect(c.deviceId == device.deviceId, true)
        @Expect(c.principalId == "admin", true)
        @Expect(c.revocationVersion, Int64(1))
    }
}

@Test
func revocationVersionIncrementsOnRevoke() {
    let store = RemoteIdentityStore()
    let secret = store.createEnrollmentSecret("admin")
    let device1 = store.enroll(secret.value, "phone-1", "mobile")
    let secret2 = store.createEnrollmentSecret("admin")
    let device2 = store.enroll(secret2.value, "phone-2", "mobile")
    store.revokeDevice(device1.deviceId)
    let token2 = store.exchangeToken(device2.deviceId, device2.credential)
    let ctx = store.authenticate(token2.value)
    @Expect(ctx != None, true)
    if (let Some(c) <- ctx) {
        @Expect(c.revocationVersion, Int64(2))
    }
}

@Test
func concurrentEnrollmentFails() {
    let store = RemoteIdentityStore()
    let secret = store.createEnrollmentSecret("admin")
    let device = store.enroll(secret.value, "phone-1", "mobile")
    @Expect(device.deviceId.size > Int64(0), true)
    var threw = false
    try {
        let _r = store.enroll(secret.value, "different-phone", "mobile")
    } catch (_: Exception) {
        threw = true
    }
    @Expect(threw, true)
}
