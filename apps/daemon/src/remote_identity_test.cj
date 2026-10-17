package daemon
import core.*

import std.env.*
import std.fs.*
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
    @Expect(store.authenticate(token.value).isNone(), true)
}

@Test
func revokedDeviceRejected() {
    let store = RemoteIdentityStore()
    let secret = store.createEnrollmentSecret("admin")
    let device = store.enroll(secret.value, "phone-1", "mobile")
    let token = store.exchangeToken(device.deviceId, device.credential)
    store.revokeDevice(device.deviceId)
    @Expect(store.authenticate(token.value).isNone(), true)
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
    @Expect(ctx.isSome(), true)
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
    @Expect(ctx.isSome(), true)
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

// ==== 快照持久面（设计 §4.1「实例身份与已登记设备重启不变」）====
// 只验公开行为：落盘→重载→继续用。快照内容单独扫一遍，证明里面没有任何原文。

func snapPath(name: String): String {
    return "${getTempDirectory().toString()}/sa-id-${name}.json"
}

func dropSnap(name: String): Unit {
    let p = Path(snapPath(name))
    if (exists(p)) { try { remove(p, recursive: false) } catch (_: Exception) {} }
}

@Test
func devicesSurviveSnapshotRoundTrip() {
    // 注册一台设备并落盘，交给「另一个进程」形状的干净 store：
    // 它没参与注册，必须仍能凭当初发给设备的凭据换出可用令牌。
    let name = "rt1"
    dropSnap(name)
    let a = RemoteIdentityStore()
    let secret = a.createEnrollmentSecret("p-1")
    let device = a.enroll(secret.value, "dev-rt", "mobile")
    @Expect(a.saveSnapshot(snapPath(name)), true)

    let b = RemoteIdentityStore()
    @Expect(b.loadSnapshot(snapPath(name)), true)
    let token = b.exchangeToken(device.deviceId, device.credential)
    @Expect(token.deviceId == device.deviceId, true)
    let ctx = b.authenticate(token.value)
    @Expect(ctx.isSome(), true)
    dropSnap(name)
}

@Test
func snapshotCarriesNoPlaintextCredentialSecretOrToken() {
    // 这是把 enrollments/tokens 从「按原文索引」改成「按摘要索引」的真正理由：
    // 只要 store 里还存在可还原的原文，任何形式的持久化都是长期可用的凭据堆积。
    let name = "rt2"
    dropSnap(name)
    let a = RemoteIdentityStore()
    let secret = a.createEnrollmentSecret("p-2")
    let device = a.enroll(secret.value, "dev-scan", "desktop")
    let token = a.exchangeToken(device.deviceId, device.credential)
    let text = a.snapshotText()
    @Expect((text.indexOf(device.credential) ?? Int64(-1)) == Int64(-1), true)
    @Expect((text.indexOf(token.value) ?? Int64(-1)) == Int64(-1), true)
    @Expect((text.indexOf(secret.value) ?? Int64(-1)) == Int64(-1), true)
    // 摘要必须在，否则重载后无法校验凭据。
    @Expect((text.indexOf(device.credentialDigest) ?? Int64(-1)) >= Int64(0), true)
    dropSnap(name)
}

@Test
func ticketFromAnotherProcessIsConsumableButTokensAreNotPersisted() {
    // 本地管理入口（另一个进程形状的 store）建的票，必须能被 daemon 侧 store 消费；
    // 同时访问令牌仍然只活在本进程内存里——重启后必须重新兑换。
    let name = "rt3"
    dropSnap(name)
    let mgr = RemoteIdentityStore()
    let pending = mgr.createTicketForManagement("p-3", snapPath(name))
    // 快照里只有票据摘要，没有原文。
    let text = mgr.snapshotText()
    @Expect((text.indexOf(pending.value) ?? Int64(-1)) == Int64(-1), true)
    @Expect((text.indexOf(sha256Hex(pending.value.toArray())) ?? Int64(-1)) >= Int64(0), true)

    let daemonStore = RemoteIdentityStore()
    daemonStore.reloadTicketsFrom(snapPath(name))
    let device = daemonStore.enroll(pending.value, "dev-x", "mobile")
    @Expect(device.deviceId.size > Int64(0), true)
    let token = daemonStore.exchangeToken(device.deviceId, device.credential)
    @Expect(daemonStore.saveSnapshot(snapPath(name)), true)

    // 令牌不落盘：重启后的 store 认不得旧令牌，但同一凭据能再换一张。
    let after = RemoteIdentityStore()
    @Expect(after.loadSnapshot(snapPath(name)), true)
    @Expect(after.authenticate(token.value).isNone(), true)
    let fresh = after.exchangeToken(device.deviceId, device.credential)
    @Expect(fresh.value.size > Int64(0), true)
    dropSnap(name)
}

@Test
func consumedTicketDoesNotResurrectAcrossReload() {
    // consumed 必须单调：另一进程手上的旧快照不能把已消费票据变回未消费。
    let name = "rt6"
    dropSnap(name)
    let a = RemoteIdentityStore()
    let t = a.createTicketForManagement("p-6", snapPath(name))
    let d = a.enroll(t.value, "dev-once", "mobile")
    @Expect(a.saveSnapshot(snapPath(name)), true)
    let snapshotAfterUse = a.snapshotText()
    @Expect((snapshotAfterUse.indexOf("\"consumed\":true") ?? Int64(-1)) >= Int64(0), true)

    let b = RemoteIdentityStore()
    b.reloadTicketsFrom(snapPath(name))
    let threw = try {
        b.enroll(t.value, "hijack", "mobile")
        false
    } catch (_: Exception) { true }
    @Expect(threw, true)
    // 真设备没被弄坏：持有设备的那一侧、以及走「完整恢复」的那一侧都还认它。
    let tok = a.exchangeToken(d.deviceId, d.credential)
    @Expect(a.authenticate(tok.value).isSome(), true)
    let full = RemoteIdentityStore()
    @Expect(full.loadSnapshot(snapPath(name)), true)
    let restored = full.exchangeToken(d.deviceId, d.credential)
    @Expect(full.authenticate(restored.value).isSome(), true)
    // 反向对照：reloadTicketsFrom 只合票据、不动设备表——否则 daemon 自己刚发的
    // 设备状态会被另一进程手上的旧快照回退掉。
    var onlyTickets = false
    let notKnown = try {
        b.exchangeToken(d.deviceId, d.credential)
        false
    } catch (e: Exception) { onlyTickets = e.message == "device-not-found"; true }
    @Expect(notKnown && onlyTickets, true)
    dropSnap(name)
}

@Test
func createTicketForManagementFailsLoudWhenSnapshotUnwritable() {
    // 建票后落不了盘必须抛：否则票据只在本进程内存里，
    // daemon 永远看不见，症状是「票据有效却总是 401」，极难诊断。
    let a = RemoteIdentityStore()
    let threw = try {
        a.createTicketForManagement("p-7",
            "${getTempDirectory().toString()}/no-such-dir-9f3a/tickets.json")
        false
    } catch (_: Exception) { true }
    @Expect(threw, true)
}

@Test
func crossProcessTicketUsesAbsoluteExpiryNotStoreRelativeClock() {
    // 跨进程到期口径：快照里的到期必须是**绝对 unix 毫秒**。
    // 手写一份数字很小的快照：300000 按「本 store 相对毫秒」读是「还有 5 分钟」，
    // 按 unix 毫秒读是 1970 年，早已过期。恢复端必须判过期，否则建票进程写下的
    // 窗口会被恢复端凭空延长。
    let name = "rt8"
    dropSnap(name)
    let secret = "0123456789abcdef0123456789abcdef"
    let digest = sha256Hex(secret.toArray())
    let crafted = "{\"snapshotVersion\":2,\"revocationVersion\":0,\"nextDeviceId\":1,"
        + "\"devices\":[],\"enrollments\":[{\"digest\":\"${digest}\","
        + "\"principalId\":\"p-8\",\"expiresAtUnixMs\":300000,\"consumed\":false}]}"
    @Expect(try { File.writeTo(Path(snapPath(name)), crafted.toArray()); true }
        catch (_: Exception) { false }, true)
    let b = RemoteIdentityStore()
    b.reloadTicketsFrom(snapPath(name))
    var reason = ""
    let threwOld = try { b.enroll(secret, "late", "mobile"); false }
        catch (e: Exception) { reason = e.message; true }
    @Expect(threwOld, true)
    // 归因必须是「已过期」而不是「票据不存在」：后者意味着合入压根没发生，
    // 那这条断言会因为完全无关的原因假绿。
    @Expect(reason == "enrollment-expired", true)

    // 对照：同一份路径换成管理入口自己写的真·绝对到期，必须登记成功，
    // 证明上面拒的是到期口径而不是快照形状不合。
    let a = RemoteIdentityStore()
    let t = a.createTicketForManagement("p-8b", snapPath(name))
    let c = RemoteIdentityStore()
    c.reloadTicketsFrom(snapPath(name))
    let d = c.enroll(t.value, "fresh", "mobile")
    @Expect(d.deviceId.size > Int64(0), true)
    dropSnap(name)
}

@Test
func revokedDeviceAndWatermarkSurviveReload() {
    let name = "rt4"
    dropSnap(name)
    let a = RemoteIdentityStore()
    let s1 = a.createEnrollmentSecret("p-4")
    let d1 = a.enroll(s1.value, "dev-rev", "mobile")
    let t1 = a.exchangeToken(d1.deviceId, d1.credential)
    a.revokeDevice(d1.deviceId)
    let s2 = a.createEnrollmentSecret("p-4")
    let d2 = a.enroll(s2.value, "dev-rev", "mobile")
    @Expect(a.saveSnapshot(snapPath(name)), true)

    let b = RemoteIdentityStore()
    @Expect(b.loadSnapshot(snapPath(name)), true)
    // 撤销状态是设备记录的一部分，必须跟着回来。
    @Expect(b.authenticate(t1.value).isNone(), true)
    // 设备 id 水位也回来了，新登记不会撞上已存在的 deviceId。
    @Expect(d2.deviceId != d1.deviceId, true)
    let s3 = b.createEnrollmentSecret("p-4")
    let d3 = b.enroll(s3.value, "dev-rev", "mobile")
    @Expect(d3.deviceId != d1.deviceId, true)
    @Expect(d3.deviceId != d2.deviceId, true)
    dropSnap(name)
}

@Test
func loadSnapshotMissingOrBrokenFailsLoudNotSilentlyEmpty() {
    // 文件不存在 → false，调用方按「无历史」继续；不能返回 true 假装恢复成功。
    let a = RemoteIdentityStore()
    @Expect(a.loadSnapshot(snapPath("does-not-exist")), false)
    // 半截/非 JSON 快照同样 false，且不得把已有设备洗掉。
    let name = "rt5"
    dropSnap(name)
    let broken = try { File.writeTo(Path(snapPath(name)), "{\"devices\": notjson".toArray()); true }
        catch (_: Exception) { false }
    @Expect(broken, true)
    let b = RemoteIdentityStore()
    let s = b.createEnrollmentSecret("p-5")
    let d = b.enroll(s.value, "dev-keep", "mobile")
    @Expect(b.loadSnapshot(snapPath(name)), false)
    // 损坏快照不能让刚注册的设备消失。
    let t = b.exchangeToken(d.deviceId, d.credential)
    @Expect(t.deviceId == d.deviceId, true)
    dropSnap(name)
}

@Test
func reportedTokenWindowComesFromStoreClockAndNeverExceedsTtl() {
    // /auth/token 回给客户端的剩余窗口必须由 store 自己的钟算：引导层另有一个
    // MonoTime 基准，两个基准差 1 毫秒就会报出 900001 这种「比名义 TTL 还长」的窗口，
    // 客户端按它安排的续期点会晚于令牌真实失效点。
    let store = RemoteIdentityStore()
    let secret = store.createEnrollmentSecret("p-9")
    let device = store.enroll(secret.value, "phone-9", "mobile")
    let token = store.exchangeToken(device.deviceId, device.credential)
    let left = store.tokenRemainingMs(token)
    @Expect(left > Int64(0), true)
    @Expect(left <= Int64(900000), true)
    // 已过期必须夹到 0，不能回负数（负 TTL 会让客户端立刻进入重兑循环）。
    store.expireToken(token.value)
    @Expect(store.tokenRemainingMs(token), Int64(0))
}

@Test
func listDevicesReportsRowsWithRevokedState() {
    let name = "rt10"
    dropSnap(name)
    let store = RemoteIdentityStore()
    let t = store.createEnrollmentSecret("p-10")
    let d = store.enroll(t.value, "phone-10", "mobile")
    @Expect(store.listDevices().size, Int64(1))
    let row = store.listDevices()[0]
    @Expect(row.deviceId == d.deviceId, true)
    @Expect(row.principalId == "p-10", true)
    @Expect(row.kind == "mobile", true)
    @Expect(row.revoked, false)
    @Expect(store.revokeDevice(d.deviceId), true)
    @Expect(store.listDevices()[0].revoked, true)
    dropSnap(name)
}

@Test
func revokeUnknownDeviceReturnsFalseAndKeepsWatermark() {
    // 敲错 id 必须如实报「没这台设备」，也不能凭空递增撤销水位——
    // 递增会把所有在线令牌一起打挂，那是比报错严重得多的副作用。
    let store = RemoteIdentityStore()
    let t = store.createEnrollmentSecret("p-11")
    let d = store.enroll(t.value, "phone-11", "mobile")
    let tok = store.exchangeToken(d.deviceId, d.credential)
    @Expect(store.revokeDevice("no-such-device"), false)
    @Expect(store.authenticate(tok.value).isSome(), true)
}

@Test
func outOfBandRevokeReachesRunningStoreByRefreshFromDisk() {
    // 管理入口进程与 daemon 进程不是同一个 store：CLI 在磁盘上撤销后，
    // 在跑的 daemon 必须在下一次认证前把它吸进来，否则「已撤销」要等重启才生效。
    let name = "rt12"
    dropSnap(name)
    let daemonStore = RemoteIdentityStore()
    daemonStore.loadSnapshot(snapPath(name))
    let ticket = daemonStore.createTicketForManagement("p-12", snapPath(name))
    let device = daemonStore.enroll(ticket.value, "phone-12", "mobile")
    @Expect(daemonStore.saveSnapshot(snapPath(name)), true)
    let token = daemonStore.exchangeToken(device.deviceId, device.credential)
    @Expect(daemonStore.authenticate(token.value).isSome(), true)

    let cli = RemoteIdentityStore()
    @Expect(cli.loadSnapshot(snapPath(name)), true)
    @Expect(cli.revokeDevice(device.deviceId), true)
    @Expect(cli.saveSnapshot(snapPath(name)), true)

    @Expect(daemonStore.refreshFromDisk(snapPath(name)), true)
    @Expect(daemonStore.listDevices()[0].revoked, true)
    @Expect(daemonStore.authenticate(token.value).isNone(), true)
    dropSnap(name)
}

@Test
func refreshFromDiskSkipsReparseWhenDiskUnchanged() {
    // 每次认证都会调它：磁盘没变时必须短路，不能把「读一次快照」变成「解析一次 JSON」。
    let name = "rt13"
    dropSnap(name)
    let a = RemoteIdentityStore()
    let t = a.createTicketForManagement("p-13", snapPath(name))
    let d = a.enroll(t.value, "phone-13", "mobile")
    @Expect(a.saveSnapshot(snapPath(name)), true)
    let b = RemoteIdentityStore()
    b.loadSnapshot(snapPath(name))
    @Expect(b.refreshFromDisk(snapPath(name)), false)
    // 真变了才认：由 b 自己新登记一台设备并落盘，a 侧刷新应看到两行。
    let t2 = b.createTicketForManagement("p-13b", snapPath(name))
    b.enroll(t2.value, "phone-13c", "mobile")
    @Expect(b.saveSnapshot(snapPath(name)), true)
    @Expect(a.refreshFromDisk(snapPath(name)), true)
    @Expect(a.listDevices().size, Int64(2))
    dropSnap(name)
}
