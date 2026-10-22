package com.sa.demo.feature.agent

import com.sa.demo.agent.AgentRegistry
import com.sa.demo.agent.BoundAgent
import com.sa.demo.agent.AgentConnectMode
import com.sa.demo.agent.rpc.*
import com.sa.demo.auth.AuthRepository
import com.sa.demo.core.platform.*
import com.sa.demo.storage.SecureStores
import com.sa.demo.saui.base.SaButton
import com.sa.demo.saui.token.SaUIColors
import com.sa.demo.feature.home.HomeTabs
import com.tencent.kuikly.core.annotations.Page
import com.tencent.kuikly.core.base.Color
import com.tencent.kuikly.core.base.ViewBuilder
import com.tencent.kuikly.core.pager.Pager
import com.tencent.kuikly.core.reactive.handler.observable
import com.tencent.kuikly.core.views.*
import com.tencent.kuikly.core.views.layout.Column

/** 受保护只读入口。不暴露任意 RPC、旧任务或审批接口。 */
@Page("RemoteDevicesPage")
class RemoteDevicesPage : Pager() {
    var address by observable("https://")
    var workspace by observable("")
    var displayName by observable("我的电脑")
    var protocolName by observable("saapp-phone")
    var enrollmentSecret by observable("")
    var status by observable("请登记设备或选择已有绑定")
    var busy by observable(false)
    var devicesText by observable("")
    var catalogText by observable("")
    var sessionId by observable("")
    var historyText by observable("")
    private val epoch = RemoteConnectionEpoch()
    private var target: BoundAgent? = null
    private var auth: RemoteAuthRepository? = null
    private var client: RemoteDaemonClient? = null
    private var history = RemoteHistorySnapshot()
    private var alive = true
    private var sequence = 0L
    private var streamToken: CancelToken? = null
    private var pendingRefresh = false
    private var connected = false
    private var remoteSessions: List<AgentRpc.CatalogEntry> = emptyList()
    var streamStatus by observable("未订阅")
    var deleteConfirm by observable(false)
    private fun account() = AuthRepository.storedUsername().orEmpty()
    private fun vault() = RemoteCredentialVault(SecureStores.get())

    override fun didInit() {
        super.didInit()
        refreshDevices()
        AgentRegistry.active(account())?.takeIf { it.remoteInstanceId.isNotBlank() }?.let { select(it) }
    }

    private fun refreshDevices() {
        devicesText = AgentRegistry.list(account()).joinToString("\n") {
            "${it.name} · ${if (it.remoteInstanceId.isBlank()) "旧绑定，需重新登记" else it.remoteInstanceId}"
        }.ifBlank { "暂无绑定" }
    }

    private fun select(agent: BoundAgent) {
        stopSubscription()
        connected = false
        deleteConfirm = false
        epoch.advance()
        target = agent
        address = agent.publicUrl.ifBlank { agent.lanUrl }
        workspace = agent.workspaceId
        displayName = agent.name
        sessionId = ""
        loadedSession = ""
        history = RemoteHistorySnapshot()
        historyText = ""
        catalogText = ""
        remoteSessions = emptyList()
        val repository = RemoteAuthRepository(address, account(), agent.deviceId, vault())
        auth = repository
        client = RemoteDaemonClient(address, repository::token, nextRequestId = { "${currentTimeMillis()}-${sequence++}" }, invalidateToken = repository::invalidateToken)
        status = "已选择 ${agent.name}，点击连接读取"
    }

