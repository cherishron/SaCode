package daemon
import core.*

import std.collection.*
import std.env.*
import std.fs.*
import std.unittest.*

// 设计 §4：「设备列表、确认、撤销只能通过本机受保护管理入口**或具有显式管理权限的认证 RPC**」
// 以及「设备凭据轮换与撤销独立」。
//
// 这一批补的是一条真实缺口：授权层的 scope 判定一直存在，但身份层没有任何地方**给出** scope，
// gate 又固定用零 scope 的视图去判——于是认证 RPC 管理面在语义上永远不可达，
// 「或具有显式管理权限的认证 RPC」这半句是空的。下列钉子按「先能授予、再能跨过快照、
// 再能进授权判定」的顺序钉，并单独钉住轮换与撤销互不牵连。

func scopeDir(name: String): String {
    let dir = "${getTempDirectory().toString()}/sa-scope-${name}"
    if (!exists(dir)) { Directory.create(dir) }
    return dir
}

func enrollDevice(store: RemoteIdentityStore, name: String, principal: String): DeviceRecord {
    return store.enroll(store.createEnrollmentSecret(principal).value, name, "desktop")
}

@Test
func defaultDeviceCarriesNoScopes() {
    // 默认零权限。「管理设备是不是天生就能管」必须是读得出来的否，而不是靠约定。
    let store = RemoteIdentityStore()
    let device = enrollDevice(store, "plain", "p-plain")
    let token = store.exchangeToken(device.deviceId, device.credential)
    let ctx = store.authenticate(token.value)
    @Expect(ctx.isSome(), true)
    @Expect(ctx.getOrThrow().scopes.size == Int64(0), true)
}

@Test
func grantedManagementScopeReachesAuthenticationContext() {
    let store = RemoteIdentityStore()
    let admin = enrollDevice(store, "admin", "p-admin")
    @Expect(store.grantScope(deviceId: admin.deviceId, scope: AUTHZ_SCOPE_MANAGEMENT), true)
    let token = store.exchangeToken(admin.deviceId, admin.credential)
    let ctx = store.authenticate(token.value)
    @Expect(ctx.isSome(), true)
    @Expect(ctx.getOrThrow().scopes.contains(AUTHZ_SCOPE_MANAGEMENT), true)
    // 授予某一台不能顺带把别台抬上去。
    let other = enrollDevice(store, "phone", "p-phone")
    let tok2 = store.exchangeToken(other.deviceId, other.credential)
    @Expect(store.authenticate(tok2.value).getOrThrow().scopes.contains(AUTHZ_SCOPE_MANAGEMENT), false)
}

@Test
func scopeGrantSurvivesSnapshotRoundTrip() {
    // 撤销能跨重启保持，授权也必须能——否则每次重启后管理员要在命令行重做一遍授予，
    // 而远程管理面会静默回到不可达。
    let path = "${scopeDir("rt")}/devices.json"
    let a = RemoteIdentityStore()
    let admin = enrollDevice(a, "rt-admin", "p-rt")
    let plain = admin.credential
    @Expect(a.grantScope(deviceId: admin.deviceId, scope: AUTHZ_SCOPE_MANAGEMENT), true)
    @Expect(a.saveSnapshot(path), true)
    let b = RemoteIdentityStore()
    @Expect(b.loadSnapshot(path), true)
    let restored = b.exchangeToken(admin.deviceId, plain)
    let ctx = b.authenticate(restored.value)
    @Expect(ctx.isSome(), true)
    @Expect(ctx.getOrThrow().scopes.contains(AUTHZ_SCOPE_MANAGEMENT), true)
    // 清单投影也带 scope：桌面的「已登记设备」面板要显示这台到底有没有管理能力。
    var hit = false
    for (d in b.listDevices()) {
        if (d.deviceId == admin.deviceId) { hit = d.scopes.contains(AUTHZ_SCOPE_MANAGEMENT) }
    }
    @Expect(hit, true)
}

@Test
func v2SnapshotWithoutScopesStillLoadsDeviceWithNoScope() {
    // 磁盘上的历史快照没有 scopes 字段。判成「解析失败」会让所有已登记设备在升级后凭空
    // 消失；判成「全部带管理权限」更是反着错。唯一正确读法：设备在，scope 为空。
    let filler = RemoteIdentityStore().generateCredential()
    let text = "{\"snapshotVersion\":2,\"revocationVersion\":0,\"nextDeviceId\":1," +
        "\"devices\":[{\"deviceId\":\"desk-1\",\"principalId\":\"p-1\"," +
        "\"credentialDigest\":\"${filler.digest}\",\"kind\":\"desktop\",\"revoked\":false}]," +
        "\"enrollments\":[]}"
    let path = "${scopeDir("v2")}/devices.json"
    @Expect(try { File.writeTo(Path(path), text.toArray()); true } catch (_: Exception) { false }, true)
    let store = RemoteIdentityStore()
    @Expect(store.loadSnapshot(path), true)
    let listed = store.listDevices()
    @Expect(Int64(listed.size), Int64(1))
    @Expect(listed[0].scopes.size == Int64(0), true)
    @Expect(store.grantScope(deviceId: "desk-1", scope: AUTHZ_SCOPE_MANAGEMENT), true)
    @Expect(store.listDevices()[0].scopes.contains(AUTHZ_SCOPE_MANAGEMENT), true)
}

