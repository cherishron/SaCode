package com.sa.demo.feature.agent

import com.sa.demo.agent.AgentConnectMode
import com.sa.demo.agent.AgentProbe
import com.sa.demo.agent.AgentRegistry
import com.sa.demo.agent.BoundAgent
import com.sa.demo.auth.AuthRepository
import com.sa.demo.core.platform.PageRouterBridge
import com.sa.demo.core.platform.currentTimeMillis
import com.sa.demo.saui.base.SaButton
import com.sa.demo.saui.token.SaUIColors
import com.sa.demo.saui.token.SaUIRadius
import com.sa.demo.saui.token.SaUISpacing
import com.tencent.kuikly.core.annotations.Page
import com.tencent.kuikly.core.base.Color
import com.tencent.kuikly.core.base.ViewBuilder
import com.tencent.kuikly.core.layout.FlexAlign
import com.tencent.kuikly.core.pager.Pager
import com.tencent.kuikly.core.reactive.handler.observable
import com.tencent.kuikly.core.views.Input
import com.tencent.kuikly.core.views.Scroller
import com.tencent.kuikly.core.views.Text
import com.tencent.kuikly.core.views.View
import com.tencent.kuikly.core.views.layout.Column
import com.tencent.kuikly.core.views.layout.Row

/**
 * 绑定多台电脑 / 公网 Agent。
 * 绑定后探测：内网机先测本次 LAN，不通再组网/中继；云主机测 PUBLIC_HTTP。
 */
@Page("BindAgentPage")
class BindAgentPage : Pager() {

    var status by observable("绑定电脑 Agent")
    var detail by observable("支持多台；绑定后自动选最稳链路")
    var busy by observable(false)
    var name by observable("")
    var kind by observable("pc")
    var publicUrl by observable("")
    var lanUrl by observable("")
    var vnetUrl by observable("")
    var token by observable("")
    var useRelay by observable(true)
    var agents by observable(listOf<BoundAgent>())
    var probeLog by observable(listOf<String>())

    private fun uid(): String = AuthRepository.storedUsername() ?: "anon"

    fun refresh() {
        agents = AgentRegistry.list(uid())
    }

    fun onName(v: String) {
        name = v
    }

    fun onKind(v: String) {
        kind = v
    }

    fun onPublic(v: String) {
        publicUrl = v
    }

    fun onLan(v: String) {
        lanUrl = v
    }

    fun onVnet(v: String) {
        vnetUrl = v
    }

    fun onToken(v: String) {
        token = v
    }

    fun toggleRelay() {
        useRelay = !useRelay
    }

    fun bindAndProbe() {
        if (busy) return
        val deviceName = name.trim().ifEmpty {
            if (kind == "cloud") "云主机" else "PC-${currentTimeMillis() % 10000}"
        }
        if (kind != "cloud" && lanUrl.isBlank() && publicUrl.isBlank() && !useRelay && vnetUrl.isBlank()) {
            status = "请至少填写一种端点"
            detail = "请填本机回环地址或受 HTTPS 保护的 PC 代理地址"
            return
        }
        busy = true
        status = "绑定并探测链路…"
        detail = if (kind == "cloud") "云主机：优先 PUBLIC_HTTP" else "内网电脑：先测本次 LAN 是否可达"

        val agent = BoundAgent(
            deviceId = AgentRegistry.newDeviceId(),
            name = deviceName,
            kind = kind,
            idpSub = uid(),
            preferredMode = when {
                publicUrl.isNotBlank() -> AgentConnectMode.PUBLIC_HTTP.name
                lanUrl.isNotBlank() -> AgentConnectMode.LAN.name
                vnetUrl.isNotBlank() -> AgentConnectMode.VIRTUAL_NET.name
                else -> AgentConnectMode.SIGNED_RELAY.name
            },
            publicUrl = publicUrl.trim(),
            lanUrl = lanUrl.trim(),
            vnetUrl = vnetUrl.trim(),
            bearerToken = token.trim(),
            useRelay = useRelay,
        )
        val saved = AgentRegistry.upsert(uid(), agent)
        refresh()
        runProbe(saved)
    }

