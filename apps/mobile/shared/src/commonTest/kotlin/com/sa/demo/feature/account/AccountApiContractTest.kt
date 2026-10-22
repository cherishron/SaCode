package com.sa.demo.feature.account

import com.sa.demo.auth.saaiJson
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * 锁住 sa-idp 身份接口的响应契约。
 *
 * 样本 JSON 直接摘自 `sa-idp/backend/src/identity/` 的实际 `json!` 字段，
 * 不是照文档推测——字段名写错在这里会静默显示空值，比编译错误更难发现。
 */
class AccountApiContractTest {

    private fun <T> decode(body: String, k: kotlinx.serialization.KSerializer<T>): T =
        saaiJson.decodeFromString(k, body)

    @Test
    fun profile_parses_actual_me_payload() {
        // profile.rs:86-113 的字段集合
        val body = """
        {
          "user_id": 42,
          "username": "alice",
          "name": "爱丽丝",
          "phone": "13800000000",
          "phone_masked": "138****0000",
          "phone_verified": true,
          "email": "a@example.com",
          "email_masked": "a****@example.com",
          "email_verified": false,
          "role": "user",
          "account_type": "personal",
          "register_source": "sms",
          "status": "active",
          "session_epoch": 3,
          "has_password": true,
          "need_phone": false,
          "bindings": [
            {"provider":"github","app_id":"gh-1","external_id_masked":"ab****yz","union_id_masked":null}
          ],
          "sso_available": [{"id":"github","name":"GitHub","enabled":true,"status":"ok"}],
          "sms_channel": "fake",
          "login_paths": ["password","sms","wechat_qrconnect","sso_github","sso_gitee"]
        }
        """.trimIndent()
        val p = decode(body, AccountApi.Profile.serializer())

        assertEquals("42", p.userId, "user_id 服务端是数字，客户端按字符串存更安全")
        assertEquals("alice", p.username)
        assertEquals("138****0000", p.phoneMasked)
        assertTrue(p.phoneVerified)
        assertFalse(p.emailVerified)
        assertEquals(3L, p.sessionEpoch)
        assertTrue(p.hasPassword)
        assertFalse(p.needPhone)
        assertEquals(1, p.bindings.size)
        assertEquals("github", p.bindings[0].provider)
        assertEquals("ab****yz", p.bindings[0].externalIdMasked)
        assertNull(p.bindings[0].unionIdMasked, "union_id 可能为 null，模型必须容忍")
        assertEquals("GitHub", p.ssoAvailable[0].name)
        assertTrue(p.loginPaths.contains("password"))
    }

    @Test
    fun profile_tolerates_missing_optional_fields() {
        // 服务端加/减字段都不该让 App 崩——saaiJson 配了 ignoreUnknownKeys
        val p = decode("""{"user_id":1}""", AccountApi.Profile.serializer())
        assertEquals("1", p.userId)
        assertTrue(p.bindings.isEmpty())
        assertFalse(p.hasPassword)
    }

    @Test
    fun profile_display_name_falls_back_through_candidates() {
        val named = decode("""{"user_id":1,"name":"小明","username":"x"}""", AccountApi.Profile.serializer())
        assertEquals("小明", named.displayName, "name 优先")

        val onlyUser = decode("""{"user_id":1,"username":"x"}""", AccountApi.Profile.serializer())
        assertEquals("x", onlyUser.displayName, "无 name 时用 username")

        val onlyPhone = decode("""{"user_id":1,"phone_masked":"138****0000"}""", AccountApi.Profile.serializer())
        assertEquals("138****0000", onlyPhone.displayName, "再退到脱敏手机号")

        val none = decode("""{"user_id":1}""", AccountApi.Profile.serializer())
        assertEquals("未命名用户", none.displayName)
    }

    @Test
    fun devices_parses_actual_devices_payload() {
        // devices.rs:154-169
        val body = """
        {
          "user_id": 42,
          "count": 2,
          "devices": [
            {"id":7,"device_id_masked":"dev****01","client_type":"saapp_android",
             "platform":"android","device_name":"Pixel 8","last_active_at":"2026-10-09T12:00:00+08:00","status":"active"},
            {"id":9,"device_id_masked":"dev****02","client_type":"sa-code","platform":"windows",
             "device_name":"工作机","last_active_at":null,"status":"active"}
          ]
        }
        """.trimIndent()
        val list = decode(body, AccountApi.DeviceList.serializer())

        assertEquals(2, list.count)
        assertEquals(2, list.devices.size)
        val first = list.devices[0]
        // 撤销用的是数字 id，不是打码后的 device_id（devices.rs:221 回显 device_pk）
        assertEquals("7", first.id)
        assertEquals("dev****01", first.deviceIdMasked)
        assertEquals("android", first.platform)
        assertEquals("Pixel 8", first.displayName)
        assertEquals("2026-10-09T12:00:00+08:00", first.lastActiveAt)
        assertNull(list.devices[1].lastActiveAt, "last_active_at 可为 null")
    }

    @Test
    fun device_display_name_falls_back_when_name_absent() {
        val d = decode("""{"id":1,"platform":"linux","device_id_masked":"dev****09"}""", AccountApi.Device.serializer())
        assertEquals("linux", d.displayName)
        val bare = decode("""{"id":1,"device_id_masked":"dev****09"}""", AccountApi.Device.serializer())
        assertEquals("dev****09", bare.displayName)
        val empty = decode("""{"id":1}""", AccountApi.Device.serializer())
        assertEquals("未知设备", empty.displayName)
    }

    @Test
    fun error_detail_prefers_detail_then_title_then_message() {
        // login_wechat.rs:38-43 的 401 错误体
        val withDetail = com.sa.demo.core.platform.HttpResponse(
            401,
            """{"type":"urn:sa-idp:error:unauthorized","title":"unauthorized","status":401,"detail":"令牌无效"}""",
        )
        assertEquals("令牌无效", AccountApi.errorDetail(withDetail))

        val onlyTitle = com.sa.demo.core.platform.HttpResponse(400, """{"title":"bad request"}""")
        assertEquals("bad request", AccountApi.errorDetail(onlyTitle))

        // 网关返回 HTML/空体时不能崩，要有兜底
        val garbage = com.sa.demo.core.platform.HttpResponse(502, "<html>502</html>")
        assertEquals("HTTP 502", AccountApi.errorDetail(garbage))
    }
}
