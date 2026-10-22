package com.sa.demo.feature.chat

import com.sa.demo.auth.AuthRepository
import com.sa.demo.chat.ChatRepository
import com.sa.demo.chat.ChatUiMessage
import com.sa.demo.chat.RetryRewind
import com.sa.demo.core.platform.PageRouterBridge
import com.sa.demo.core.platform.CancelToken
import com.sa.demo.core.platform.asyncRun
import com.sa.demo.core.platform.copyToClipboard
import com.sa.demo.core.platform.currentTimeMillis
import com.sa.demo.core.platform.postToMain
import com.sa.demo.env.SaaiEnv
import com.sa.demo.feature.home.HomeTabs
import com.sa.demo.history.CloudSyncApi
import com.sa.demo.history.CloudTaskRef
import com.sa.demo.history.Conversation
import com.sa.demo.history.ConversationMessage
import com.sa.demo.history.LocalHistoryRepository
import com.sa.demo.history.ProjectBrief
import com.sa.demo.saui.base.SaButton
import com.sa.demo.saui.token.SaUIColors
import com.sa.demo.saui.token.SaUIRadius
import com.sa.demo.saui.token.SaUISpacing
import com.sa.demo.saui.chat.ChatMessageBubble
import com.sa.demo.saui.chat.StreamingInputBar
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

@Page("ChatPage")
class ChatPage : Pager() {

    var status by observable("")
    var draft by observable("")
    var projectName by observable("")
    var busy by observable(false)
    var useStream by observable(true)
    var selectedModel by observable("")
    var models by observable(listOf<String>())
    var messages by observable(listOf<ChatUiMessage>())
    var convList by observable(listOf<Conversation>())
    var projectList by observable(listOf<ProjectBrief>())
    var activeConvId by observable("")
    var activeKind by observable("chat")
    var tasks by observable(listOf<CloudTaskRef>())
    var cloudHint by observable("历史：本地优先")
    var panel by observable(0)
    var modelPickerOpen by observable(false)

    private var booted = false
    private val history = mutableListOf<com.sa.demo.chat.ChatTurn>()

    // 请求身份句柄（含任务提交/非流式）；用于隔离迟到回调，不代表可取消。
    private var streamToken: CancelToken? = null
    // 仅 completeStream 执行阶段提供停止能力，独立于发送占用和输出偏好。
    private var streamCancellable by observable(false)
    // 请求开始前的历史长度；失败时 user 已删，不能再删除上一轮完整对话。
    private var retryHistorySize: Int? = null

    private fun userId(): String = AuthRepository.storedUsername() ?: "anon"

    private fun bootstrap() {
        if (booted) return
        booted = true
        if (!AuthRepository.isLoggedIn()) {
            status = "请先登录"
            return
        }
        refreshHistory()
        if (activeConvId.isBlank()) newConversation("chat")
        loadModels()
        probeCloud()
    }

    private fun probeCloud() {
        val env = SaaiEnv.current
        val bearer = AuthRepository.storedApiKey() ?: return
        asyncRun({ CloudSyncApi.probeHistorySupport(env, bearer) }) { r ->
            r.fold(
                onSuccess = { cloudHint = it.detail },
                onFailure = { cloudHint = "云端探测失败：${it.message}" },
            )
        }
    }

    fun selectPanel(p: Int) {
        panel = p
    }

    fun setKindChat() {
        newConversation("chat")
    }

    fun setKindTask() {
        newConversation("task")
    }

    fun newConversation(kind: String) {
        if (blockConversationChange()) return
        val id = LocalHistoryRepository.newConversationId()
        val conv = Conversation(
            id = id,
            userId = userId(),
            title = if (kind == "task") "新任务" else "新对话",
            kind = kind,
            model = selectedModel.ifBlank { null },
        )
        LocalHistoryRepository.upsertConversation(userId(), conv)
        activeConvId = id
        activeKind = kind
        messages = emptyList()
        history.clear()
        retryHistorySize = null
        tasks = emptyList()
        status = if (kind == "task") "新任务会话" else "新对话"
        detailSafe(id)
        refreshHistory()
        panel = 0
    }

    private var detailText by observable("")