    fun reprobe(deviceId: String) {
        if (busy) return
        val agent = agents.firstOrNull { it.deviceId == deviceId } ?: return
        busy = true
        status = "重新探测 ${agent.name}"
        detail = "换网后请重测：内网机优先验证本次 LAN"
        runProbe(agent)
    }

    fun setActive(deviceId: String) {
        AgentRegistry.setActive(uid(), deviceId)
        refresh()
        status = "已切换默认 Agent"
        detail = agents.firstOrNull { it.deviceId == deviceId }?.name ?: deviceId
    }

    fun removeAgent(deviceId: String) {
        AgentRegistry.remove(uid(), deviceId)
        refresh()
        status = "已解绑"
    }

    private fun runProbe(agent: BoundAgent) {
        probeLog = listOf("探测 ${agent.name}…")
        AgentProbe.probeAndSelect(agent) { sel ->
            busy = false
            val chosen = sel.chosen
            if (chosen != null) {
                AgentRegistry.update(uid(), agent.deviceId) {
                    it.copy(
                        preferredMode = chosen.name,
                        lastModeUsed = chosen.name,
                        online = true,
                        lastProbeAt = currentTimeMillis(),
                        lastProbeDetail = sel.detail,
                    )
                }
                status = "已绑定：${agent.name}"
                detail = "最稳链路 → ${chosen.name}"
            } else {
                AgentRegistry.update(uid(), agent.deviceId) {
                    it.copy(
                        online = false,
                        lastProbeAt = currentTimeMillis(),
                        lastProbeDetail = sel.detail,
                    )
                }
                status = "已绑定但当前不可达"
                detail = sel.detail
            }
            probeLog = sel.results.map { r ->
                "${r.mode}: ${if (r.ok) "通" else "不通"} · ${r.detail.take(80)}"
            } + listOf(sel.detail)
            refresh()
        }
    }

    fun goRemote() {
        PageRouterBridge.open("AgentPage")
    }