@Test
func rotationInvalidatesOldCredentialAndKeepsDeviceIdentity() {
    let store = RemoteIdentityStore()
    let device = enrollDevice(store, "rot", "p-rot")
    let oldCred = device.credential
    let rotated = store.rotateCredential(device.deviceId)
    @Expect(rotated.value.size, Int64(64))
    @Expect(rotated.value == oldCred, false)
    // 旧凭据必须换不到令牌：轮换的意义就是让泄露出去的旧值失效。
    var threw = false
    try { store.exchangeToken(device.deviceId, oldCred) } catch (_: Exception) { threw = true }
    @Expect(threw, true)
    let fresh = store.exchangeToken(device.deviceId, rotated.value)
    @Expect(fresh.value.size > Int64(0), true)
    // 设备身份不漂：id 与 principal 都不该因为轮换而变，否则历史归属断了。
    let listed = store.listDevices()
    @Expect(Int64(listed.size), Int64(1))
    @Expect(listed[0].deviceId, device.deviceId)
    @Expect(listed[0].principalId, "p-rot")
}

@Test
func rotationDoesNotRevokeAndRevokedDeviceCannotRotate() {
    // §4「设备凭据轮换与撤销独立」：轮换不抬升撤销版本——否则轮换会把这台设备的全部
    // 在途令牌一次性打掉，客户端就没法平滑续期；而撤销后必须拒绝轮换，
    // 一把已经作废的设备不能靠换凭据复活。
    let store = RemoteIdentityStore()
    let device = enrollDevice(store, "indep", "p-indep")
    let token = store.exchangeToken(device.deviceId, device.credential)
    let before = store.authenticate(token.value)
    @Expect(before.isSome(), true)
    let beforeVersion = before.getOrThrow().revocationVersion
    store.rotateCredential(device.deviceId)
    let after = store.authenticate(token.value)
    @Expect(after.isSome(), true)
    @Expect(after.getOrThrow().revocationVersion, beforeVersion)
    @Expect(store.revokeDevice(device.deviceId), true)
    @Expect(store.authenticate(token.value).isSome(), false)
    var threw = false
    try { store.rotateCredential(device.deviceId) } catch (_: Exception) { threw = true }
    @Expect(threw, true)
}

@Test
func scopeGrantRejectsUnknownRevokedAndEmptyScope() {
    let store = RemoteIdentityStore()
    let device = enrollDevice(store, "grantme", "p-g")
    @Expect(store.grantScope(deviceId: "no-such-device", scope: AUTHZ_SCOPE_MANAGEMENT), false)
    @Expect(store.revokeDevice(device.deviceId), true)
    @Expect(store.grantScope(deviceId: device.deviceId, scope: AUTHZ_SCOPE_MANAGEMENT), false)
    // 空 scope 名不配拥有：授予它等于给设备加一条永远匹配不上的记录。
    let d2 = enrollDevice(store, "grantme2", "p-g2")
    @Expect(store.grantScope(deviceId: d2.deviceId, scope: ""), false)
}

@Test
func gatePassesDeviceScopeIntoAuthorizationSoManagementMethodIsReachable() {
    // 这条是本批的存在理由：授予过 scope 的设备，认证 RPC 管理面必须真的可达；
    // 没授予的必须按 scope-required 拒。缺任何一侧，「显式管理权限」都是空话。
    let store = RemoteIdentityStore()
    let sink = GateCollectSink()
    let audit = RemoteAuditLog(sink)
    let authorizer = RemoteAccessAuthorizer()
    authorizer.register(CapabilitySpec(
        method: "auth/devices", permission: AUTHZ_PERM_MANAGEMENT,
        needsWorkspace: false, needsSession: false))
    let admin = enrollDevice(store, "admin-dev", "p-scope")
    let plain = enrollDevice(store, "plain-dev", "p-plain")
    let adminToken = store.exchangeToken(admin.deviceId, admin.credential)
    let plainToken = store.exchangeToken(plain.deviceId, plain.credential)
    let gate = RemoteRequestGate(store, authorizer, audit, "inst-scope")
    // 未授予：认证过但授权拒，denied 照落审计。
    let denied = gate.check("Bearer ${plainToken.value}", "auth/devices", "", "", "op-1")
    @Expect(denied.allowed, false)
    @Expect(denied.denyReason == "scope-required", true)
    @Expect(sink.size(), Int64(1))
    // 授予：同一个方法、同一条判定链，必须放行。
    @Expect(store.grantScope(deviceId: admin.deviceId, scope: AUTHZ_SCOPE_MANAGEMENT), true)
    let allowed = gate.check("Bearer ${adminToken.value}", "auth/devices", "", "", "op-2")
    @Expect(allowed.allowed, true)
    @Expect(allowed.context.isSome(), true)
    @Expect(sink.size(), Int64(2))
}

@Test
func malformedScopeSnapshotIsRejectedWithoutGrantingOrDroppingDevice() {
    let root = scopeDir("malformed-scope")
    let path = "${root}/devices.json"
    let filler = RemoteIdentityStore().generateCredential()
    let text = "{\"snapshotVersion\":2,\"revocationVersion\":0,\"nextDeviceId\":1," +
        "\"devices\":[{\"deviceId\":\"desk-bad\",\"principalId\":\"p-bad\"," +
        "\"credentialDigest\":\"${filler.digest}\",\"kind\":\"desktop\",\"revoked\":false," +
        "\"scopes\":\"management\"}],\"enrollments\":[]}"
    @Expect(try { File.writeTo(Path(path), text.toArray()); true } catch (_: Exception) { false }, true)
    let store = RemoteIdentityStore()
    @Expect(store.loadSnapshot(path), false)
    @Expect(Int64(store.listDevices().size), Int64(0))
}