    private fun detailSafe(s: String) {
        detailText = s
    }

    private fun blockConversationChange(): Boolean {
        if (streamToken == null && !busy) return false
        status = "请等待当前请求结束（流式生成可先停止）再切换会话"
        return true
    }

    fun openConversation(id: String) {
        if (blockConversationChange()) return
        val conv = LocalHistoryRepository.getConversation(userId(), id) ?: return
        activeConvId = conv.id
        activeKind = conv.kind
        history.clear()
        retryHistorySize = null
        history.addAll(conv.messages.map { com.sa.demo.chat.ChatTurn(it.role, it.content) })
        messages = conv.messages.map { ChatUiMessage(it.role, it.content) }
        tasks = conv.tasks
        conv.model?.let { selectedModel = it }
        status = "已打开：${conv.title}"
        detailText = "本地历史 · ${conv.messages.size} 条"
        panel = 0
    }

    fun deleteConversation(id: String) {
        if (id == activeConvId && blockConversationChange()) return
        LocalHistoryRepository.deleteConversation(userId(), id)
        if (activeConvId == id) newConversation(activeKind) else refreshHistory()
    }

    fun createProject() {
        val name = projectName.trim().ifEmpty { "项目-${currentTimeMillis() % 10000}" }
        val p = ProjectBrief(
            id = LocalHistoryRepository.newProjectId(),
            userId = userId(),
            name = name,
            summary = "移动端本地项目",
            conversationIds = listOfNotNull(activeConvId.ifBlank { null }),
        )
        LocalHistoryRepository.upsertProject(userId(), p)
        projectName = ""
        refreshHistory()
        status = "已创建项目 ${p.name}"
        panel = 3
    }

    fun openProject(id: String) {
        if (blockConversationChange()) return
        val p = LocalHistoryRepository.listProjects(userId()).firstOrNull { it.id == id } ?: return
        val first = p.conversationIds.firstOrNull()
        if (first != null) openConversation(first)
        status = "项目 ${p.name}"
    }

    private fun refreshHistory() {
        convList = LocalHistoryRepository.listConversations(userId())
        projectList = LocalHistoryRepository.listProjects(userId())
    }

    private fun persistActive() {
        val id = activeConvId.ifBlank { return }
        val existing = LocalHistoryRepository.getConversation(userId(), id) ?: return
        val msgs = history.map { ConversationMessage(it.role, it.content) }
        val firstUser = msgs.firstOrNull { it.role == "user" }?.content
        val title = when {
            existing.title != "新对话" && existing.title != "新任务" -> existing.title
            firstUser != null -> firstUser.take(24)
            else -> existing.title
        }
        LocalHistoryRepository.upsertConversation(
            userId(),
            existing.copy(
                title = title,
                messages = msgs,
                tasks = tasks,
                model = selectedModel.ifBlank { existing.model },
            ),
        )
        refreshHistory()
        detailText = "已写入本地历史"
    }

    fun onDraftChange(text: String) {
        draft = text
    }

    /** 切换流式/非流式输出（StreamingInputBar 的流式开关，回调签名为 (Boolean) -> Unit）。 */
    fun toggleStream(next: Boolean) {
        if (useStream == next) return
        useStream = next
        status = if (useStream) "已切换为流式输出" else "已切换为非流式输出"
    }

    /** 按模型 id 选中（StreamingInputBar 的模型切换）。 */
    fun selectModel(id: String) {
        if (id.isBlank() || id !in models) return
        selectedModel = id
        modelPickerOpen = false
        status = "模型 $id"
    }

    /** 展开/收起模型下拉（状态提升到 Pager，符合 Kuikly 无组件内状态的约定）。 */
    fun toggleModelPicker() {
        modelPickerOpen = !modelPickerOpen
    }

    /**
     * 停止当前流式生成。
     *
     * 取消后后台线程会在下一个 delta（或连接断开）时返回，
     * 已生成的部分内容会被保留并写入历史——不丢弃用户已付费的 token。
     */
    fun stopStreaming() {
        val token = streamToken ?: return
        if (!busy || !streamCancellable) return
        streamCancellable = false
        token.cancel()
        status = "正在停止…"
    }

