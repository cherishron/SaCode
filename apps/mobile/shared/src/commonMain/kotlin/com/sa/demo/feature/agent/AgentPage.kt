package com.sa.demo.feature.agent

import com.sa.demo.agent.AgentConnectMode
import com.sa.demo.agent.AgentLink
import com.sa.demo.agent.AgentLinkConfig
import com.sa.demo.agent.AgentRegistry
import com.sa.demo.agent.rpc.AgentMethods
import com.sa.demo.agent.rpc.AgentRpc
import com.sa.demo.agent.rpc.DaemonTransport
import com.sa.demo.auth.AuthRepository
import com.sa.demo.core.platform.CancelToken
import com.sa.demo.core.platform.PageRouterBridge
import com.sa.demo.core.platform.currentTimeMillis
import com.sa.demo.core.platform.postToMain
import com.sa.demo.env.SaaiEnv
import com.sa.demo.feature.home.HomeTabs
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
import kotlinx.serialization.json.JsonObject

/**
 * 设备页：连上 PC 上的 SaCode daemon，按它**实际协商到的能力**做动作。
 *
 * 全部走 JSON-RPC（`POST /rpc` + `GET /sse`），方法名逐字对齐
 * `sa-code/apps/daemon/src/daemon.cj`。旧版本这里是一套自造的 REST
 * （`POST /task`、`GET /queue/status`），daemon 上并不存在，点任何按钮都只会 404。
 *
 * **能力驱动的意义**：daemon 的基础能力只有 `initialize` 与 `session/catalog`
 * （`daemon.cj:38`）。`task/start` 只有 PC 上起了宿主才存在，`team` 开头的方法
 * 只有起了团队宿主才存在。所以按钮的可用性来自运行时协商结果，不是编译期假设——
 * 否则用户会撞到 -32601/-32010 这种没法执行的错误码。
 */
@Page("AgentPage")
class AgentPage : Pager() {

    var status by observable("选择连接方式")
    var detail by observable("")
    var busy by observable(false)
    var mode by observable(AgentConnectMode.SIGNED_RELAY.name)
    var endpoint by observable("")
    var token by observable("")
    var prompt by observable("从 SaApp 下发的测试任务")
    var turnId by observable("")
    var approvalId by observable("")
    var approvalNote by observable("")
    var log by observable(listOf<String>())

    /** 已协商到的能力；空集 = 尚未探测或探测失败。 */
    var capabilities by observable(emptySet<String>())

    /** 会话目录（`session/catalog` 返回项）。 */
    var catalog by observable(emptyList<AgentRpc.CatalogEntry>())

    /** 事件流是否已连上。做成 observable，订阅/断开要立刻反映到按钮文案上。 */
    var sseOpen by observable(false)
    private var sseToken: CancelToken? = null

    private fun pushLog(line: String) {
        log = (log + line).takeLast(12)
    }

    // —— 连接配置 ——

    fun selectMode(name: String) {
        mode = name
        val m = AgentConnectMode.valueOf(name)
        status = m.name
        detail = AgentLink.describe(m)
        // 切换链路就清空旧结果：上一条链路的能力/目录对这条没有意义
        capabilities = emptySet()
        catalog = emptyList()
        if (m == AgentConnectMode.LAN && endpoint.isBlank()) {
            endpoint = DaemonTransport.DEFAULT_LOOPBACK
        }
        if (m == AgentConnectMode.SIGNED_RELAY) endpoint = ""
    }

    fun onEndpoint(v: String) {
        endpoint = v
    }

    fun onToken(v: String) {
        token = v
    }

    fun onPrompt(v: String) {
        prompt = v
    }

    fun onTurnId(v: String) {
        turnId = v
    }

    fun onApprovalId(v: String) {
        approvalId = v
    }

    fun onApprovalNote(v: String) {
        approvalNote = v
    }

