package com.sa.demo.feature.home

import kotlin.test.Test
import kotlin.test.assertEquals

class ProductRoutesTest {
    @Test fun product_entry_and_all_legacy_routes_resolve_to_protected_devices() {
        assertEquals("RemoteDevicesPage", ProductRoutes.START_PAGE)
        for (route in listOf("LoginPage", "ChatPage", "AccountPage", "AgentPage", "BindAgentPage", "unknown")) {
            assertEquals(ProductRoutes.START_PAGE, ProductRoutes.resolve(route))
        }
        for (tab in listOf(HomeTabs.CHAT, HomeTabs.DEVICES, HomeTabs.ACCOUNT, "unknown")) {
            assertEquals(ProductRoutes.START_PAGE, HomeTabs.routeOf(tab))
        }
    }
}