    private fun <T> run(work: () -> T, success: (T) -> Unit) {
        if (busy) return
        val owner = account()
        if (owner.isBlank()) { status = "请先登录，不能匿名保存设备凭据"; return }
        val stamp = epoch.current()
        val loginEpoch = com.sa.demo.auth.LocalSessionEpoch.current()
        busy = true
        asyncRun({
            check(com.sa.demo.auth.LocalSessionEpoch.current() == loginEpoch && account() == owner) { "登录会话已改变" }
            work()
        }) { result ->
            postToKuikly {
                if (!alive || !epoch.accepts(stamp) || account() != owner || com.sa.demo.auth.LocalSessionEpoch.current() != loginEpoch) return@postToKuikly
                busy = false
                result.fold(success, { failure ->
                    status = when (failure) {
                        is RemoteAuthException -> failure.message.orEmpty()
                        is RemoteRpcException -> AgentRpc.describeError(failure.failure.code, failure.failure.message)
                        is IllegalArgumentException -> failure.message ?: "配置或协议无效"
                        else -> "网络或存储失败；请检查连接后重试"
                    }
                })
                if (pendingRefresh) {
                    pendingRefresh = false
                    if (streamToken?.isCancelled == false) readHistory()
                }
            }
        }
    }

    fun enroll() {
        if (workspace.isBlank()) { status = "请填写部署方提供的 workspaceId"; return }
        val invalid = RemoteEndpoint.validate(address)
        if (invalid != null) { status = invalid; return }
        val owner = account()
        val id = AgentRegistry.newDeviceId()
        val url = address.trim().trimEnd('/')
        val ws = workspace.trim()
        val label = displayName.trim().ifBlank { "电脑" }
        val secret = enrollmentSecret
        val name = protocolName
        val sessionEpoch = com.sa.demo.auth.LocalSessionEpoch.current()
        run({
            val credentialVault = vault()
            val repository = RemoteAuthRepository(url, owner, id, credentialVault, persistCredential = { receipt ->
                com.sa.demo.auth.LocalSessionEpoch.ifCurrent(sessionEpoch) {
                    check(account() == owner) { "登录账号已改变" }
                    credentialVault.save(owner, id, receipt)
                }
            })
            val receipt = repository.enroll(secret, name)
            val agent = BoundAgent(deviceId = id, name = label, idpSub = owner,
                preferredMode = AgentConnectMode.PUBLIC_HTTP.name, publicUrl = url, useRelay = false,
                remoteInstanceId = receipt.instanceId, enrolledDeviceId = receipt.enrolledDeviceId, workspaceId = ws)
            try {
                com.sa.demo.auth.LocalSessionEpoch.ifCurrent(sessionEpoch) {
                    check(account() == owner) { "登录账号已改变" }
                    AgentRegistry.upsert(owner, agent)
                }
            } catch (e: Exception) { repository.forget(); throw e }
            agent
        }) { agent ->
            enrollmentSecret = ""
            AgentRegistry.setActive(owner, id)
            select(agent)
            refreshDevices()
            status = "登记已保存，点击连接读取验证能力"
        }
    }

    fun connect() {
        val agent = target ?: run { status = "请先登记或选择已有绑定"; return }
        val rpc = client ?: return
        val context = RemoteRequestContext(agent.workspaceId)
        stopSubscription()
        connected = false
        run({
            val init = rpc.initialize()
            require(init.instanceId == agent.remoteInstanceId) { "实例身份与登记回执不符，请检查地址" }
            require("session/catalog" in init.capabilities) { "目标没有目录读取能力" }
            init to rpc.catalog(context)
        }) { (init, catalog) ->
            connected = true
            remoteSessions = catalog.entries
            catalogText = catalog.entries.joinToString("\n") { "${it.id} · ${it.title}" }.ifBlank { "暂无会话" }
            status = "已连接 · ${init.instanceId} · 只读模式" + if (!init.sandboxEnforcing) " · 执行沙箱未就绪" else ""
        }
    }

