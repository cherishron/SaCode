package com.sa.demo.feature.login

import com.sa.demo.auth.AuthRepository
import com.sa.demo.auth.OAuthBridge
import com.sa.demo.auth.Pkce
import com.sa.demo.core.platform.PageRouterBridge
import com.sa.demo.core.platform.asyncRun
import com.sa.demo.core.platform.openUrlInBrowser
import com.sa.demo.env.SaaiEnv
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
import io.github.aakira.napier.Napier

/**
 * 移动端登录：**App 内直调 sa-idp 接口**（短信 / 密码 / 注册），
 * 随后 exchange 网关 api_key。浏览器 OAuth 仅作可选兜底。
 */
@Page("LoginPage")
class LoginPage : Pager() {

    companion object {
        private const val MODE_SMS = 0
        private const val MODE_PASSWORD = 1
        private const val MODE_REGISTER = 2
    }

    var status by observable("未登录")
    var detail by observable("")
    var busy by observable(false)
    var loggedIn by observable(false)
    var models by observable(listOf<String>())
    var mode by observable(MODE_SMS)

    var phone by observable("")
    var smsCode by observable("")
    var username by observable("")
    var password by observable("")
    var regPassword by observable("")
    var smsHint by observable("开发期验证码固定 123456")

    private var bootstrapped = false
    private val env: SaaiEnv get() = SaaiEnv.current

    private fun bootstrap() {
        if (bootstrapped) return
        bootstrapped = true
        val env = SaaiEnv.current
        if (AuthRepository.hasRefreshToken() || AuthRepository.isLoggedIn()) {
            loggedIn = AuthRepository.isLoggedIn()
            status = if (loggedIn) "已登录" else "静默续期…"
            detail = "一周免登录：短 access + 自动 refresh"
            // 后台尝试 ensureSession（access 过期则用 refresh 换新）
            asyncRun({ AuthRepository.ensureSession(env) }) { r ->
                r.fold(
                    onSuccess = {
                        loggedIn = true
                        status = "会话有效"
                        detail = "已自动 refresh（若 access 临近过期）"
                        if (models.isEmpty()) loadModels()
                    },
                    onFailure = { err ->
                        loggedIn = AuthRepository.isLoggedIn()
                        status = if (loggedIn) "会话可能过期" else "请登录"
                        detail = err.message ?: "refresh 失败"
                    },
                )
            }
        } else {
            loggedIn = false
            status = "未登录"
            detail = "登录后本机保存 refresh，可约一周免登录"
        }
        OAuthBridge.listener = { cb ->
            handleOAuthCallback(cb.code, cb.state, cb.error, cb.errorDescription)
        }
        OAuthBridge.consumePending()?.let { cb ->
            handleOAuthCallback(cb.code, cb.state, cb.error, cb.errorDescription)
        }
    }

    fun selectMode(m: Int) {
        mode = m
        status = when (m) {
            MODE_SMS -> "短信登录"
            MODE_PASSWORD -> "密码登录"
            MODE_REGISTER -> "手机注册"
            else -> status
        }
        detail = ""
    }

    fun sendSms(scene: String = "login") {
        if (busy) return
        val p = phone.trim()
        if (p.length < 11) {
            status = "请输入 11 位手机号"
            return
        }
        busy = true
        status = "发送验证码…"
        asyncRun({ AuthRepository.sendSmsCode(env, p, scene) }) { result ->
            busy = false
            result.fold(
                onSuccess = { r ->
                    status = "验证码已发送"
                    smsHint = r.hint ?: r.dev_hint ?: "开发期固定 123456"
                    detail = smsHint
                },
                onFailure = { err ->
                    status = "发送失败"
                    detail = err.message ?: err.toString()
                },
            )
        }
    }

    fun loginSms() {
        if (busy) return
        val p = phone.trim()
        val c = smsCode.trim()
        if (p.length < 11 || c.isEmpty()) {
            status = "请填写手机号与验证码"
            return
        }
        busy = true
        status = "短信登录中…"
        detail = ""
        asyncRun({ AuthRepository.loginSms(env, p, c) }) { result -> afterAuth(result, "短信登录") }
    }

    fun loginPassword() {
        if (busy) return
        val u = username.trim().ifEmpty { phone.trim() }
        val pwd = password
        if (u.isEmpty() || pwd.isEmpty()) {
            status = "请填写账号与密码"
            return
        }
        busy = true
        status = "密码登录中…"
        detail = ""
        asyncRun({ AuthRepository.loginPassword(env, u, pwd) }) { result -> afterAuth(result, "密码登录") }
    }

