package com.sa.demo.feature.home

import com.sa.demo.agent.AgentRegistry
import com.sa.demo.agent.InMemoryAgentRegistryStore
import com.sa.demo.feature.agent.RemoteDevicesPage
import com.sa.demo.storage.SecureStore
import com.sa.demo.storage.SecureStores
import com.tencent.kuikly.core.base.DeclarativeBaseView
import com.tencent.kuikly.core.base.ViewContainer
import com.tencent.kuikly.core.manager.BridgeManager
import com.tencent.kuikly.core.manager.PagerManager
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class RemoteDevicesEntryTest {
    private class MemoryStore : SecureStore {
        val values = mutableMapOf<String, String>()
        override fun getString(key: String) = values[key]
        override fun putString(key: String, value: String) { values[key] = value }
        override fun remove(key: String) { values.remove(key) }
        override fun clear() { values.clear() }
    }

    @AfterTest fun cleanup() {
        BridgeManager.currentPageId = ""
        AgentRegistry.bindStore(InMemoryAgentRegistryStore())
    }

    @Suppress("DEPRECATION")
    private fun render(store: SecureStore): RemoteDevicesPage {
        SecureStores.init(store)
        AgentRegistry.bindStore(InMemoryAgentRegistryStore())
        val page = RemoteDevicesPage()
        BridgeManager.currentPageId = "sacode-entry-test"
        PagerManager.registerPageRouter("SaCodeEntryTest") { page }
        PagerManager.createPager("sacode-entry-test", "SaCodeEntryTest", "{\"width\":360,\"height\":640}")
        return page
    }

    private fun texts(root: DeclarativeBaseView<*, *>): List<String> = buildList {
        (root.getViewAttr().getProp("text") as? String)?.let { add(it) }
        if (root is ViewContainer<*, *>) repeat(root.childrenSize()) { addAll(texts(root.getChild(it))) }
    }

    @Test fun unauthenticated_install_opens_pairing_and_does_not_require_idp() {
        val store = MemoryStore()
        val page = render(store)
        assertTrue("SaCode · 连接电脑" in texts(page))
        assertEquals("暂无绑定", page.devicesText)
        assertTrue(texts(page).any { it.contains("无需手机号或 saai 账号") })
        assertFalse(texts(page).any { it == "对话" || it == "我的" || it == "手机号" || it == "验证码" })
        assertEquals(1, store.values.size, "启动只创建本机档案，不伪造登录或登记凭据")
        page.enrollmentSecret = "synthetic-ticket"
        assertTrue("synthetic-ticket" in texts(page))
        page.enrollmentSecret = ""
        assertFalse("synthetic-ticket" in texts(page), "清票必须同步清除输入控件，不保留初次捕获值")
        page.enroll()
        assertEquals("请填写电脑端提供的 workspaceId", page.status)
        assertFalse(page.busy)
        page.connect()
        assertEquals("请先登记或选择已有绑定", page.status)
    }

    @Test fun unavailable_storage_displays_failure_without_requesting_legacy_login() {
        val store = object : SecureStore {
            override fun getString(key: String): String? = null
            override fun putString(key: String, value: String) = Unit
            override fun remove(key: String) = Unit
            override fun clear() = Unit
        }
        val page = render(store)
        assertTrue(page.status.contains("无法安全保存绑定"))
        page.enroll()
        assertEquals("本机设备档案不可用，请重新打开应用", page.status)
        assertFalse(page.busy)
    }
}
