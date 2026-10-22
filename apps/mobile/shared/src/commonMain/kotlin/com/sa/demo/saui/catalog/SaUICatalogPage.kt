package com.sa.demo.saui.catalog

import com.sa.demo.saui.SaUIComponents
import com.sa.demo.saui.base.SaButton
import com.sa.demo.saui.data.SaAvatar
import com.sa.demo.saui.data.SaCell
import com.sa.demo.saui.data.SaCollapse
import com.sa.demo.saui.data.SaTag
import com.sa.demo.saui.feedback.SaDrawer
import com.sa.demo.saui.feedback.SaLoading
import com.sa.demo.saui.feedback.SaNoticeBar
import com.sa.demo.saui.feedback.SaProgress
import com.sa.demo.saui.feedback.SaResult
import com.sa.demo.saui.feedback.SaSkeleton
import com.sa.demo.saui.feedback.SaToast
import com.sa.demo.saui.form.SaInput
import com.sa.demo.saui.form.SaRadioGroup
import com.sa.demo.saui.foundation.SaBadge
import com.sa.demo.saui.navigation.SaSteps
import com.sa.demo.saui.navigation.SaTabBar
import com.sa.demo.saui.chat.ChatMessageBubble
import com.sa.demo.saui.chat.StreamingInputBar
import com.sa.demo.saui.token.SaUIColors
import com.sa.demo.saui.token.SaUIRadius
import com.sa.demo.saui.token.SaUISpacing
import com.tencent.kuikly.core.annotations.Page
import com.tencent.kuikly.core.base.Color
import com.tencent.kuikly.core.base.ViewBuilder
import com.tencent.kuikly.core.layout.FlexAlign
import com.tencent.kuikly.core.layout.FlexJustifyContent
import com.tencent.kuikly.core.pager.Pager
import com.tencent.kuikly.core.reactive.handler.observable
import com.tencent.kuikly.core.views.Scroller
import com.tencent.kuikly.core.views.Text
import com.tencent.kuikly.core.views.View
import com.tencent.kuikly.core.views.layout.Column
import com.tencent.kuikly.core.views.layout.Row
import com.sa.demo.core.platform.copyToClipboard

@Page("SaUICatalogPage")
class SaUICatalogPage : Pager() {

    var rateValue by observable(3)
    var stepperValue by observable(1)
    var selectedRadio by observable("apple")
    var checkedTerms by observable(true)
    var popupVisible by observable(false)
    var drawerVisible by observable(false)
    var collapseExpanded by observable(0)
    var bubbleStreaming by observable(false)
    var bubbleCopyHint by observable("")
    var barDraft by observable("")
    var barBusy by observable(false)
    var barStream by observable(true)
    var barModel by observable("gpt-4o-mini")
    var barSent by observable("")
    var barModelPickerOpen by observable(false)
    var barStopped by observable(false)