    fun register() {
        if (busy) return
        val p = phone.trim()
        val c = smsCode.trim()
        val pwd = regPassword
        if (p.length < 11 || c.isEmpty()) {
            status = "请填写手机号与验证码"
            return
        }
        if (pwd.length < 8) {
            status = "密码至少 8 位"
            return
        }
        busy = true
        status = "注册并登录…"
        detail = ""
        asyncRun({ AuthRepository.registerPhone(env, p, c, pwd) }) { result -> afterAuth(result, "注册") }
    }

    fun enterChat() {
        PageRouterBridge.open("ChatPage")
    }

    fun loadModelsPublic() = loadModels()

    fun logout() {
        AuthRepository.logoutLocal()
        loggedIn = false
        models = emptyList()
        status = "已登出"
        detail = "本地令牌与 api_key 已清除"
    }

    /** 可选：浏览器 OAuth PKCE（非移动端主路径） */
    fun startOAuthBrowser() {
        if (busy) return
        val pkce = Pkce.generate()
        AuthRepository.savePending(pkce)
        val url = AuthRepository.buildAuthorizeUrl(env, pkce)
        status = "跳转浏览器 OAuth…"
        detail = "可选兜底路径"
        Napier.d { "oauth_authorize=$url" }
        openUrlInBrowser(url)
    }

    private fun afterAuth(
        result: Result<com.sa.demo.auth.AuthState>,
        tag: String,
    ) {
        busy = false
        result.fold(
            onSuccess = { st ->
                status = "${tag}成功"
                detail = "已 exchange 网关 api_key · ${st.username ?: ""}"
                loggedIn = true
                loadModels()
            },
            onFailure = { err ->
                status = "${tag}失败"
                detail = err.message ?: err.toString()
                loggedIn = false
            },
        )
    }

    private fun handleOAuthCallback(
        code: String?,
        state: String?,
        error: String?,
        errorDescription: String?,
    ) {
        if (!error.isNullOrBlank()) {
            status = "OAuth 失败"
            detail = errorDescription ?: error
            AuthRepository.clearPending()
            return
        }
        if (code.isNullOrBlank() || state.isNullOrBlank()) {
            status = "OAuth 回调参数不完整"
            return
        }
        busy = true
        status = "OAuth 换 token…"
        asyncRun({ AuthRepository.completeAuthorizationCode(env, code, state) }) { result ->
            afterAuth(result, "OAuth")
        }
    }

    private fun loadModels() {
        if (busy) return
        busy = true
        status = "拉取 /v1/models…"
        asyncRun({ AuthRepository.fetchModels(env).map { it.id } }) { result ->
            busy = false
            result.fold(
                onSuccess = { ids ->
                    models = ids
                    status = "模型列表（${ids.size}）"
                    detail = if (ids.isEmpty()) "当前账号暂无可见模型，请在网关 seed" else env.modelsUrl
                },
                onFailure = { err ->
                    status = "模型列表失败"
                    detail = err.message ?: err.toString()
                },
            )
        }
    }

    private fun field(
        placeholder: String,
        value: String,
        passwordField: Boolean = false,
        onChange: (String) -> Unit,
    ): ViewBuilder = {
        // 必须用 Row（横向主轴）：若用默认纵向的 View 再配 alignItems(CENTER)，
        // Input 在交叉轴（宽度）上会退化为 wrap-content，空输入框宽度为 0 → placeholder 不可见且点不到。
        Row {
            attr {
                height(44f)
                margin(bottom = SaUISpacing.sm)
                padding(left = SaUISpacing.md, right = SaUISpacing.md)
                backgroundColor(Color.parseString16ToLong(SaUIColors.BgContainer))
                borderRadius(SaUIRadius.Small)
                border(
                    com.tencent.kuikly.core.base.Border(
                        1f,
                        com.tencent.kuikly.core.base.BorderStyle.SOLID,
                        Color(Color.parseString16ToLong(SaUIColors.BorderLevel1)),
                    )
                )
                alignItems(FlexAlign.CENTER)
            }
            Input {
                attr {
                    flex(1f)
                    height(44f)
                    text(value)
                    placeholder(placeholder)
                    placeholderColor(Color(Color.parseString16ToLong(SaUIColors.TextPlaceholderSolid)))
                    fontSize(16f)
                    color(Color(Color.parseString16ToLong(SaUIColors.TextPrimarySolid)))
                    if (passwordField) keyboardTypePassword()
                }
                event {
                    textDidChange { params -> onChange(params.text) }
                }
            }
        }
    }