    override fun body(): ViewBuilder = {
        val page = this@BindAgentPage
        page.refresh()

        Scroller {
            attr {
                // 根容器必须 flex(1f) 才能撑满页面高度，否则高度塌陷为 0 → 白屏
                flex(1f)
                backgroundColor(Color.parseString16ToLong(SaUIColors.BgPage))
            }
            Column {
                attr {
                    padding(SaUISpacing.lg, SaUISpacing.md, SaUISpacing.lg, SaUISpacing.lg)
                    // 滚动容器内容不要用 flex(1f)，否则在 flexbox 中高度会塌陷
                }

                Text {
                    attr {
                        text("绑定电脑（可多台）")
                        fontSize(20f)
                        fontWeightBold()
                        color(Color.parseString16ToLong(SaUIColors.TextPrimarySolid))
                    }
                }
                Text {
                    attr {
                        text("内网机：先测本次 LAN → 不通则组网/中继。云主机：测公网对流。断网后续传游标按设备保存。")
                        fontSize(12f)
                        color(Color.parseString16ToLong(SaUIColors.TextSecondarySolid))
                        margin(top = 4f)
                    }
                }

                View {
                    attr {
                        margin(top = SaUISpacing.md)
                        padding(SaUISpacing.md)
                        backgroundColor(Color.parseString16ToLong(SaUIColors.BgContainer))
                        borderRadius(SaUIRadius.Medium)
                        flexDirectionColumn()
                    }
                    Column {
                        attr { flexDirectionColumn() }

                        Text {
                            attr {
                                text("设备名称")
                                fontSize(12f)
                                color(Color.parseString16ToLong(SaUIColors.TextSecondarySolid))
                            }
                        }
                        page.formInput(page.name, "如 DESKTOP-JINGG") { page.onName(it) }.invoke(this)

                        Row {
                            attr { margin(top = 6f, bottom = 6f) }
                            listOf("pc" to "内网电脑", "cloud" to "公网服务器").forEach { (k, label) ->
                                val sel = page.kind == k
                                View {
                                    attr {
                                        margin(right = 8f)
                                        padding(10f, 6f, 10f, 6f)
                                        borderRadius(12f)
                                        backgroundColor(
                                            Color.parseString16ToLong(
                                                if (sel) SaUIColors.BrandPrimary else SaUIColors.BgComponent
                                            )
                                        )
                                    }
                                    Text {
                                        attr {
                                            text(label)
                                            fontSize(12f)
                                            color(
                                                Color.parseString16ToLong(
                                                    if (sel) SaUIColors.TextAnti
                                                    else SaUIColors.TextSecondarySolid
                                                )
                                            )
                                        }
                                    }
                                    event { click { page.onKind(k) } }
                                }
                            }
                        }

                        Text {
                            attr {
                                text("公网 URL（可选）")
                                fontSize(12f)
                                color(Color.parseString16ToLong(SaUIColors.TextSecondarySolid))
                            }
                        }
                        page.formInput(page.publicUrl, "https://…") { page.onPublic(it) }.invoke(this)

                        Text {
                            attr {
                                text("内网 LAN")
                                fontSize(12f)
                                color(Color.parseString16ToLong(SaUIColors.TextSecondarySolid))
                            }
                        }
                        page.formInput(page.lanUrl, "http://192.168.x.x:49152") { page.onLan(it) }.invoke(this)

                        Text {
                            attr {
                                text("虚拟组网 IP（可选）")
                                fontSize(12f)
                                color(Color.parseString16ToLong(SaUIColors.TextSecondarySolid))
                            }
                        }
                        page.formInput(page.vnetUrl, "http://100.x.x.x:49152") { page.onVnet(it) }.invoke(this)

                        Text {
                            attr {
                                text("daemon token（可选）")
                                fontSize(12f)
                                color(Color.parseString16ToLong(SaUIColors.TextSecondarySolid))
                            }
                        }
                        page.formInput(page.token, "Bearer token") { page.onToken(it) }.invoke(this)

                        SaButton.build(
                            text = if (page.useRelay) "签名中继：开" else "签名中继：关",
                            variant = SaButton.Variant.PRIMARY_OUTLINE,
                            size = SaButton.ButtonSize.SMALL,
                        ) { page.toggleRelay() }.invoke(this)

                        View { attr { height(8f) } }
                        SaButton.build(
                            text = if (page.busy) "探测中…" else "绑定并探测链路",
                            variant = SaButton.Variant.PRIMARY,
                            size = SaButton.ButtonSize.LARGE,
                            block = true,
                            disabled = page.busy,
                        ) { page.bindAndProbe() }.invoke(this)
                    }
                }

                View {
                    attr {
                        margin(top = SaUISpacing.md)
                        padding(SaUISpacing.md)
                        backgroundColor(Color.parseString16ToLong(SaUIColors.BgContainer))
                        borderRadius(SaUIRadius.Medium)
                        flexDirectionColumn()
                    }
                    Column {
                        attr { flexDirectionColumn() }
                        Text {
                            attr {
                                text(page.status)
                                fontSize(15f)
                                fontWeightMedium()
                                color(Color.parseString16ToLong(SaUIColors.TextPrimarySolid))
                            }
                        }
                        Text {
                            attr {
                                text(page.detail)
                                fontSize(12f)
                                color(Color.parseString16ToLong(SaUIColors.TextPlaceholderSolid))
                                margin(top = 4f)
                            }
                        }
                        page.probeLog.forEach { line ->
                            Text {
                                attr {
                                    text(line)
                                    fontSize(11f)
                                    color(Color.parseString16ToLong(SaUIColors.TextSecondarySolid))
                                    margin(top = 2f)
                                }
                            }
                        }
                    }
                }

                Text {
                    attr {
                        text("已绑定（${page.agents.size}）")
                        fontSize(14f)
                        fontWeightMedium()
                        color(Color.parseString16ToLong(SaUIColors.TextPrimarySolid))
                        margin(top = SaUISpacing.md)
                        margin(bottom = SaUISpacing.sm)
                    }
                }

                if (page.agents.isEmpty()) {
                    Text {
                        attr {
                            text("尚未绑定。填写 LAN 或公网地址后点「绑定并探测」。")
                            fontSize(12f)
                            color(Color.parseString16ToLong(SaUIColors.TextPlaceholderSolid))
                        }
                    }
                }

                page.agents.forEach { a ->
                    View {
                        attr {
                            margin(bottom = SaUISpacing.sm)
                            padding(SaUISpacing.md)
                            backgroundColor(Color.parseString16ToLong(SaUIColors.BgContainer))
                            borderRadius(SaUIRadius.Medium)
                            flexDirectionColumn()
                        }
                        Column {
                            attr { flexDirectionColumn() }
                            Row {
                                attr { alignItems(FlexAlign.CENTER) }
                                Text {
                                    attr {
                                        text(a.name)
                                        fontSize(14f)
                                        fontWeightMedium()
                                        color(Color.parseString16ToLong(SaUIColors.TextPrimarySolid))
                                        flex(1f)
                                    }
                                }
                                Text {
                                    attr {
                                        text(if (a.online) "在线" else "离线")
                                        fontSize(11f)
                                        color(
                                            Color.parseString16ToLong(
                                                if (a.online) SaUIColors.Success else SaUIColors.Error
                                            )
                                        )
                                    }
                                }
                            }
                            Text {
                                attr {
                                    text(
                                        "类型=${a.kind} · 首选=${a.preferredMode}\n" +
                                            "LAN=${a.lanUrl.ifBlank { "-" }}\n" +
                                            "公网=${a.publicUrl.ifBlank { "-" }} · 中继=${if (a.useRelay) "开" else "关"}\n" +
                                            "续传=${if (a.resumePending) "${a.resumeTaskId}@seq${a.resumeLastSeq}" else "无"}"
                                    )
                                    fontSize(11f)
                                    color(Color.parseString16ToLong(SaUIColors.TextSecondarySolid))
                                    margin(top = 4f)
                                }
                            }
                            Row {
                                attr { margin(top = 6f) }
                                SaButton.build(text = "重测链路", variant = SaButton.Variant.PRIMARY_OUTLINE, size = SaButton.ButtonSize.SMALL) {
                                    page.reprobe(a.deviceId)
                                }.invoke(this)
                                SaButton.build(text = "设为默认", variant = SaButton.Variant.TEXT, size = SaButton.ButtonSize.SMALL) {
                                    page.setActive(a.deviceId)
                                }.invoke(this)
                                SaButton.build(text = "解绑", variant = SaButton.Variant.TEXT, size = SaButton.ButtonSize.SMALL) {
                                    page.removeAgent(a.deviceId)
                                }.invoke(this)
                            }
                        }
                    }
                }

                SaButton.build(
                    text = "去遥控页",
                    variant = SaButton.Variant.TEXT,
                    size = SaButton.ButtonSize.SMALL,
                ) { page.goRemote() }.invoke(this)
            }
        }
    }

    private fun formInput(
        value: String,
        placeholder: String,
        onChange: (String) -> Unit,
    ): ViewBuilder = {
        // 必须用 Row：默认纵向容器 + alignItems(CENTER) 会让 Input 宽度塌陷为 0（placeholder 不显示）
        Row {
            attr {
                height(42f)
                margin(top = 4f, bottom = SaUISpacing.sm)
                padding(left = SaUISpacing.md, right = SaUISpacing.md)
                backgroundColor(Color.parseString16ToLong(SaUIColors.BgPage))
                borderRadius(SaUIRadius.Small)
                alignItems(FlexAlign.CENTER)
            }
            Input {
                attr {
                    flex(1f)
                    height(42f)
                    text(value)
                    placeholder(placeholder)
                    placeholderColor(Color(Color.parseString16ToLong(SaUIColors.TextPlaceholderSolid)))
                    fontSize(14f)
                    color(Color(Color.parseString16ToLong(SaUIColors.TextPrimarySolid)))
                }
                event { textDidChange { onChange(it.text) } }
            }
        }
    }
}