    private fun beginStream(token: CancelToken, convId: String) {
        if (streamToken !== token || activeConvId != convId || !busy) return
        streamCancellable = true
    }

    /** 长按消息气泡 → 复制原文。 */
    fun copyMessage(content: String) {
        val text = content.trim()
        if (text.isEmpty()) return
        status = if (copyToClipboard("SaApp", text)) "已复制" else "复制失败：当前平台不支持"
    }

    fun onProjectNameChange(text: String) {
        projectName = text
    }

    fun backToLogin() {
        PageRouterBridge.open("LoginPage")
    }

    fun loadModels() {
        if (busy || streamToken != null) return
        val env = SaaiEnv.current
        busy = true
        status = "加载模型…"
        asyncRun({ AuthRepository.fetchModels(env).map { it.id } }) { result ->
            busy = false
            result.fold(
                onSuccess = { ids ->
                    models = ids
                    if (selectedModel.isBlank() || selectedModel !in ids) {
                        selectedModel = ids.firstOrNull() ?: ""
                    }
                    status = if (ids.isEmpty()) "无可用模型（网关未 seed）" else "就绪 · ${ids.size} 模型"
                },
                onFailure = { err -> status = "模型加载失败：${err.message}" },
            )
        }
    }

    fun pickModel(index: Int) {
        val id = models.getOrNull(index) ?: return
        selectedModel = id
        status = "模型 $id"
    }

    fun send() = sendWithPrompt(draft)

    /**
     * 重发上一条用户消息（失败/已停止气泡的「重试」入口）。
     *
     * 先把末尾的「助手轮 + 用户轮」一并从 history 摘掉，再由 [send] 重新写入，
     * 否则已停止路径（此时 user 轮仍在 history 里）会被追加成两条相同的 user 记录。
     */
    fun retryLast() {
        if (busy) return
        val lastUser = messages.lastOrNull { it.isUser } ?: run {
            status = "没有可重试的用户消息"
            return
        }
        // UI 与 history 一样回退整轮；send 会重新追加用户气泡。
        val lastUserIndex = messages.indexOfLast { it.isUser }
        messages = messages.take(lastUserIndex)
        // history 侧同样回退：去掉可能的助手轮 + 紧随其后的用户轮（纯逻辑见 RetryRewind）
        val rewound = retryHistorySize?.let { history.take(it) }
            ?: if (history.size <= lastUserIndex) history.toList() else RetryRewind.rewind(history)
        history.clear()
        history.addAll(rewound)
        draft = lastUser.content
        status = "重新发送…"
        send()
    }

    private fun applyStreamDelta(token: CancelToken, convId: String, content: String) {
        if (streamToken !== token || activeConvId != convId) return
        val list = messages.toMutableList()
        if (list.isNotEmpty()) {
            list[list.lastIndex] = ChatUiMessage("assistant", content, streaming = true)
            messages = list
        }
    }

    private fun sendWithPrompt(raw: String) {
        val text = raw.trim()
        if (busy || streamToken != null) return
        if (text.isEmpty()) {
            status = "请输入内容"
            return
        }
        if (selectedModel.isBlank()) {
            status = "请先选择模型"
            return
        }
        val env = SaaiEnv.current
        val model = selectedModel
        val stream = useStream
        val kind = activeKind
        val bearer = AuthRepository.storedApiKey()
        val convId = activeConvId

        retryHistorySize = history.size
        history.add(com.sa.demo.chat.ChatTurn("user", text))
        val pending = history.toList()
        messages = messages + ChatUiMessage("user", text) + ChatUiMessage("assistant", "", streaming = true)
        draft = ""
        busy = true

        // 每次请求换身份；仅进入 completeStream 后允许停止。
        val token = CancelToken()
        streamToken = token
        streamCancellable = false

        var taskLocalId: String? = null
        if (kind == "task") {
            val taskId = LocalHistoryRepository.newTaskId()
            taskLocalId = taskId
            tasks = tasks + CloudTaskRef(
                taskId = taskId,
                title = text.take(32),
                status = "running",
                detail = "探测云端任务接口并执行…",
            )
            status = "云端任务处理中…"
        } else {
            status = if (stream) "流式生成中…" else "生成中…"
        }

        asyncRun({
            val submit = if (kind == "task") {
                if (bearer != null) {
                    CloudSyncApi.submitTask(env, bearer, text.take(32), text, convId)
                } else {
                    CloudSyncApi.TaskSubmitResult(false, null, "无 api_key")
                }
            } else {
                CloudSyncApi.TaskSubmitResult(true, null, "")
            }
            val reply = if (stream) {
                postToMain { beginStream(token, convId) }
                val acc = StringBuilder()
                ChatRepository.completeStream(env, model, pending, onDelta = { delta ->
                    acc.append(delta)
                    val snap = acc.toString()
                    postToMain { applyStreamDelta(token, convId, snap) }
                }, token = token)
            } else {
                ChatRepository.complete(env, model, pending)
            }
            Triple(submit, reply, token.isCancelled)
        }) { result ->
            finishRequest(token, convId, kind, taskLocalId, result)
        }
    }

