package com.sa.demo.feature.home

/** 正式路由仅开放受保护的 SaCode 设备入口；迁入的旧页不进入产品导航。 */
object ProductRoutes {
    const val START_PAGE = "RemoteDevicesPage"

    fun resolve(requestedPage: String): String = when (requestedPage) {
        START_PAGE -> START_PAGE
        else -> START_PAGE
    }
}