    override fun body(): ViewBuilder = {
        val page = this@SaUICatalogPage

        Scroller {
            attr {
                // 根容器必须 flex(1f) 才能撑满页面高度，否则高度塌陷为 0 → 白屏
                flex(1f)
                backgroundColor(Color.parseString16ToLong(SaUIColors.BgPage))
            }

            Column {
                attr { padding(SaUISpacing.lg, SaUISpacing.md, SaUISpacing.xxl, SaUISpacing.md) }

                page.sectionHeader("Base 基础").invoke(this)

                page.demoCard("Button - Primary") {
                    SaButton.build(text = "确定", variant = SaButton.Variant.PRIMARY) {}.invoke(this)
                }.invoke(this)

                page.demoCard("Button - Secondary") {
                    SaButton.build(text = "取消", variant = SaButton.Variant.SECONDARY) {}.invoke(this)
                }.invoke(this)

                page.demoCard("Button - Outline") {
                    SaButton.build(text = "编辑", variant = SaButton.Variant.PRIMARY_OUTLINE) {}.invoke(this)
                }.invoke(this)

                page.demoCard("Button - Text") {
                    SaButton.build(text = "文字", variant = SaButton.Variant.TEXT) {}.invoke(this)
                }.invoke(this)

                page.demoCard("Button - Danger") {
                    SaButton.build(text = "删除", variant = SaButton.Variant.DANGER) {}.invoke(this)
                }.invoke(this)

                page.demoCard("Button - Disabled") {
                    SaButton.build(text = "禁用", variant = SaButton.Variant.PRIMARY, disabled = true) {}.invoke(this)
                }.invoke(this)

                page.sectionHeader("Foundation 基础元素").invoke(this)

                page.demoCard("Icons 图标") {
                    Row {
                        attr { alignItems(FlexAlign.CENTER) }
                        SaUIComponents.Icon.buildChar(SaUIComponents.Icons.SEARCH).invoke(this)
                        SaUIComponents.Icon.buildChar(SaUIComponents.Icons.STAR).invoke(this)
                        SaUIComponents.Icon.buildChar(SaUIComponents.Icons.HEART).invoke(this)
                        SaUIComponents.Icon.buildChar(SaUIComponents.Icons.USER).invoke(this)
                        SaUIComponents.Icon.buildChar(SaUIComponents.Icons.HOME).invoke(this)
                    }
                }.invoke(this)

                page.demoCard("Divider") {
                    SaUIComponents.Divider.build().invoke(this)
                }.invoke(this)

                page.demoCard("Divider - 带文字") {
                    SaUIComponents.Divider.build(text = "OR").invoke(this)
                }.invoke(this)

                page.demoCard("Divider - 竖向") {
                    Row {
                        attr { height(24f); alignItems(FlexAlign.CENTER) }
                        Text { attr { text("左侧") } }
                        SaUIComponents.Divider.build(
                            direction = com.sa.demo.saui.foundation.SaDivider.Direction.VERTICAL
                        ).invoke(this)
                        Text { attr { text("右侧") } }
                    }
                }.invoke(this)

                page.demoCard("Badge - DOT") {
                    SaBadge.build(variant = SaBadge.Variant.DOT).invoke(this)
                }.invoke(this)

                page.demoCard("Badge - COUNT") {
                    SaBadge.build(text = "99+").invoke(this)
                }.invoke(this)

                page.sectionHeader("Form 表单").invoke(this)

                page.demoCard("Input") {
                    SaUIComponents.Input.build(label = "用户名", placeholder = "请输入用户名") {}.invoke(this)
                }.invoke(this)

                page.demoCard("Input - 错误态") {
                    SaUIComponents.Input.build(
                        label = "邮箱",
                        required = true,
                        placeholder = "请输入邮箱",
                        state = SaInput.InputState.ERROR,
                        errorMessage = "邮箱格式不正确"
                    ) {}.invoke(this)
                }.invoke(this)

                page.demoCard("SearchBar") {
                    SaUIComponents.SearchBar.build(value = "Kuikly", showCancel = true).invoke(this)
                }.invoke(this)

                page.demoCard("CheckBox") {
                    SaUIComponents.CheckBox.build(
                        label = "同意用户协议",
                        checked = page.checkedTerms,
                        onCheckedChanged = { page.checkedTerms = it }
                    ).invoke(this)
                }.invoke(this)

                page.demoCard("Radio") {
                    Column {
                        SaUIComponents.Radio.build(
                            label = "Apple",
                            selected = page.selectedRadio == "apple",
                            onClick = { page.selectedRadio = "apple" }
                        ).invoke(this)
                        SaUIComponents.Radio.build(
                            label = "Banana",
                            selected = page.selectedRadio == "banana",
                            onClick = { page.selectedRadio = "banana" }
                        ).invoke(this)
                        SaUIComponents.Radio.build(
                            label = "Cherry",
                            selected = page.selectedRadio == "cherry",
                            onClick = { page.selectedRadio = "cherry" }
                        ).invoke(this)
                    }
                }.invoke(this)

                page.demoCard("RadioGroup - 横向") {
                    SaUIComponents.RadioGroup.build(
                        options = listOf(
                            SaRadioGroup.RadioOption("Apple", "apple"),
                            SaRadioGroup.RadioOption("Banana", "banana"),
                            SaRadioGroup.RadioOption("Cherry", "cherry")
                        ),
                        selectedValue = page.selectedRadio,
                        direction = "horizontal",
                        onSelect = { page.selectedRadio = it }
                    ).invoke(this)
                }.invoke(this)

                page.demoCard("Stepper") {
                    SaUIComponents.Stepper.build(
                        value = page.stepperValue,
                        onChange = { page.stepperValue = it }
                    ).invoke(this)
                }.invoke(this)

                page.sectionHeader("Data 数据展示").invoke(this)

                page.demoCard("Avatar - text") {
                    SaUIComponents.Avatar.buildText(text = "MC").invoke(this)
                }.invoke(this)

                page.demoCard("Avatar - icon") {
                    SaUIComponents.Avatar.buildIcon(icon = SaUIComponents.Icons.USER).invoke(this)
                }.invoke(this)

                page.demoCard("Avatar - 6 种尺寸") {
                    Row {
                        attr { alignItems(FlexAlign.CENTER) }
                        SaUIComponents.Avatar.buildText(text = "XS", size = SaAvatar.AvatarSize.XS).invoke(this)
                        SaUIComponents.Avatar.buildText(text = "SM", size = SaAvatar.AvatarSize.SM).invoke(this)
                        SaUIComponents.Avatar.buildText(text = "MD", size = SaAvatar.AvatarSize.MD).invoke(this)
                        SaUIComponents.Avatar.buildText(text = "LG", size = SaAvatar.AvatarSize.LG).invoke(this)
                        SaUIComponents.Avatar.buildText(text = "XL", size = SaAvatar.AvatarSize.XL).invoke(this)
                        SaUIComponents.Avatar.buildText(text = "XXL", size = SaAvatar.AvatarSize.XXL).invoke(this)
                    }
                }.invoke(this)

                page.demoCard("Tag - 多色") {
                    Row {
                        SaTag.build(text = "默认").invoke(this)
                        SaTag.build(text = "主要", variant = SaTag.Variant.PRIMARY).invoke(this)
                        SaTag.build(text = "成功", variant = SaTag.Variant.SUCCESS).invoke(this)
                        SaTag.build(text = "警告", variant = SaTag.Variant.WARNING).invoke(this)
                        SaTag.build(text = "危险", variant = SaTag.Variant.DANGER).invoke(this)
                    }
                }.invoke(this)

                page.demoCard("Tag - 3 种尺寸") {
                    Row {
                        attr { alignItems(FlexAlign.CENTER) }
                        SaTag.build(text = "小", size = SaTag.TagSize.SMALL).invoke(this)
                        SaTag.build(text = "中", size = SaTag.TagSize.MEDIUM).invoke(this)
                        SaTag.build(text = "大", size = SaTag.TagSize.LARGE).invoke(this)
                    }
                }.invoke(this)

                page.demoCard("Cell") {
                    SaUIComponents.Cell.build(title = "消息通知", subtitle = "已开启", showArrow = true, onClick = {}).invoke(this)
                }.invoke(this)

                page.demoCard("Cell - Group") {
                    SaCell.buildGroup(
                        cells = listOf(
                            SaCell.CellData("账号与安全", leftIcon = SaUIComponents.Icons.USER),
                            SaCell.CellData("消息通知", rightText = "已开启"),
                            SaCell.CellData("清除缓存", rightText = "128 MB")
                        )
                    ).invoke(this)
                }.invoke(this)

                page.demoCard("Collapse") {
                    SaUIComponents.Collapse.build(
                        panels = listOf(
                            SaCollapse.Panel("面板 A", "这是面板 A 的内容"),
                            SaCollapse.Panel("面板 B", "这是面板 B 的内容")
                        ),
                        expandedIndex = if (page.collapseExpanded >= 0) page.collapseExpanded else null,
                        onExpandedChange = { idx -> page.collapseExpanded = idx ?: -1 }
                    ).invoke(this)
                }.invoke(this)

                page.sectionHeader("Feedback 反馈").invoke(this)

                page.demoCard("Loading - CIRCLE") {
                    SaUIComponents.Loading.build(message = "加载中...").invoke(this)
                }.invoke(this)

                page.demoCard("Loading - DOTS") {
                    SaUIComponents.Loading.build(
                        message = "加载中...",
                        variant = SaLoading.Variant.DOTS
                    ).invoke(this)
                }.invoke(this)

                page.demoCard("Toast - SUCCESS") {
                    SaToast.build(message = "操作成功", type = SaToast.Type.SUCCESS).invoke(this)
                }.invoke(this)

                page.demoCard("Empty - 带操作") {
                    SaUIComponents.Empty.build(
                        message = "暂无数据",
                        subMessage = "尝试刷新或重新加载",
                        iconType = com.sa.demo.saui.feedback.SaEmpty.IconType.SEARCH,
                        actionText = "重新加载"
                    ) {}.invoke(this)
                }.invoke(this)

                page.demoCard("Progress - LINE") {
                    SaUIComponents.Progress.build(percentage = 60f).invoke(this)
                }.invoke(this)

                page.demoCard("Progress - CIRCLE") {
                    SaUIComponents.Progress.build(
                        percentage = 70f,
                        variant = SaProgress.Variant.CIRCLE
                    ).invoke(this)
                }.invoke(this)

                page.demoCard("Rate") {
                    SaUIComponents.Rate.build(
                        value = page.rateValue,
                        onChange = { page.rateValue = it }
                    ).invoke(this)
                }.invoke(this)

                page.demoCard("Result") {
                    SaResult.build(
                        variant = SaResult.Variant.SUCCESS,
                        title = "操作成功",
                        description = "您的订单已提交",
                        actionText = "返回首页"
                    ) {}.invoke(this)
                }.invoke(this)

                page.demoCard("NoticeBar") {
                    SaNoticeBar.build(
                        text = "系统将于今晚 22:00-24:00 进行维护升级",
                        variant = SaNoticeBar.Variant.WARNING
                    ).invoke(this)
                }.invoke(this)

                page.demoCard("Skeleton - CARD") {
                    SaSkeleton.build(
                        variant = SaSkeleton.Variant.CARD,
                        width = 300f
                    ).invoke(this)
                }.invoke(this)

                page.demoCard("Skeleton - TEXT 多行") {
                    SaSkeleton.build(
                        variant = SaSkeleton.Variant.TEXT,
                        width = 300f,
                        count = 3
                    ).invoke(this)
                }.invoke(this)

                page.demoCard("Skeleton - CIRCLE") {
                    SaSkeleton.build(
                        variant = SaSkeleton.Variant.CIRCLE,
                        width = 48f
                    ).invoke(this)
                }.invoke(this)

                page.demoCard("Drawer") {
                    SaButton.build(
                        text = if (page.drawerVisible) "关闭 Drawer" else "打开 Drawer",
                        variant = SaButton.Variant.PRIMARY
                    ) { page.drawerVisible = !page.drawerVisible }.invoke(this)

                    SaUIComponents.Drawer.build(
                        visible = page.drawerVisible,
                        placement = SaDrawer.Placement.RIGHT,
                        header = "抽屉标题",
                        onClose = { page.drawerVisible = false }
                    ) {
                        SaUIComponents.Cell.build(title = "菜单项 1", showArrow = true) {
                            page.drawerVisible = false
                        }.invoke(this)
                        SaUIComponents.Cell.build(title = "菜单项 2", showArrow = true) {
                            page.drawerVisible = false
                        }.invoke(this)
                        SaUIComponents.Cell.build(title = "菜单项 3", showArrow = true) {
                            page.drawerVisible = false
                        }.invoke(this)
                    }.invoke(this)
                }.invoke(this)

                page.demoCard("Popup") {
                    SaButton.build(
                        text = if (page.popupVisible) "关闭 Popup" else "打开 Popup",
                        variant = SaButton.Variant.PRIMARY
                    ) { page.popupVisible = !page.popupVisible }.invoke(this)

                    SaUIComponents.Popup.build(
                        visible = page.popupVisible,
                        title = "操作菜单",
                        onClose = { page.popupVisible = false }
                    ) {
                        SaUIComponents.Cell.build(title = "选项 1", onClick = { page.popupVisible = false }).invoke(this)
                        SaUIComponents.Cell.build(title = "选项 2", onClick = { page.popupVisible = false }).invoke(this)
                    }.invoke(this)
                }.invoke(this)

                page.sectionHeader("Navigation 导航").invoke(this)

                page.demoCard("Navbar") {
                    SaUIComponents.Navbar.build(
                        title = "SaUI Catalog",
                        rightText = "编辑",
                        onLeftClick = {},
                        onRightClick = {}
                    ).invoke(this)
                }.invoke(this)

                page.demoCard("TabBar") {
                    SaTabBar.build(
                        items = listOf(
                            SaTabBar.TabItem("home", "首页", SaUIComponents.Icons.HOME),
                            SaTabBar.TabItem("chat", "消息", SaUIComponents.Icons.CHAT),
                            SaTabBar.TabItem("profile", "我的", SaUIComponents.Icons.USER)
                        ),
                        selectedKey = "home"
                    ).invoke(this)
                }.invoke(this)

                page.demoCard("Steps - horizontal") {
                    SaSteps.build(
                        steps = listOf(
                            SaSteps.Step("提交", "已完成"),
                            SaSteps.Step("审核中"),
                            SaSteps.Step("完成")
                        ),
                        current = 1
                    ).invoke(this)
                }.invoke(this)

                page.demoCard("Steps - vertical") {
                    SaSteps.build(
                        steps = listOf(
                            SaSteps.Step("提交订单", "2026-07-10 10:00"),
                            SaSteps.Step("支付完成", "2026-07-10 10:05"),
                            SaSteps.Step("商家发货", ""),
                            SaSteps.Step("确认收货", "")
                        ),
                        current = 2,
                        direction = SaSteps.Direction.VERTICAL
                    ).invoke(this)
                }.invoke(this)

                page.sectionHeader("Chat 业务组件").invoke(this)

                page.demoCard("ChatMessageBubble - 用户 / 助手") {
                    Column {
                        attr { width(320f) }

                        ChatMessageBubble.build(
                            content = "帮我看下这个函数为什么报错",
                            role = ChatMessageBubble.Role.USER
                        ).invoke(this)

                        ChatMessageBubble.build(
                            content = "空指针是因为 `list` 可能为空，先加一次判空：",
                            role = ChatMessageBubble.Role.ASSISTANT
                        ).invoke(this)
                    }
                }.invoke(this)

                page.demoCard("ChatMessageBubble - 代码块") {
                    Column {
                        attr { width(320f) }

                        ChatMessageBubble.build(
                            content = "改成这样即可：\n\n" +
                                "```kotlin\n" +
                                "fun firstOrNull(list: List<String>): String? {\n" +
                                "    return list.firstOrNull()\n" +
                                "}\n" +
                                "```\n" +
                                "注意 `firstOrNull()` 在空列表时返回 null。",
                            role = ChatMessageBubble.Role.ASSISTANT
                        ).invoke(this)
                    }
                }.invoke(this)

                page.demoCard("ChatMessageBubble - 流式光标（点右侧切换）") {
                    Column {
                        attr { width(320f) }

                        Row {
                            attr { alignItems(FlexAlign.CENTER); marginBottom(SaUISpacing.sm) }

                            SaButton.build(
                                text = if (page.bubbleStreaming) "停止流式" else "模拟流式",
                                variant = SaButton.Variant.PRIMARY_OUTLINE,
                                size = SaButton.ButtonSize.SMALL
                            ) {
                                page.bubbleStreaming = !page.bubbleStreaming
                            }.invoke(this)
                        }

                        ChatMessageBubble.build(
                            content = "正在逐字输出…",
                            role = ChatMessageBubble.Role.ASSISTANT,
                            streaming = page.bubbleStreaming
                        ).invoke(this)
                    }
                }.invoke(this)

                page.demoCard("ChatMessageBubble - 长按复制") {
                    Column {
                        attr { width(320f) }

                        ChatMessageBubble.build(
                            content = "长按我试试：气泡内容会进系统剪贴板。",
                            role = ChatMessageBubble.Role.ASSISTANT,
                            onCopy = {
                                val ok = copyToClipboard("SaApp", "长按我试试：气泡内容会进系统剪贴板。")
                                page.bubbleCopyHint = if (ok) "已复制到剪贴板" else "复制失败：当前平台不支持"
                            }
                        ).invoke(this)

                        if (page.bubbleCopyHint.isNotBlank()) {
                            Text {
                                attr {
                                    text(page.bubbleCopyHint)
                                    fontSize(12f)
                                    color(
                                        Color.parseString16ToLong(
                                            if (page.bubbleCopyHint.startsWith("已")) SaUIColors.Success
                                            else SaUIColors.Error
                                        )
                                    )
                                    marginTop(SaUISpacing.xs)
                                }
                            }
                        }
                    }
                }.invoke(this)

                page.demoCard("StreamingInputBar - 可交互") {
                    Column {
                        attr { width(340f) }

                        StreamingInputBar.build(
                            draft = page.barDraft,
                            busy = page.barBusy,
                            useStream = page.barStream,
                            selectedModel = page.barModel,
                            models = listOf("gpt-4o-mini", "gpt-4o", "qwen-max"),
                            onDraftChange = { page.barDraft = it },
                            onSend = {
                                page.barSent = page.barDraft
                                page.barDraft = ""
                            },
                            onStop = {
                                page.barBusy = false
                                page.barStopped = !page.barStopped
                            },
                            onModelSelect = {
                                page.barModel = it
                                page.barModelPickerOpen = false
                            },
                            onToggleStream = { page.barStream = it },
                            modelPickerOpen = page.barModelPickerOpen,
                            onToggleModelPicker = { page.barModelPickerOpen = !page.barModelPickerOpen }
                        ).invoke(this)

                        if (page.barSent.isNotBlank()) {
                            Text {
                                attr {
                                    text("已发送：${page.barSent}")
                                    fontSize(12f)
                                    color(Color.parseString16ToLong(SaUIColors.TextSecondarySolid))
                                    marginTop(SaUISpacing.xs)
                                }
                            }
                        }

                        if (page.barStopped) {
                            Text {
                                attr {
                                    text("已触发 onStop（真实页面在此中断 SSE，保留已生成部分）")
                                    fontSize(11f)
                                    color(Color.parseString16ToLong(SaUIColors.Warning))
                                    marginTop(SaUISpacing.xxs)
                                }
                            }
                        }

                        Row {
                            attr { marginTop(SaUISpacing.xs); alignItems(FlexAlign.CENTER) }

                            SaButton.build(
                                text = "模拟 busy",
                                variant = SaButton.Variant.TEXT,
                                size = SaButton.ButtonSize.SMALL
                            ) {
                                page.barBusy = !page.barBusy
                            }.invoke(this)

                            Text {
                                attr {
                                    text(if (page.barBusy) "  busy=true（发送键变停止）" else "  busy=false")
                                    fontSize(11f)
                                    color(Color.parseString16ToLong(SaUIColors.TextPlaceholderSolid))
                                }
                            }
                        }
                    }
                }.invoke(this)
            }
        }
    }