    private fun finishRequest(
        token: CancelToken,
        convId: String,
        kind: String,
        taskLocalId: String?,
        result: Result<Triple<CloudSyncApi.TaskSubmitResult, String, Boolean>>,
    ) {
            if (streamToken !== token || activeConvId != convId) return
            streamCancellable = false
            streamToken = null
            busy = false
            result.fold(
                onSuccess = { triple ->
                    val submit = triple.first
                    val reply = triple.second
                    val wasCancelled = triple.third
                    streamToken = null

                    // 用户主动停止：保留已生成的部分内容，不当作完成
                    if (wasCancelled) {
                        history.add(com.sa.demo.chat.ChatTurn("assistant", reply))
                        val list = messages.toMutableList()
                        if (list.isNotEmpty()) {
                            list[list.lastIndex] = ChatUiMessage(
                                "assistant",
                                reply.ifBlank { "（已停止，未生成内容）" },
                                streaming = false,
                                retryable = true,
                            )
                            messages = list
                        }
                        status = "已停止"
                        detailText = if (reply.isBlank()) "未生成内容" else "已保留 ${reply.length} 字"
                        if (kind == "task") {
                            tasks = tasks.map {
                                if (it.status == "running") {
                                    it.copy(status = "canceled", detail = "用户已停止", updatedAt = currentTimeMillis())
                                } else it
                            }
                        }
                        persistActive()
                        return@fold
                    }

                    history.add(com.sa.demo.chat.ChatTurn("assistant", reply))
                    val list = messages.toMutableList()
                    if (list.isNotEmpty()) {
                        list[list.lastIndex] = ChatUiMessage("assistant", reply, streaming = false)
                        messages = list
                    }
                    if (kind == "task" && taskLocalId != null) {
                        val tid = taskLocalId
                        tasks = tasks.map {
                            if (it.taskId == tid) {
                                it.copy(
                                    status = if (submit.supported && submit.taskId != null) "queued" else "done",
                                    detail = if (submit.supported && submit.taskId != null) {
                                        "云端任务 ${submit.taskId}；本地已同步执行"
                                    } else {
                                        "${submit.detail}；已用网关 chat 同步完成"
                                    },
                                    updatedAt = currentTimeMillis(),
                                )
                            } else it
                        }
                        status = "任务已处理"
                        detailText = if (submit.supported && submit.taskId != null) {
                            "云端 ${submit.taskId}"
                        } else {
                            submit.detail
                        }
                    } else {
                        status = "完成"
                    }
                    persistActive()
                },
                onFailure = { err ->
                    streamToken = null
                    if (history.isNotEmpty() && history.last().role == "user") {
                        history.removeAt(history.lastIndex)
                    }
                    val list = messages.toMutableList()
                    if (list.isNotEmpty()) {
                        list[list.lastIndex] = ChatUiMessage(
                            "assistant",
                            "错误：${err.message ?: err}",
                            streaming = false,
                            retryable = true,
                        )
                        messages = list
                    }
                    if (kind == "task") {
                        tasks = tasks.map {
                            if (it.status == "running") it.copy(status = "failed", detail = err.message ?: "failed") else it
                        }
                    }
                    status = "发送失败"
                    persistActive()
                },
            )
    }

