package com.sa.demo.feature.account

import com.sa.demo.auth.AuthRepository
import com.sa.demo.core.platform.PageRouterBridge
import com.sa.demo.core.platform.asyncRun
import com.sa.demo.core.platform.postToMain
import com.sa.demo.env.SaaiEnv
import com.sa.demo.feature.home.HomeTabs
import com.sa.demo.saui.SaUIComponents
import com.sa.demo.saui.base.SaButton
import com.sa.demo.saui.data.SaCell
import com.sa.demo.saui.data.SaTag
import com.sa.demo.saui.token.SaUIColors
import com.sa.demo.saui.token.SaUIRadius
import com.sa.demo.saui.token.SaUISpacing
import com.tencent.kuikly.core.annotations.Page
import com.tencent.kuikly.core.base.Color
import com.tencent.kuikly.core.base.ViewBuilder
import com.tencent.kuikly.core.pager.Pager
import com.tencent.kuikly.core.reactive.handler.observable
import com.tencent.kuikly.core.views.Scroller
import com.tencent.kuikly.core.views.Text
import com.tencent.kuikly.core.views.View
import com.tencent.kuikly.core.views.layout.Column

/**
 * 我的：账号资料、第三方绑定、设备管理、安全操作。
 *
 * 数据来自 sa-idp 的身份接口（见 [AccountApi] 的字段出处注释）。
 * 登出类操作是**安全动作**：logout-all 会使所有设备的旧 token 立即失效，
 * 成功后必须清本地会话并回登录页，不能只弹个提示。
 */
@Page("AccountPage")
class AccountPage : Pager() {

    var status by observable("")
    var busy by observable(false)
    var profile by observable<AccountApi.Profile?>(null)
    var devices by observable<List<AccountApi.Device>>(emptyList())

    private var booted = false

    override fun body(): ViewBuilder = {
        val page = this@AccountPage
        page.bootstrap()

        Column {
            attr { flex(1f) }

            Scroller {
                attr {
                    flex(1f)
                    backgroundColor(Color.parseString16ToLong(SaUIColors.BgPage))
                }

                Column {
                    attr { padding(SaUISpacing.lg, SaUISpacing.md, SaUISpacing.lg, SaUISpacing.md) }

                    // —— 资料 ——
                    View {
                        attr {
                            backgroundColor(Color.parseString16ToLong(SaUIColors.BgContainer))
                            borderRadius(SaUIRadius.Medium)
                            padding(SaUISpacing.lg, SaUISpacing.lg, SaUISpacing.lg, SaUISpacing.lg)
                            marginBottom(SaUISpacing.lg)
                        }
                        Column {
                            Text {
                                attr {
                                    text(page.profile?.displayName ?: "加载中…")
                                    fontSize(20f)
                                    fontWeightBold()
                                    color(Color.parseString16ToLong(SaUIColors.TextPrimarySolid))
                                }
                            }
                            val p = page.profile
                            if (p != null) {
                                Text {
                                    attr {
                                        text(listOfNotNull(
                                            p.username?.let { "账号 $it" },
                                            p.phoneMasked,
                                            p.emailMasked,
                                        ).joinToString(" · ").ifBlank { "未绑定联系方式" })
                                        fontSize(13f)
                                        color(Color.parseString16ToLong(SaUIColors.TextSecondarySolid))
                                        marginTop(SaUISpacing.xs)
                                    }
                                }
                                if (p.needPhone) {
                                    Text {
                                        attr {
                                            text("尚未绑定手机号")
                                            fontSize(12f)
                                            color(Color.parseString16ToLong(SaUIColors.Warning))
                                            marginTop(SaUISpacing.xs)
                                        }
                                    }
                                }
                            }
                        }
                    }

                    // —— 第三方绑定 ——
                    page.sectionTitle("第三方绑定").invoke(this)
                    val bindings = page.profile?.bindings.orEmpty()
                    if (bindings.isEmpty()) {
                        page.hintCard("暂无第三方绑定").invoke(this)
                    } else {
                        SaCell.buildGroup(
                            bindings.map { b ->
                                SaCell.CellData(
                                    title = b.provider,
                                    subtitle = listOfNotNull(b.appId, b.externalIdMasked)
                                        .joinToString(" · ").ifBlank { "已绑定" },
                                    showArrow = false,
                                )
                            }
                        ).invoke(this)
                    }

                    // —— 设备 ——
                    page.sectionTitle("登录设备").invoke(this)
                    if (page.devices.isEmpty()) {
                        page.hintCard(if (page.busy) "加载中…" else "暂无设备记录").invoke(this)
                    } else {
                        SaCell.buildGroup(
                            page.devices.map { d ->
                                SaCell.CellData(
                                    title = d.displayName,
                                    subtitle = listOfNotNull(
                                        d.platform,
                                        d.clientType,
                                        d.lastActiveAt?.take(16)?.replace('T', ' '),
                                        d.deviceIdMasked,
                                    ).joinToString(" · "),
                                    showArrow = true,
                                    onClick = { page.confirmRevoke(d) },
                                )
                            }
                        ).invoke(this)
                    }

                    // —— 安全 ——
                    page.sectionTitle("安全").invoke(this)
                    Column {
                        attr { marginTop(SaUISpacing.lg) }

                        SaButton.build(
                            text = "退出当前会话",
                            variant = SaButton.Variant.PRIMARY_OUTLINE,
                            block = true,
                        ) {
                            page.doLogout(all = false)
                        }.invoke(this)

                        SaButton.build(
                            text = "退出所有设备",
                            variant = SaButton.Variant.DANGER_OUTLINE,
                            block = true,
                        ) {
                            page.doLogout(all = true)
                        }.invoke(this)

                        Text {
                            attr {
                                text("「退出所有设备」会立即使全部设备上的登录状态失效。")
                                    fontSize(12f)
                                    color(Color.parseString16ToLong(SaUIColors.TextPlaceholderSolid))
                                    marginTop(SaUISpacing.sm)
                            }
                        }
                    }

                    if (page.status.isNotBlank()) {
                        Text {
                            attr {
                                text(page.status)
                                    fontSize(13f)
                                    color(Color.parseString16ToLong(SaUIColors.TextSecondarySolid))
                                    marginTop(SaUISpacing.md)
                            }
                        }
                    }
                }
            }

            HomeTabs.build(HomeTabs.ACCOUNT).invoke(this)
        }
    }