    /**
     * 答复审批（`team/approval/answer`）。
     *
     * 需要团队宿主能力；没有该能力时按钮本身是禁用的。
     * `approved` 是**给宿主裁决的答复**，App 端不做任何"代替用户决定"的事——
     * 没填 approvalId 就不发请求，避免产生一条无法追溯的空应答。
     */
    fun doAnswerApproval(approved: Boolean) {
        if (busy || approvalId.isBlank()) return
        busy = true
        status = if (approved) "同意中…" else "拒绝中…"
        transport().answerApproval(approvalId.trim(), approved, approvalNote.trim()) { _, err ->
            busy = false
            if (err != null) {
                status = "答复失败"
                detail = err
                pushLog("[approval] ERR $err")
            } else {
                status = "已答复"
                detail = "approval ${approvalId.trim()} → ${if (approved) "同意" else "拒绝"}"
                pushLog("[approval] ${if (approved) "approve" else "reject"} ok")
            }
        }
    }

    private fun transport(): DaemonTransport =
        DaemonTransport(endpoint.trim(), token.trim())

    /** 把当前输入同步进全局配置，供 [com.sa.demo.agent.AgentProbe] 等复用。 */
    private fun syncConfig() {
        val uid = AuthRepository.storedUsername() ?: "anon"
        AgentLinkConfig.current = AgentLinkConfig(
            idpSub = uid,
            mode = AgentConnectMode.valueOf(mode),
            directBaseUrl = endpoint.trim(),
            bearerToken = token.trim(),
        )
    }

    // —— 能力驱动 ——

    fun has(method: String) = method in capabilities    /** 探测能力（JSON-RPC `initialize`）。 */
    fun doProbe() {
        if (busy) return
        val bad = transport().validate()
        if (bad != null) {
            status = "配置有误"
            detail = bad
            pushLog("[init] $bad")
            return
        }
        busy = true
        status = "协商能力中…"
        transport().initialize { caps, err ->
            busy = false
            if (err != null) {
                capabilities = emptySet()
                status = "不可达"
                detail = err
                pushLog("[init] ERR $err")
            } else {
                capabilities = caps
                status = "已连接"
                detail = AgentRpc.describeCapabilities(caps)
                pushLog("[init] ${AgentRpc.describeCapabilities(caps)}")
                if (AgentMethods.TASK_START !in caps) {
                    pushLog("[init] 目标端未启动宿主，任务类操作不可用")
                }
            }
        }
    }

    /** 会话目录（`session/catalog`）。daemon 自有方法，不依赖宿主。 */
    fun doCatalog() {
        if (busy) return
        busy = true
        status = "读取会话目录…"
        transport().catalog { cat, err ->
            busy = false
            if (err != null) {
                catalog = emptyList()
                status = "读取失败"
                detail = err
                pushLog("[catalog] ERR $err")
            } else {
                catalog = cat?.entries.orEmpty()
                status = "会话目录"
                detail = "根目录 ${cat?.root.orEmpty()} · ${catalog.size} 个会话"
                pushLog("[catalog] ${catalog.size} 条")
            }
        }
    }

    /** 下发一轮任务（`task/start`）。 */
    fun doStartTask() {
        if (busy) return
        if (prompt.isBlank()) {
            status = "请先填写任务内容"
            return
        }
        busy = true
        status = "下发任务…"
        transport().startTask(prompt.trim()) { result, err ->
            busy = false
            if (err != null) {
                status = "下发失败"
                detail = err
                pushLog("[task/start] ERR $err")
            } else {
                // turnId 从宿主应答里取；取不到就提示用户手填，不能假装拿到了
                val id = result?.stringOrNull("turnId") ?: result?.stringOrNull("turn_id")
                if (!id.isNullOrBlank()) {
                    turnId = id
                    pushLog("[task/start] 已受理 turn=$id")
                    status = "任务已受理"
                    detail = "turn $id"
                } else {
                    status = "已受理"
                    detail = "应答中未带 turnId，请手动填入以便查询/取消"
                    pushLog("[task/start] 已受理（无 turnId）")
                }
            }
        }
    }