    fun readHistory() {
        val agent = target ?: return
        val rpc = client ?: return
        if (!connected) { status = "请先连接验证实例身份"; return }
        val selected = sessionId.trim()
        if (selected.isBlank()) { status = "从目录复制远程会话 ID 后读取"; return }
        val previous = if (loadedSession == selected) history else RemoteHistorySnapshot()
        run({
            val context = RemoteRequestContext(agent.workspaceId, selected)
            var snapshot = previous
            var resetCount = 0
            var pages = 0
            do {
                val page = rpc.events(context, snapshot.nextSeq, snapshot.generation, 200)
                snapshot = RemoteHistorySync.merge(snapshot, page)
                if (snapshot.resetReason != null) {
                    require(++resetCount <= 1) { "历史代次反复变化，请稍后重试" }
                    snapshot = RemoteHistorySync.merge(snapshot, rpc.events(context, limit = 200))
                }
                pages++
            } while (snapshot.hasMore && pages < 10)
            snapshot
        }) { snapshot ->
            history = snapshot
            loadedSession = selected
            historyText = snapshot.events.joinToString("\n\n") { "#${it.seq} ${it.eventType}\n${it.data}" }.ifBlank { "暂无已持久化事件" }
            status = if (snapshot.hasMore) "已读取一批，继续点击补读" else "历史已同步（最多缓存 2000 条）"
        }
    }
    private var loadedSession = ""

    fun stopSubscription() {
        streamToken?.cancel()
        streamToken = null
        pendingRefresh = false
        streamStatus = "订阅已停止"
    }

    fun subscribe() {
        if (busy || !connected) { status = "请先连接并读取历史"; return }
        stopSubscription()
        val agent = target ?: return
        val repository = auth ?: return
        val selected = sessionId.trim()
        if (selected.isBlank()) { status = "请先选择远程会话"; return }
        val token = CancelToken()
        streamToken = token
        val stamp = epoch.current()
        val owner = account()
        val subscription = RemoteEventSubscription(agent.publicUrl.ifBlank { agent.lanUrl }, selected, repository)
        fun dispatch(action: () -> Unit) = postToKuikly {
            if (alive && !token.isCancelled && epoch.accepts(stamp) && account() == owner && sessionId.trim() == selected) action()
        }
        asyncRun({
            subscription.run(token, { message -> dispatch { streamStatus = message } }, {
                dispatch {
                    if (busy) pendingRefresh = true else readHistory()
                }
            })
        }) { dispatch { if (!streamStatus.contains("撤销") && !streamStatus.contains("无效")) streamStatus = "订阅已结束" } }
        streamStatus = "事件订阅连接中"
    }

    private var resumeSubscription = false

    override fun pageDidDisappear() {
        resumeSubscription = streamToken?.isCancelled == false
        stopSubscription()
        epoch.advance()
        busy = false
        super.pageDidDisappear()
    }

    override fun pageDidAppear() {
        super.pageDidAppear()
        if (resumeSubscription && alive && account().isNotBlank()) {
            resumeSubscription = false
            subscribe()
            readHistory()
        }
    }

    fun cycleDevice() {
        if (busy) return
        val devices = AgentRegistry.list(account()).filter { it.remoteInstanceId.isNotBlank() }
        if (devices.isEmpty()) { status = "暂无已登记设备"; return }
        val next = devices[(devices.indexOfFirst { it.deviceId == target?.deviceId } + 1) % devices.size]
        select(next)
        AgentRegistry.setActive(account(), next.deviceId)
    }

    fun cycleSession() {
        if (busy) return
        if (remoteSessions.isEmpty()) { status = "请先读取非空会话目录"; return }
        val index = (remoteSessions.indexOfFirst { it.id == sessionId.trim() } + 1) % remoteSessions.size
        changeSession(remoteSessions[index].id)
        status = "已选择 ${remoteSessions[index].title}；只读选择，不调用 session/select"
    }

    fun changeSession(value: String) {
        if (value.trim() == sessionId.trim()) return
        stopSubscription()
        epoch.advance()
        busy = false
        sessionId = value
        history = RemoteHistorySnapshot()
        loadedSession = ""
        historyText = ""
    }