    override fun body(): ViewBuilder = {
        val page = this@LoginPage
        val env = SaaiEnv.current
        page.bootstrap()

        Scroller {
            attr {
                // 根容器必须 flex(1f) 才撑满页面高度；否则高度塌陷为 0 → 整页不可见（白屏）
                flex(1f)
                backgroundColor(Color.parseString16ToLong(SaUIColors.BgPage))
            }

            Column {
                attr {
                    padding(SaUISpacing.xxl, SaUISpacing.lg, SaUISpacing.xxl, SaUISpacing.lg)
                    // 注意：滚动容器内部的内容不能再用 flex(1f)，否则在 flexbox 中高度会塌陷
                }

                Text {
                    attr {
                        text("SaApp")
                        fontSize(28f)
                        fontWeightBold()
                        color(Color.parseString16ToLong(SaUIColors.TextPrimarySolid))
                    }
                }
                Text {
                    attr {
                        text("App 内直调 sa-idp · client_id=${env.clientId}")
                        fontSize(13f)
                        color(Color.parseString16ToLong(SaUIColors.TextPlaceholderSolid))
                        margin(top = SaUISpacing.sm)
                    }
                }

                // 模式切换
                Row {
                    attr {
                        margin(top = SaUISpacing.lg)
                        alignItems(FlexAlign.CENTER)
                    }
                    listOf(
                        MODE_SMS to "短信",
                        MODE_PASSWORD to "密码",
                        MODE_REGISTER to "注册",
                    ).forEach { (m, label) ->
                        val selected = page.mode == m
                        View {
                            attr {
                                margin(right = 8f)
                                padding(12f, 8f, 12f, 8f)
                                borderRadius(16f)
                                backgroundColor(
                                    Color.parseString16ToLong(
                                        if (selected) SaUIColors.BrandPrimary else SaUIColors.BgContainer
                                    )
                                )
                            }
                            Text {
                                attr {
                                    text(label)
                                    fontSize(13f)
                                    color(
                                        Color.parseString16ToLong(
                                            if (selected) SaUIColors.TextAnti else SaUIColors.TextSecondarySolid
                                        )
                                    )
                                }
                            }
                            event { click { page.selectMode(m) } }
                        }
                    }
                }

                // 表单
                View {
                    attr {
                        margin(top = SaUISpacing.md)
                        padding(SaUISpacing.lg)
                        backgroundColor(Color.parseString16ToLong(SaUIColors.BgContainer))
                        borderRadius(SaUIRadius.Medium)
                        flexDirectionColumn()
                    }
                    Column {
                        attr { flexDirectionColumn() }

                        when (page.mode) {
                            MODE_SMS -> {
                                page.field("手机号", page.phone) { page.phone = it }.invoke(this)
                                page.field("短信验证码", page.smsCode) { page.smsCode = it }.invoke(this)
                                SaButton.build(
                                    text = "发送验证码",
                                    variant = SaButton.Variant.PRIMARY_OUTLINE,
                                    size = SaButton.ButtonSize.SMALL,
                                    disabled = page.busy,
                                ) { page.sendSms("login") }.invoke(this)
                                View { attr { height(8f) } }
                                SaButton.build(
                                    text = if (page.busy) "登录中…" else "登录",
                                    variant = SaButton.Variant.PRIMARY,
                                    size = SaButton.ButtonSize.LARGE,
                                    block = true,
                                    disabled = page.busy,
                                ) { page.loginSms() }.invoke(this)
                            }
                            MODE_PASSWORD -> {
                                page.field("用户名 / 手机号", page.username.ifEmpty { page.phone }) {
                                    page.username = it
                                }.invoke(this)
                                page.field("密码", page.password, passwordField = true) { page.password = it }
                                    .invoke(this)
                                SaButton.build(
                                    text = if (page.busy) "登录中…" else "登录",
                                    variant = SaButton.Variant.PRIMARY,
                                    size = SaButton.ButtonSize.LARGE,
                                    block = true,
                                    disabled = page.busy,
                                ) { page.loginPassword() }.invoke(this)
                            }
                            MODE_REGISTER -> {
                                page.field("手机号", page.phone) { page.phone = it }.invoke(this)
                                page.field("短信验证码", page.smsCode) { page.smsCode = it }.invoke(this)
                                page.field("密码（≥8 位）", page.regPassword, passwordField = true) {
                                    page.regPassword = it
                                }.invoke(this)
                                SaButton.build(
                                    text = "发送注册验证码",
                                    variant = SaButton.Variant.PRIMARY_OUTLINE,
                                    size = SaButton.ButtonSize.SMALL,
                                    disabled = page.busy,
                                ) { page.sendSms("register") }.invoke(this)
                                View { attr { height(8f) } }
                                SaButton.build(
                                    text = if (page.busy) "提交中…" else "注册并登录",
                                    variant = SaButton.Variant.PRIMARY,
                                    size = SaButton.ButtonSize.LARGE,
                                    block = true,
                                    disabled = page.busy,
                                ) { page.register() }.invoke(this)
                            }
                        }

                        Text {
                            attr {
                                text(page.smsHint)
                                fontSize(12f)
                                color(Color.parseString16ToLong(SaUIColors.TextSecondarySolid))
                                margin(top = SaUISpacing.sm)
                            }
                        }
                    }
                }

                // 状态
                View {
                    attr {
                        margin(top = SaUISpacing.md)
                        padding(SaUISpacing.lg)
                        backgroundColor(Color.parseString16ToLong(SaUIColors.BgContainer))
                        borderRadius(SaUIRadius.Medium)
                        flexDirectionColumn()
                    }
                    Column {
                        attr { flexDirectionColumn() }
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
                                margin(top = SaUISpacing.sm)
                            }
                        }
                        page.models.forEach { id ->
                            Text {
                                attr {
                                    text("· $id")
                                    fontSize(13f)
                                    color(Color.parseString16ToLong(SaUIColors.TextPrimarySolid))
                                    margin(top = 4f)
                                }
                            }
                        }
                    }
                }

                // 登录后动作
                if (page.loggedIn) {
                    Column {
                        attr {
                            margin(top = SaUISpacing.md)
                            flexDirectionColumn()
                        }
                        SaButton.build(
                            text = "进入对话",
                            variant = SaButton.Variant.PRIMARY,
                            size = SaButton.ButtonSize.LARGE,
                            block = true,
                        ) { page.enterChat() }.invoke(this)
                        SaButton.build(
                            text = "刷新模型",
                            variant = SaButton.Variant.PRIMARY_OUTLINE,
                            size = SaButton.ButtonSize.MEDIUM,
                            block = true,
                            disabled = page.busy,
                        ) { page.loadModelsPublic() }.invoke(this)
                        SaButton.build(
                            text = "退出登录",
                            variant = SaButton.Variant.DANGER_OUTLINE,
                            size = SaButton.ButtonSize.MEDIUM,
                            block = true,
                        ) { page.logout() }.invoke(this)
                    }
                }

                // 可选兜底
                Column {
                    attr {
                        margin(top = SaUISpacing.lg)
                        flexDirectionColumn()
                    }
                    Text {
                        attr {
                            text("可选：浏览器 OAuth PKCE（非移动端主路径）")
                            fontSize(12f)
                            color(Color.parseString16ToLong(SaUIColors.TextSecondarySolid))
                            margin(bottom = 6f)
                        }
                    }
                    SaButton.build(
                        text = "用浏览器授权登录",
                        variant = SaButton.Variant.TEXT,
                        size = SaButton.ButtonSize.SMALL,
                    ) { page.startOAuthBrowser() }.invoke(this)
                    SaButton.build(
                        text = "打开组件库 Demo",
                        variant = SaButton.Variant.TEXT,
                        size = SaButton.ButtonSize.SMALL,
                    ) { PageRouterBridge.push("SaUICatalogPage") }.invoke(this)
                }

                View {
                    attr {
                        margin(top = SaUISpacing.md)
                        padding(SaUISpacing.sm)
                    }
                    Text {
                        attr {
                            text("IdP ${env.issuer}\nGW  ${env.gatewayUrl}")
                            fontSize(11f)
                            color(Color.parseString16ToLong(SaUIColors.TextSecondarySolid))
                        }
                    }
                }
            }
        }
    }
}