    /** 查询一轮进度（`turn/poll`）。 */
    fun doPoll() {
        if (busy || turnId.isBlank()) return
        busy = true
        status = "查询进度…"
        transport().pollTurn(turnId.trim()) { _, err ->
            busy = false
            if (err != null) {
                status = "查询失败"
                detail = err
                pushLog("[turn/poll] ERR $err")
            } else {
                status = "已查询"
                detail = "turn ${turnId.trim()} 的最新状态见下方日志"
                pushLog("[turn/poll] ok")
            }
        }
    }

    /** 取消一轮（`turn/cancel`）。 */
    fun doCancel() {
        if (busy || turnId.isBlank()) return
        busy = true
        status = "取消中…"
        transport().cancelTurn(turnId.trim()) { _, err ->
            busy = false
            if (err != null) {
                status = "取消失败"
                detail = err
                pushLog("[turn/cancel] ERR $err")
            } else {
                status = "已取消"
                detail = "turn ${turnId.trim()}"
                pushLog("[turn/cancel] ok")
            }
        }
    }

    /** 订阅 / 断开事件流（`GET /sse`）。 */
    fun toggleEvents() {
        if (sseOpen) {
            sseToken?.cancel()
            sseOpen = false
            pushLog("[sse] 已断开")
            status = "事件流已断开"
            return
        }
        val bad = transport().validate()
        if (bad != null) {
            status = "配置有误"
            detail = bad
            return
        }
        val token = CancelToken()
        sseToken = token
        sseOpen = true
        status = "订阅事件流…"
        pushLog("[sse] 连接中")

        com.sa.demo.core.platform.asyncRun({
            transport().openEvents(
                token = token,
                onEvent = { obj ->
                    // 回调在 IO 线程，状态改动必须回主线程
                    postToMain {
                        val text = com.sa.demo.agent.rpc.AgentSse.extractText(obj)
                        pushLog("[sse] ${text ?: obj.keys.take(3).joinToString(",")}")
                    }
                },
                onEnded = { reason ->
                    postToMain {
                        sseOpen = false
                        sseToken = null
                        if (reason != null) {
                            pushLog("[sse] 中断：$reason")
                            status = "事件流已断开"
                            detail = reason
                        } else {
                            pushLog("[sse] 已结束")
                        }
                    }
                },
            )
        }) { /* openEvents 自己回调，这里只等它结束 */ }
    }

    fun goChat() = PageRouterBridge.open("ChatPage")

    fun goBind() = PageRouterBridge.push("BindAgentPage")

    /** 若已绑定设备，用其 preferredMode 与端点预填。 */
    private fun applyBoundDefault() {
        val uid = AuthRepository.storedUsername() ?: "anon"
        val active = AgentRegistry.active(uid) ?: return
        status = "默认 Agent：${active.name}"
        detail = "首选链路 ${active.preferredMode}"
        selectMode(active.preferredMode)
        when (AgentConnectMode.valueOf(active.preferredMode)) {
            AgentConnectMode.PUBLIC_HTTP -> endpoint = active.publicUrl
            AgentConnectMode.LAN -> endpoint = active.lanUrl
            AgentConnectMode.VIRTUAL_NET -> endpoint = active.vnetUrl
            AgentConnectMode.IPV6 -> endpoint = active.ipv6Url
            AgentConnectMode.SIGNED_RELAY -> endpoint = ""
        }
        if (active.bearerToken.isNotBlank()) token = active.bearerToken
    }

    // —— 视图 ——

