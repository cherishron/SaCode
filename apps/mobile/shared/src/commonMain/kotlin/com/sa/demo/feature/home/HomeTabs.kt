package com.sa.demo.feature.home

import com.sa.demo.core.platform.PageRouterBridge
import com.sa.demo.saui.SaUIComponents
import com.sa.demo.saui.navigation.SaTabBar
import com.tencent.kuikly.core.base.ViewBuilder

/** 迁入页面仍引用此组件；旧页签统一收敛到 SaCode 受保护入口，不再跳转网关/IdP。 */
object HomeTabs {

    const val CHAT = "chat"
    const val DEVICES = "devices"
    const val ACCOUNT = "account"

    /** Tab 标识 → 页面路由名。 */
    fun routeOf(tab: String): String = when (tab) {
        DEVICES -> ProductRoutes.START_PAGE
        else -> ProductRoutes.START_PAGE
    }

    /**
     * 渲染底部导航。
     *
     * @param selected 当前页签；点击已选中的页签不做任何事（避免无意义重建）
     */
    fun build(selected: String): ViewBuilder = {
        SaTabBar.build(
            items = listOf(
                SaTabBar.TabItem(DEVICES, "设备", SaUIComponents.Icons.USER),
            ),
            selectedKey = selected,
            onSelect = { key ->
                if (key != selected) PageRouterBridge.open(routeOf(key))
            },
        ).invoke(this)
    }
}
