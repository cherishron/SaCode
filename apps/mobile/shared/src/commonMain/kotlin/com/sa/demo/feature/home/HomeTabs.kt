package com.sa.demo.feature.home

import com.sa.demo.core.platform.PageRouterBridge
import com.sa.demo.saui.SaUIComponents
import com.sa.demo.saui.navigation.SaTabBar
import com.tencent.kuikly.core.base.ViewBuilder

/**
 * 全局底部导航（对话 / 设备 / 我的）。
 *
 * **为什么用路由切换而不是嵌套 Pager**：Kuikly 是「一路由一页」模型，
 * 没有可内嵌子 Pager 的容器组件（`body()` 直接在父容器里 `invoke` 会绕过
 * 子页自身的 created/willAppear 生命周期，observable 也绑不到子页上下文）。
 * 所以正确做法是各页自带 TabBar，切换走 `PageRouterBridge.open`。
 *
 * **切页会不会丢状态**：会重建页面实例。ChatPage 的会话已持久化到
 * `LocalHistoryRepository`，回到该页时 `bootstrap()` 会 `refreshHistory()` 恢复；
 * 草稿等瞬时态不保证保留，这是本方案的已知取舍。
 */
object HomeTabs {

    const val CHAT = "chat"
    const val DEVICES = "devices"
    const val ACCOUNT = "account"

    /** Tab 标识 → 页面路由名。 */
    fun routeOf(tab: String): String = when (tab) {
        CHAT -> "ChatPage"
        DEVICES -> "AgentPage"
        ACCOUNT -> "AccountPage"
        else -> "ChatPage"
    }

    /**
     * 渲染底部导航。
     *
     * @param selected 当前页签；点击已选中的页签不做任何事（避免无意义重建）
     */
    fun build(selected: String): ViewBuilder = {
        SaTabBar.build(
            items = listOf(
                SaTabBar.TabItem(CHAT, "对话", SaUIComponents.Icons.CHAT),
                SaTabBar.TabItem(DEVICES, "设备", SaUIComponents.Icons.USER),
                SaTabBar.TabItem(ACCOUNT, "我的", SaUIComponents.Icons.SETTINGS),
            ),
            selectedKey = selected,
            onSelect = { key ->
                if (key != selected) PageRouterBridge.open(routeOf(key))
            },
        ).invoke(this)
    }
}