    override fun body(): ViewBuilder = {
        val page = this@AgentPage
        val env = SaaiEnv.current
        if (page.status == "选择连接方式") page.applyBoundDefault()
        page.syncConfig()

        Column {
            attr {
                flex(1f)
                backgroundColor(Color.parseString16ToLong(SaUIColors.BgPage))
            }

            Scroller {
                attr {
                    flex(1f)
                    backgroundColor(Color.parseString16ToLong(SaUIColors.BgPage))
                }
                Column {
                    attr { padding(SaUISpacing.lg, SaUISpacing.md, SaUISpacing.lg, SaUISpacing.md) }

                    Text {
                        attr {
                            text("连接我的电脑 Agent")
                            fontSize(20f)
                            fontWeightBold()
                            color(Color.parseString16ToLong(SaUIColors.TextPrimarySolid))
                        }
                    }
                    Text {
                        attr {
                            text("执行在 PC（sacode daemon）；手机只控制。IdP ${env.issuer}")
                            fontSize(12f)
                            color(Color.parseString16ToLong(SaUIColors.TextSecondarySolid))
                            margin(top = 4f)
                        }
                    }

                    page.noticeCard().invoke(this)

                    // 链路选择
                    page.sectionTitle("链路").invoke(this)
                    Column {
                        AgentConnectMode.entries.forEach { m ->
                            page.modeRow(m).invoke(this)
                        }
                    }

                    if (page.mode != AgentConnectMode.SIGNED_RELAY.name) {
                        page.sectionTitle("端点").invoke(this)
                        page.inputField(
                            value = page.endpoint,
                            placeholder = "PC 地址，如 ${DaemonTransport.DEFAULT_LOOPBACK}",
                            onChange = { page.onEndpoint(it) },
                        ).invoke(this)
                        page.inputField(
                            value = page.token,
                            placeholder = "daemon Bearer token（未启用远程接入时留空）",
                            onChange = { page.onToken(it) },
                        ).invoke(this)
                    }

                    // 状态
                    page.sectionTitle("状态").invoke(this)
                    page.statusCard().invoke(this)

                    // 动作
                    page.sectionTitle("动作").invoke(this)
                    page.actionBlock().invoke(this)

                    // 任务
                    page.sectionTitle("任务").invoke(this)
                    page.taskBlock().invoke(this)

                    // 审批：只在协商到能力时才占位
                    if (page.has(AgentMethods.TEAM_APPROVAL_ANSWER)) {
                        page.sectionTitle("审批").invoke(this)
                        page.approvalBlock().invoke(this)
                    }
                }
            }

            // 底部导航必须在 Column 末位（首个子节点在顶部），且不能在 Scroller 里，
            // 否则会跟着内容一起滚动
            HomeTabs.build(HomeTabs.DEVICES).invoke(this)
        }
    }

    // —— 视图片段 ——

    private fun noticeCard(): ViewBuilder = {
        View {
            attr {
                margin(top = SaUISpacing.md)
                padding(SaUISpacing.md)
                backgroundColor(Color.parseString16ToLong(SaUIColors.BgContainer))
                borderRadius(SaUIRadius.Medium)
                flexDirectionColumn()
            }
            Column {
                Text {
                    attr {
                        text("按能力而非按版本")
                        fontSize(14f)
                        fontWeightMedium()
                        color(Color.parseString16ToLong(SaUIColors.TextPrimarySolid))
                    }
                }
                Text {
                    attr {
                        text(
                            "daemon 默认只开 ${DaemonTransport.DEFAULT_LOOPBACK}，" +
                                "端口由 --port 覆盖\n" +
                                "有线联调：adb reverse tcp:18937 tcp:18937\n" +
                                "任务类操作需要 PC 上已启动宿主，否则按钮不可用\n" +
                                "SIGNED_RELAY 尚无服务端，请勿用于真实任务"
                        )
                        fontSize(12f)
                        color(Color.parseString16ToLong(SaUIColors.TextSecondarySolid))
                        margin(top = 6f)
                    }
                }
            }
        }
    }