    // —— 逻辑 ——

    private fun bootstrap() {
        if (booted) return
        booted = true
        refresh()
    }

    private fun refresh() {
        val env = SaaiEnv.current
        val token = AuthRepository.accessTokenOrNull() ?: run {
            status = "登录状态已失效，请重新登录"
            return
        }
        busy = true
        status = "加载中…"
        asyncRun({
            val p = AccountApi.profile(env, token)
            val d = AccountApi.devices(env, token).devices
            p to d
        }) { result ->
            busy = false
            result.fold(
                onSuccess = { (p, d) ->
                    profile = p
                    devices = d
                    status = ""
                },
                onFailure = { err ->
                    // 401/403 说明 token 失效或被全端下线踢掉，直接回登录
                    val code = (err as? com.sa.demo.auth.AuthException)?.statusCode
                    if (code == 401 || code == 403) {
                        AuthRepository.logoutLocal()
                        PageRouterBridge.open("LoginPage")
                    } else {
                        status = "加载失败：${err.message ?: err}"
                    }
                },
            )
        }
    }

    private fun confirmRevoke(device: AccountApi.Device) {
        if (device.id.isBlank()) {
            status = "该设备缺少可撤销标识"
            return
        }
        val env = SaaiEnv.current
        val token = AuthRepository.accessTokenOrNull() ?: return
        busy = true
        status = "正在下线 ${device.displayName}…"
        asyncRun({ AccountApi.revokeDevice(env, token, device.id) }) { result ->
            busy = false
            result.fold(
                onSuccess = { ok ->
                    if (ok) {
                        status = "已下线 ${device.displayName}"
                        devices = devices.filterNot { it.id == device.id }
                    } else {
                        status = "下线失败"
                    }
                },
                onFailure = { status = "下线失败：${it.message ?: it}" },
            )
        }
    }

    private fun doLogout(all: Boolean) {
        val env = SaaiEnv.current
        val token = AuthRepository.accessTokenOrNull()
        busy = true
        status = if (all) "正在退出所有设备…" else "正在退出…"
        asyncRun({
            // 服务端注销失败也要清本地——否则用户会卡在「登不出去」的状态
            val remoteOk = if (token != null) {
                if (all) AccountApi.logoutAll(env, token) else AccountApi.logout(env, token)
            } else true
            remoteOk to (token != null)
        }) { result ->
            busy = false
            result.fold(
                onSuccess = { (remoteOk, hadToken) ->
                    AuthRepository.logoutLocal()
                    status = if (!hadToken) "本地会话已清除"
                    else if (remoteOk) if (all) "已退出所有设备" else "已退出登录"
                    else "服务端注销未确认，本地会话已清除"
                    PageRouterBridge.open("LoginPage")
                },
                onFailure = {
                    // 网络失败同样允许本地登出，但要如实告知
                    AuthRepository.logoutLocal()
                    status = "网络异常，已仅清除本地登录状态"
                    PageRouterBridge.open("LoginPage")
                },
            )
        }
    }

    private fun sectionTitle(text: String): ViewBuilder = {
        Text {
            attr {
                text(text)
                fontSize(14f)
                fontWeightBold()
                color(Color.parseString16ToLong(SaUIColors.TextPrimarySolid))
                marginTop(SaUISpacing.lg)
                marginBottom(SaUISpacing.sm)
            }
        }
    }

    private fun hintCard(text: String): ViewBuilder = {
        View {
            attr {
                backgroundColor(Color.parseString16ToLong(SaUIColors.BgContainer))
                borderRadius(SaUIRadius.Medium)
                padding(SaUISpacing.lg, SaUISpacing.md, SaUISpacing.lg, SaUISpacing.md)
            }
            Text {
                attr {
                    text(text)
                    fontSize(13f)
                    color(Color.parseString16ToLong(SaUIColors.TextSecondarySolid))
                }
            }
        }
    }
}
