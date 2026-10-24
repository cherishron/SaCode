package com.sa.demo.feature.home

import kotlin.test.Test
import kotlin.test.assertEquals

class HomeTabsRouteTest {
    @Test fun devices_tab_routes_to_safe_remote_page() {
        assertEquals("RemoteDevicesPage", HomeTabs.routeOf(HomeTabs.DEVICES))
    }
}