    // 注意：这两个辅助函数返回 ViewBuilder，调用点必须写 .invoke(this) 才会真正绘制；
    // 漏写时节点会被静默丢弃（整页空白且无任何报错）。
    private fun sectionHeader(title: String): ViewBuilder = {
        View {
            attr {
                marginTop(SaUISpacing.xl)
                marginBottom(SaUISpacing.md)
                padding(SaUISpacing.xs, 0f, SaUISpacing.xs, 0f)
            }
            Text {
                attr {
                    text(title)
                    fontSize(20f)
                    fontWeightBold()
                    color(Color.parseString16ToLong(SaUIColors.TextPrimarySolid))
                }
            }
        }
    }

    private fun demoCard(label: String, content: ViewBuilder): ViewBuilder = {
        View {
            attr {
                borderRadius(SaUIRadius.Medium)
                backgroundColor(Color.parseString16ToLong(SaUIColors.BgContainer))
                padding(SaUISpacing.md, SaUISpacing.md, SaUISpacing.md, SaUISpacing.md)
                marginBottom(SaUISpacing.sm)
            }
            Text {
                attr {
                    text(label)
                    fontSize(12f)
                    color(Color.parseString16ToLong(SaUIColors.TextSecondarySolid))
                    marginBottom(SaUISpacing.sm)
                }
            }
            content()
        }
    }
}