    fun forget() {
        val agent = target ?: return
        if (busy) return
        if (!deleteConfirm) { deleteConfirm = true; status = "再次点击删除，确认清除本地凭据；不会撤销服务端设备"; return }
        stopSubscription()
        auth?.forget()
        AgentRegistry.remove(account(), agent.deviceId)
        epoch.advance()
        target = null; auth = null; client = null
        history = RemoteHistorySnapshot(); historyText = ""; catalogText = ""
        status = "本地绑定已删除；服务端撤销请由 PC 管理入口操作"
        refreshDevices()
    }

    override fun pageWillDestroy() {
        alive = false
        stopSubscription()
        epoch.advance()
        auth?.invalidateToken()
        enrollmentSecret = ""
        super.pageWillDestroy()
    }

    override fun body(): ViewBuilder = {
        val page = this@RemoteDevicesPage
        attr { backgroundColor(Color.parseString16ToLong(SaUIColors.BgPage)) }
        Column {
            attr { flex(1f); padding(top = 36f, left = 16f, right = 16f) }
            Text { attr { text("PC Agent · 安全只读接入"); fontSize(20f); fontWeightBold() } }
            Scroller {
                attr { flex(1f) }
                Column {
                    page.field("HTTPS 服务地址", page.address) { page.address = it }.invoke(this)
                    page.field("workspaceId（部署方提供）", page.workspace) { page.workspace = it }.invoke(this)
                    page.field("电脑显示名", page.displayName) { page.displayName = it }.invoke(this)
                    page.field("手机协议名（ASCII）", page.protocolName) { page.protocolName = it }.invoke(this)
                    page.field("一次性登记秘密", page.enrollmentSecret, secret = true) { page.enrollmentSecret = it }.invoke(this)
                    SaButton.build("登记新设备", disabled = page.busy) { page.enroll() }.invoke(this)
                    SaButton.build("切换已有设备", variant = SaButton.Variant.TEXT, disabled = page.busy) { page.cycleDevice() }.invoke(this)
                    Text { attr { text(page.devicesText); fontSize(12f); margin(top = 8f) } }
                    SaButton.build("连接并读取目录", disabled = page.busy) { page.connect() }.invoke(this)
                    Text { attr { text(page.status); fontSize(13f); margin(top = 8f, bottom = 8f) } }
                    Text { attr { text(page.catalogText); fontSize(12f) } }
                    SaButton.build("选择下一个会话", variant = SaButton.Variant.TEXT, disabled = page.busy) { page.cycleSession() }.invoke(this)
                    Text { attr { text("上方地址等字段用于新登记；读取始终使用已选绑定的已保存配置。"); fontSize(12f) } }
                    page.field("远程会话 ID（来自目录）", page.sessionId) { page.changeSession(it) }.invoke(this)
                    SaButton.build("读取 / 继续补读历史", disabled = page.busy) { page.readHistory() }.invoke(this)
                    SaButton.build("订阅事件并自动补读", disabled = page.busy) { page.subscribe() }.invoke(this)
                    SaButton.build("停止订阅", variant = SaButton.Variant.TEXT) { page.stopSubscription() }.invoke(this)
                    Text { attr { text(page.streamStatus); fontSize(12f) } }
                    Text { attr { text(page.historyText); fontSize(12f); margin(top = 12f) } }
                    Text { attr { text("只读接入：不会启动、取消任务或回答审批。"); fontSize(12f); margin(top = 12f) } }
                    SaButton.build("删除本地绑定", variant = SaButton.Variant.DANGER_OUTLINE, disabled = page.busy) { page.forget() }.invoke(this)
                }
            }
            HomeTabs.build(HomeTabs.DEVICES).invoke(this)
        }
    }

    private fun field(label: String, value: String, secret: Boolean = false, change: (String) -> Unit): ViewBuilder = {
        Text { attr { text(label); fontSize(12f); margin(top = 8f) } }
        Input {
            attr { text(value); height(40f); fontSize(14f); if (secret) keyboardTypePassword() }
            event { textDidChange { change(it.text) } }
        }
    }
}