    private fun modeRow(m: AgentConnectMode): ViewBuilder = {
        // lambda 的接收者是 ViewContainer，不是本 Pager——必须显式取回 page
        val page = this@AgentPage
        val selected = page.mode == m.name
        View {
            attr {
                margin(bottom = 6f)
                padding(SaUISpacing.sm)
                borderRadius(10f)
                backgroundColor(
                    Color.parseString16ToLong(
                        if (selected) SaUIColors.BrandFocus else SaUIColors.BgComponent
                    )
                )
                flexDirectionColumn()
            }
            Column {
                Text {
                    attr {
                        text(m.name)
                        fontSize(13f)
                        color(
                            Color.parseString16ToLong(
                                if (selected) SaUIColors.BrandPrimary else SaUIColors.TextPrimarySolid
                            )
                        )
                    }
                }
                Text {
                    attr {
                        text(AgentLink.describe(m))
                        fontSize(11f)
                        color(Color.parseString16ToLong(SaUIColors.TextSecondarySolid))
                        margin(top = 2f)
                    }
                }
            }
            event { click { page.selectMode(m.name) } }
        }
    }

    private fun inputField(value: String, placeholder: String, onChange: (String) -> Unit): ViewBuilder = {
        // 必须用 Row：默认纵向容器 + alignItems(CENTER) 会让 Input 宽度塌陷为 0（placeholder 不显示）
        Row {
            attr {
                margin(top = SaUISpacing.sm)
                height(44f)
                padding(left = SaUISpacing.md, right = SaUISpacing.md)
                backgroundColor(Color.parseString16ToLong(SaUIColors.BgContainer))
                borderRadius(SaUIRadius.Small)
                alignItems(FlexAlign.CENTER)
            }
            Input {
                attr {
                    flex(1f)
                    height(44f)
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

    private fun statusCard(): ViewBuilder = {
        val page = this@AgentPage
        View {
            attr {
                padding(SaUISpacing.md)
                backgroundColor(Color.parseString16ToLong(SaUIColors.BgContainer))
                borderRadius(SaUIRadius.Medium)
                flexDirectionColumn()
            }
            Column {
                Text {
                    attr {
                        text(page.status)
                        fontSize(16f)
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
                if (page.capabilities.isNotEmpty()) {
                    Text {
                        attr {
                            text("能力：${page.capabilities.sorted().joinToString(", ")}")
                            fontSize(11f)
                            color(Color.parseString16ToLong(SaUIColors.TextSecondarySolid))
                            margin(top = 6f)
                        }
                    }
                }
                page.log.forEach { line ->
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
    }

    private fun actionBlock(): ViewBuilder = {
        val page = this@AgentPage
        Column {
            Row {
                SaButton.build(
                    text = if (page.busy) "…" else "探测能力",
                    variant = SaButton.Variant.PRIMARY,
                    size = SaButton.ButtonSize.MEDIUM,
                    disabled = page.busy,
                ) { page.doProbe() }.invoke(this)
                View { attr { width(8f) } }
                SaButton.build(
                    text = "会话目录",
                    variant = SaButton.Variant.PRIMARY_OUTLINE,
                    size = SaButton.ButtonSize.MEDIUM,
                    disabled = page.busy || !page.has(AgentMethods.SESSION_CATALOG),
                ) { page.doCatalog() }.invoke(this)
            }
            SaButton.build(
                text = if (page.sseOpen) "断开事件流" else "订阅事件流",
                variant = SaButton.Variant.PRIMARY_OUTLINE,
                size = SaButton.ButtonSize.MEDIUM,
                disabled = page.busy,
            ) { page.toggleEvents() }.invoke(this)
            SaButton.build(
                text = "绑定多台电脑",
                variant = SaButton.Variant.PRIMARY_OUTLINE,
                size = SaButton.ButtonSize.MEDIUM,
            ) { page.goBind() }.invoke(this)
            SaButton.build(
                text = "去对话页",
                variant = SaButton.Variant.TEXT,
                size = SaButton.ButtonSize.SMALL,
            ) { page.goChat() }.invoke(this)
        }
    }

    private fun taskBlock(): ViewBuilder = {
        val page = this@AgentPage
        Column {
            if (!page.has(AgentMethods.TASK_START)) {
                Text {
                    attr {
                        text("目标端未协商到 task/start：PC 上还没启动执行宿主。")
                        fontSize(12f)
                        color(Color.parseString16ToLong(SaUIColors.Warning))
                        margin(bottom = SaUISpacing.sm)
                    }
                }
            }
            page.inputField(page.prompt, "任务内容") { page.onPrompt(it) }.invoke(this)
            page.inputField(page.turnId, "turnId（查询/取消用）") { page.onTurnId(it) }.invoke(this)

            SaButton.build(
                text = "下发任务",
                variant = SaButton.Variant.PRIMARY,
                size = SaButton.ButtonSize.MEDIUM,
                disabled = page.busy || !page.has(AgentMethods.TASK_START) || page.prompt.isBlank(),
            ) { page.doStartTask() }.invoke(this)

            Row {
                SaButton.build(
                    text = "查询进度",
                    variant = SaButton.Variant.PRIMARY_OUTLINE,
                    size = SaButton.ButtonSize.MEDIUM,
                    disabled = page.busy || page.turnId.isBlank() || !page.has(AgentMethods.TURN_POLL),
                ) { page.doPoll() }.invoke(this)
                View { attr { width(8f) } }
                SaButton.build(
                    text = "取消",
                    variant = SaButton.Variant.DANGER_OUTLINE,
                    size = SaButton.ButtonSize.MEDIUM,
                    disabled = page.busy || page.turnId.isBlank() || !page.has(AgentMethods.TURN_CANCEL),
                ) { page.doCancel() }.invoke(this)
            }

            if (page.catalog.isNotEmpty()) {
                Text {
                    attr {
                        text("PC 上的会话（${page.catalog.size}）")
                        fontSize(14f)
                        fontWeightBold()
                        color(Color.parseString16ToLong(SaUIColors.TextPrimarySolid))
                        margin(top = SaUISpacing.md)
                        margin(bottom = SaUISpacing.sm)
                    }
                }
                page.catalog.forEach { entry ->
                    Text {
                        attr {
                            text(
                                listOfNotNull(
                                    entry.title.takeIf { it.isNotBlank() },
                                    entry.status.takeIf { it.isNotBlank() },
                                    if (entry.durable) "持久" else "临时",
                                    entry.id,
                                ).joinToString(" · ")
                            )
                            fontSize(12f)
                            color(Color.parseString16ToLong(SaUIColors.TextSecondarySolid))
                            margin(bottom = 4f)
                        }
                    }
                }
            }
        }
    }

    private fun approvalBlock(): ViewBuilder = {
        val page = this@AgentPage
        Column {
            page.inputField(page.approvalId, "approvalId") { page.onApprovalId(it) }.invoke(this)
            page.inputField(page.approvalNote, "备注（可选）") { page.onApprovalNote(it) }.invoke(this)
            Row {
                SaButton.build(
                    text = "同意",
                    variant = SaButton.Variant.PRIMARY,
                    size = SaButton.ButtonSize.MEDIUM,
                    disabled = page.busy || page.approvalId.isBlank(),
                ) { page.doAnswerApproval(true) }.invoke(this)
                View { attr { width(8f) } }
                SaButton.build(
                    text = "拒绝",
                    variant = SaButton.Variant.DANGER_OUTLINE,
                    size = SaButton.ButtonSize.MEDIUM,
                    disabled = page.busy || page.approvalId.isBlank(),
                ) { page.doAnswerApproval(false) }.invoke(this)
            }
        }
    }

    private fun sectionTitle(text: String): ViewBuilder = {
        Text {
            attr {
                text(text)
                fontSize(14f)
                fontWeightBold()
                color(Color.parseString16ToLong(SaUIColors.TextPrimarySolid))
                margin(top = SaUISpacing.lg)
                margin(bottom = SaUISpacing.sm)
            }
        }
    }
}

/** 从应答里取字符串字段；非字符串或缺失一律返回 null——不猜测类型。 */
private fun JsonObject.stringOrNull(key: String): String? =
    this[key]?.let { runCatching { it.toString().trim('"') }.getOrNull() }
        ?.takeIf { it.isNotBlank() && it != "null" }