    private fun inputBarBuilder(): ViewBuilder = StreamingInputBar.build(
        draft = draft,
        busy = busy,
        useStream = useStream,
        selectedModel = selectedModel,
        models = models,
        onDraftChange = ::onDraftChange,
        onSend = ::send,
        onStop = if (busy && streamCancellable) ::stopStreaming else null,
        onModelSelect = ::selectModel,
        onToggleStream = ::toggleStream,
        modelPickerOpen = modelPickerOpen,
        onToggleModelPicker = ::toggleModelPicker,
    )

    override fun body(): ViewBuilder = {
        val page = this@ChatPage
        page.bootstrap()

        Column {
            attr {
                flex(1f)
                backgroundColor(Color.parseString16ToLong(SaUIColors.BgPage))
            }

            Row {
                attr {
                    height(48f)
                    padding(SaUISpacing.sm)
                    backgroundColor(Color.parseString16ToLong(SaUIColors.BgContainer))
                    alignItems(FlexAlign.CENTER)
                }
                Text {
                    attr {
                        text("SaApp")
                        fontSize(16f)
                        fontWeightBold()
                        color(Color.parseString16ToLong(SaUIColors.TextPrimarySolid))
                    }
                }
                listOf(0 to "对话", 1 to "历史", 2 to "任务", 3 to "项目").forEach { (p, label) ->
                    View {
                        attr {
                            margin(left = 6f)
                            padding(10f, 6f, 10f, 6f)
                            borderRadius(12f)
                            backgroundColor(
                                Color.parseString16ToLong(
                                    if (page.panel == p) SaUIColors.BrandFocus else SaUIColors.BgComponent
                                )
                            )
                        }
                        Text {
                            attr {
                                text(label)
                                fontSize(12f)
                                color(Color.parseString16ToLong(SaUIColors.TextPrimarySolid))
                            }
                        }
                        event { click { page.selectPanel(p) } }
                    }
                }
            }

            View {
                attr { padding(SaUISpacing.xs, SaUISpacing.sm) }
                Text {
                    attr {
                        text("${page.status} · ${page.cloudHint} · ${page.detailText}")
                        fontSize(11f)
                        color(Color.parseString16ToLong(SaUIColors.TextSecondarySolid))
                    }
                }
            }

            // ---------- panels ----------
            if (page.panel == 1) {
                Scroller {
                    attr { flex(1f); padding(SaUISpacing.md) }
                    Column {
                        attr { flexDirectionColumn() }
                        if (page.convList.isEmpty()) {
                            Text {
                                attr {
                                    text("暂无历史会话")
                                    fontSize(13f)
                                    color(Color.parseString16ToLong(SaUIColors.TextPlaceholderSolid))
                                }
                            }
                        }
                        page.convList.forEach { c ->
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
                                    Text {
                                        attr {
                                            text("[${c.kind}] ${c.title}")
                                            fontSize(14f)
                                            fontWeightMedium()
                                            color(Color.parseString16ToLong(SaUIColors.TextPrimarySolid))
                                        }
                                    }
                                    Text {
                                        attr {
                                            text("${c.messages.size} 条 · ${c.id}")
                                            fontSize(11f)
                                            color(Color.parseString16ToLong(SaUIColors.TextSecondarySolid))
                                            margin(top = 2f)
                                        }
                                    }
                                    Row { attr { margin(top = 6f) }
                                        SaButton.build(text = "打开", variant = SaButton.Variant.PRIMARY_OUTLINE, size = SaButton.ButtonSize.SMALL) {
                                            page.openConversation(c.id)
                                        }.invoke(this)
                                        SaButton.build(text = "删除", variant = SaButton.Variant.TEXT, size = SaButton.ButtonSize.SMALL) {
                                            page.deleteConversation(c.id)
                                        }.invoke(this)
                                    }
                                }
                            }
                        }
                    }
                }
            } else if (page.panel == 2) {
                Scroller {
                    attr { flex(1f); padding(SaUISpacing.md) }
                    Column {
                        attr { flexDirectionColumn() }
                        Text {
                            attr {
                                text("云端任务：接口未就绪时 = 本地任务卡 + 网关 chat 同步执行")
                                fontSize(12f)
                                color(Color.parseString16ToLong(SaUIColors.TextSecondarySolid))
                                margin(bottom = SaUISpacing.sm)
                            }
                        }
                        if (page.tasks.isEmpty()) {
                            Text {
                                attr {
                                    text("当前会话暂无任务")
                                    fontSize(13f)
                                    color(Color.parseString16ToLong(SaUIColors.TextPlaceholderSolid))
                                }
                            }
                        }
                        page.tasks.forEach { t ->
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
                                    Text {
                                        attr {
                                            text("${t.status} · ${t.title}")
                                            fontSize(14f)
                                            color(Color.parseString16ToLong(SaUIColors.TextPrimarySolid))
                                        }
                                    }
                                    Text {
                                        attr {
                                            text("${t.taskId} | ${t.detail}")
                                            fontSize(11f)
                                            color(Color.parseString16ToLong(SaUIColors.TextSecondarySolid))
                                            margin(top = 4f)
                                        }
                                    }
                                }
                            }
                        }
                        SaButton.build(text = "去发起任务", variant = SaButton.Variant.PRIMARY_OUTLINE, size = SaButton.ButtonSize.SMALL) {
                            page.setKindTask()
                        }.invoke(this)
                    }
                }
            } else if (page.panel == 3) {
                Scroller {
                    attr { flex(1f); padding(SaUISpacing.md) }
                    Column {
                        attr { flexDirectionColumn() }
                        Row { attr { alignItems(FlexAlign.CENTER) }
                            View {
                                attr { flex(1f); margin(right = 8f) }
                                Input {
                                    attr {
                                        height(40f)
                                        text(page.projectName)
                                        placeholder("项目名称")
                                        placeholderColor(Color(Color.parseString16ToLong(SaUIColors.TextPlaceholderSolid)))
                                        fontSize(14f)
                                        color(Color(Color.parseString16ToLong(SaUIColors.TextPrimarySolid)))
                                    }
                                    event { textDidChange { page.onProjectNameChange(it.text) } }
                                }
                            }
                            SaButton.build(text = "新建项目", variant = SaButton.Variant.PRIMARY, size = SaButton.ButtonSize.SMALL) {
                                page.createProject()
                            }.invoke(this)
                        }
                        Text {
                            attr {
                                text("项目历史本地保存；云端项目同步待产品线接口")
                                fontSize(11f)
                                color(Color.parseString16ToLong(SaUIColors.TextSecondarySolid))
                                margin(top = SaUISpacing.sm)
                                margin(bottom = SaUISpacing.sm)
                            }
                        }
                        page.projectList.forEach { p ->
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
                                    Text {
                                        attr {
                                            text(p.name)
                                            fontSize(14f)
                                            fontWeightMedium()
                                            color(Color.parseString16ToLong(SaUIColors.TextPrimarySolid))
                                        }
                                    }
                                    Text {
                                        attr {
                                            text("${p.summary} · 会话 ${p.conversationIds.size}")
                                            fontSize(11f)
                                            color(Color.parseString16ToLong(SaUIColors.TextSecondarySolid))
                                            margin(top = 2f)
                                        }
                                    }
                                    SaButton.build(text = "打开", variant = SaButton.Variant.TEXT, size = SaButton.ButtonSize.SMALL) {
                                        page.openProject(p.id)
                                    }.invoke(this)
                                }
                            }
                        }
                    }
                }
            } else {
                // chat / task panel
                Row {
                    attr {
                        padding(SaUISpacing.sm)
                        backgroundColor(Color.parseString16ToLong(SaUIColors.BgContainer))
                        alignItems(FlexAlign.CENTER)
                    }
                    listOf("chat" to "对话", "task" to "云端任务").forEach { (k, label) ->
                        val selected = page.activeKind == k
                        View {
                            attr {
                                margin(right = 8f)
                                padding(10f, 6f, 10f, 6f)
                                borderRadius(12f)
                                backgroundColor(
                                    Color.parseString16ToLong(
                                        if (selected) SaUIColors.BrandPrimary else SaUIColors.BgComponent
                                    )
                                )
                            }
                            Text {
                                attr {
                                    text(label)
                                    fontSize(12f)
                                    color(
                                        Color.parseString16ToLong(
                                            if (selected) SaUIColors.TextAnti else SaUIColors.TextSecondarySolid
                                        )
                                    )
                                }
                            }
                            event {
                                click { if (k == "task") page.setKindTask() else page.setKindChat() }
                            }
                        }
                    }
                    page.models.take(4).forEachIndexed { index, id ->
                        val selected = id == page.selectedModel
                        View {
                            attr {
                                margin(right = 6f)
                                padding(8f, 4f, 8f, 4f)
                                borderRadius(10f)
                                backgroundColor(
                                    Color.parseString16ToLong(
                                        if (selected) SaUIColors.BrandFocus else SaUIColors.BgComponent
                                    )
                                )
                            }
                            Text {
                                attr {
                                    text(id)
                                    fontSize(11f)
                                    color(Color.parseString16ToLong(SaUIColors.TextPrimarySolid))
                                }
                            }
                            event { click { page.pickModel(index) } }
                        }
                    }
                }

                Scroller {
                    attr { flex(1f); padding(SaUISpacing.md) }
                    Column {
                        attr { flexDirectionColumn() }
                        if (page.messages.isEmpty()) {
                            View {
                                attr { padding(SaUISpacing.lg) }
                                Text {
                                    attr {
                                        text(
                                            if (page.activeKind == "task")
                                                "描述要云端处理的任务；接口未就绪时本地任务卡 + 网关 chat 同步执行"
                                            else
                                                "发送消息，经网关 /v1/chat/completions；结束后自动写入本地历史"
                                        )
                                        fontSize(13f)
                                        color(Color.parseString16ToLong(SaUIColors.TextPlaceholderSolid))
                                    }
                                }
                            }
                        }
                        page.messages.forEach { msg ->
                            ChatMessageBubble.build(
                                content = msg.content,
                                role = if (msg.isUser) ChatMessageBubble.Role.USER else ChatMessageBubble.Role.ASSISTANT,
                                streaming = msg.streaming,
                                onCopy = { page.copyMessage(msg.content) },
                                // 只给失败/已停止的助手消息加重试入口
                                onRetry = if (msg.retryable) {
                                    { page.retryLast() }
                                } else {
                                    null
                                }
                            ).invoke(this)
                        }
                    }
                }

                View {
                    attr {
                        padding(SaUISpacing.md)
                        backgroundColor(Color.parseString16ToLong(SaUIColors.BgContainer))
                    }
                    Column {
                        attr { flexDirectionColumn() }

                        // 替换为 StreamingInputBar
                        page.inputBarBuilder().invoke(this)

                        // 辅助操作按钮
                        Row {
                            attr { margin(top = 6f); alignItems(FlexAlign.CENTER) }
                            SaButton.build(text = "新对话", variant = SaButton.Variant.TEXT, size = SaButton.ButtonSize.SMALL) {
                                page.setKindChat()
                            }.invoke(this)
                            SaButton.build(text = "新任务", variant = SaButton.Variant.TEXT, size = SaButton.ButtonSize.SMALL) {
                                page.setKindTask()
                            }.invoke(this)
                            SaButton.build(text = "刷新模型", variant = SaButton.Variant.TEXT, size = SaButton.ButtonSize.SMALL) {
                                page.loadModels()
                            }.invoke(this)
                            SaButton.build(text = "我的电脑", variant = SaButton.Variant.TEXT, size = SaButton.ButtonSize.SMALL) {
                                PageRouterBridge.open("AgentPage")
                            }.invoke(this)
                            SaButton.build(text = "绑定电脑", variant = SaButton.Variant.TEXT, size = SaButton.ButtonSize.SMALL) {
                                PageRouterBridge.push("BindAgentPage")
                            }.invoke(this)
                            SaButton.build(text = "退出", variant = SaButton.Variant.TEXT, size = SaButton.ButtonSize.SMALL) {
                                AuthRepository.logoutLocal()
                                page.backToLogin()
                            }.invoke(this)
                        }
                    }
                }
            }

            // 底部导航放最后——Column 首个子节点在顶部，导航必须在内容之下
            HomeTabs.build(HomeTabs.CHAT).invoke(this)
        }
    }
}
