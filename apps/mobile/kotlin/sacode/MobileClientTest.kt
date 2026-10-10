// 移动客户端接入逻辑层的行为测试（JVM 可执行面）。
//
// 这一层不是 Kuikly 工程：本机没有 gradle、没有 Android SDK、没有设备，Kuikly 源集
// 路径也就无从按任务 2 的模板冻结。所以这里只放「与平台无关的接入逻辑」，用 kotlinc
// 编成可执行 jar，对着**真的 daemon** 跑（TLS、票据登记、Bearer、/rpc、/sse）。
//
// 约定与仓内其他自测入口一致：逐条打 `PASS <名>` / `FAIL <名> <原因>`，
// 退出码非零表示有失败，条数由 Node 侧 apps/daemon/test/remote-mobile-client.test.mjs 计数。
package sacode

private var failures = 0L

private fun check(name: String, body: () -> Unit) {
    try {
        body()
        println("PASS $name")
    } catch (e: Throwable) {
        failures += 1
        val why = (e.message ?: e.javaClass.simpleName).replace("\n", " ").take(240)
        println("FAIL $name $why")
    }
}

private fun expect(cond: Boolean, msg: String) {
    if (!cond) throw AssertionError(msg)
}

private fun expectFails(msg: String, body: () -> Unit) {
    var caught: Throwable? = null
    try {
        body()
    } catch (e: Throwable) {
        caught = e
    }
    if (caught == null) throw AssertionError("应当拒绝，却放行通过：$msg")
}

private fun env(key: String): String =
    System.getenv(key) ?: error("缺环境变量 $key（夹具没配好，不是被测面失败）")

private fun required(o: Map<String, Any?>, key: String): Any? =
    o[key] ?: throw AssertionError("响应缺字段 $key")

private fun text(o: Map<String, Any?>, key: String): String = Json.str(required(o, key), key)

fun main() {
    val base = env("SACODE_MOBILE_BASE")
    val certPem = env("SACODE_MOBILE_CERT_PEM")
    val keyPem = env("SACODE_MOBILE_KEY_PEM")
    val pin = env("SACODE_MOBILE_PIN")
    val badPin = env("SACODE_MOBILE_BAD_PIN")
    val ticket = env("SACODE_MOBILE_TICKET")

    // ① 明文与指纹：这两条不需要网络，红在「客户端自己肯不肯发/肯不肯信」。
    check("plaintextBearerIsRefusedBeforeAnyRequest") {
        expectFails("http:// 也必须过 validatedBase") { validatedBase("http://127.0.0.1:8099") }
        expectFails("缺 scheme 的目标地址不能靠猜") { validatedBase("127.0.0.1:8099") }
        expectFails("带 userinfo 的地址是凭据泄漏面") { validatedBase("https://tok@127.0.0.1:8099") }
        expect(validatedBase("https://127.0.0.1:8099").endsWith("8099"), "https 应放行")
        expectFails("Target 构造期就校验，不留到第一次请求") {
            Target("inst-x", "http://127.0.0.1:8099", pin, "明文目标")
        }
    }

    check("pinFingerprintIsComputedFromTheServedCertificate") {
        val fromPem = SecureTransport.fingerprintOfPem(certPem)
        expect(fromPem.equals(pin, ignoreCase = true), "PEM 算出的指纹要与夹具给的一致：$fromPem vs $pin")
    }

    check("pinMismatchAbortsTheHandshakeInsteadOfFallingBack") {
        val rpc = RpcClient(SecureTransport(badPin), base, { "Bearer nope" })
        expectFails("错指纹必须炸，不能退回系统信任链") { rpc.call("initialize", "{}", 9L) }
    }

    // ② 登记→兑换→initialize 真打到 /rpc。断言的是服务端返回的字段，不是本地造的样子。
    val store = CredentialStore(SecureTransport(pin))
    var cred: StoredCredential? = null
    check("enrollThenTokenThenInitializeHitsRpc") {
        cred = store.bootstrap(base, ticket, "phone-kotlin", "mobile")
        val c = cred!!
        expect(c.deviceId.isNotEmpty(), "登记必须回一个 deviceId")
        val rpc = RpcClient(SecureTransport(pin), base, { store.bearer() })
        val r = rpc.call("initialize", "{}", 1L)
        when (r) {
            is RpcResult.Ok -> {
                val o = Json.obj(Json.parse(r.result))
                expect(text(o, "protocolVersion").isNotEmpty(), "initialize 要真被执行：缺 protocolVersion")
            }
            is RpcResult.Protocol -> throw AssertionError("initialize 被协议层拒绝：${r.code} ${r.message}")
            is RpcResult.Http -> throw AssertionError("initialize 落到 HTTP 层：${r.status} ${r.body.take(120)}")
        }
    }

    val link = cred
    if (link == null) {
        println("FAIL authChainUnavailable 登记链未通，后续依赖认证的用例记为未执行")
        failures += 1
    } else {
        check("httpErrorIsClassifiedApartFromJsonRpcError") {
            // 实测的 daemon 契约：/rpc 上的认证拒绝走 HTTP 200 + JSON-RPC error(-32001)，
            // 不是 401。客户端必须照这个形状归因，否则会把「缺认证」当「HTTP 层不通」去重连。
            val noAuth = RpcClient(SecureTransport(pin), base, { "" })
            val denied = noAuth.call("initialize", "{}", 2L)
            expect(denied is RpcResult.Protocol && denied.code == -32001L
                && denied.message.contains("missing-bearer"), "缺 Bearer 要归协议层 -32001：$denied")
            // 另一档：面不存在时是 HTTP 层结局，不能塞进协议层。
            val wrongRoot = RpcClient(SecureTransport(pin), "$base/no-such-face", { store.bearer() })
            val http = wrongRoot.call("initialize", "{}", 11L)
            expect(http is RpcResult.Http && http.status == 404, "目标面缺失要归 Http 档，实得 $http")
        }

        check("unknownMethodComesBackAsJsonRpcErrorNotHttpError") {
            val rpc = RpcClient(SecureTransport(pin), base, { store.bearer() })
            val r = rpc.call("no/such-method", "{}", 3L)
            // 未登记方法在授权面就被挡（不是 -32601）：客户端要能把这条读成「这台目标没有这个面」。
            expect(r is RpcResult.Protocol && r.code == -32001L && r.message.contains("method-not-registered"),
                "未登记方法要归 -32001 method-not-registered：$r")
        }

        check("malformedMethodNameIsRefusedLocallyNotSent") {
            val rpc = RpcClient(SecureTransport(pin), base, { store.bearer() })
            expectFails("带引号/换行的方法名能在审计行里插字段") {
                rpc.call("bad\"name\n", "{}", 10L)
            }
        }

        check("sessionCatalogEntriesParseWithExplicitOwnership") {
            val rpc = RpcClient(SecureTransport(pin), base, { store.bearer() })
            val bare = rpc.call("session/catalog", "{}", 4L)
            expect(bare is RpcResult.Protocol && bare.message.contains("workspace-required"),
                "不带 workspaceId 的目录请求要吃到显式归属拒绝，实得 $bare")
            val owned = rpc.call("session/catalog", "{}", 5L, mapOf("workspaceId" to "ws-mobile-probe"))
            expect(!(owned is RpcResult.Protocol && owned.message.contains("workspace-required")),
                "客户端把 workspaceId 放进 params 顶层后，不该再是那条拒绝：$owned")
            if (owned is RpcResult.Ok) {
                val doc = Json.obj(Json.parse(owned.result))
                // 目录条目用 `id`/`durable`/`status`，请求归属用 `workspaceId`——按线格式读，
                // 名字读错会当场红，而不是静默默认成空串。
                SessionModel.list(required(doc, "entries"))
                expect(text(doc, "root").isNotEmpty(), "目录要回会话根：${owned.result.take(120)}")
            }
            // 目录真为空时上面那段是空遍历，所以另附一份同形状的夹具做正/负对照：
            // 缺 id 的条目、空 id 的条目、缺 durable 的条目都必须被拒，合法条目才收。
            expectFails("缺 id 的条目不许默认成空串") {
                SessionModel.list(listOf(mapOf("durable" to true, "status" to "idle")))
            }
            expectFails("空 id 同样要拒") {
                SessionModel.list(listOf(mapOf("id" to "", "durable" to true, "status" to "idle")))
            }
            expectFails("durable 决定会话能否跨重启，缺失不许当 false") {
                SessionModel.list(listOf(mapOf("id" to "s", "status" to "idle")))
            }
            val ok = SessionModel.from(mapOf("id" to "s", "durable" to true, "status" to "idle"))
            expect(ok.sessionId == "s" && ok.title == "", "可选显示字段才允许默认")
        }

        check("sseStreamOpensWithPinAndBearerAndGreets") {
            val sse = SseClient(SecureTransport(pin), base, { store.bearer() })
            val stream = sse.open(null)
            try {
                val f = stream.next(8000L)
                expect(f != null, "订阅后 8 秒内没有任何帧（daemon 应先送 : connected）")
                expect(f!!.greeting, "第一帧应是 `: connected` 注释问候，实得 event=${f.event}")
            } finally {
                stream.close()
            }
        }

        check("sseWithoutBearerIsRefusedNotSilentlyEmpty") {
            val sse = SseClient(SecureTransport(pin), base, { "" })
            expectFails("未认证的 /sse 不能当成功流用") { sse.open(null) }
        }

        check("credentialStoreNeverSerializesTheToken") {
            val c = store.current()!!
            expect(!c.toString().contains(c.accessToken), "toString 不得带出 access token：$c")
            expect(c.expiresAtMillis > System.currentTimeMillis(), "令牌窗口应是剩余毫秒数")
            expectFails("过期后 bearer 要拒，不能照发") {
                val stale = StoredCredential(c.deviceId, c.accessToken, System.currentTimeMillis() - 1L)
                val s2 = CredentialStore(SecureTransport(pin))
                s2.inject(stale)
                s2.bearer()
            }
        }
    }

    // ③ 必填字段与审批通路。
    check("requiredFieldsAreRejectedNotDefaulted") {
        expectFails("缺 id 的会话条目") { SessionModel.from(mapOf("title" to "t", "durable" to true, "status" to "idle")) }
        expectFails("空 id") { SessionModel.from(mapOf("id" to " ", "durable" to true, "status" to "idle")) }
        expectFails("id 类型不对也不强转") { SessionModel.from(mapOf("id" to 7, "durable" to true, "status" to "idle")) }
        expectFails("status 缺失") { SessionModel.from(mapOf("id" to "s", "durable" to true)) }
        expectFails("durable 写成字符串要拒") { SessionModel.from(mapOf("id" to "s", "durable" to "true", "status" to "idle")) }
        val m = SessionModel.from(mapOf("id" to "s", "durable" to true, "status" to "idle"))
        expect(m.sessionId == "s" && m.status == "idle" && m.durable, "合法输入要照原样收")
    }

    check("approvalAnswerUsesTicketIdOnly") {
        expectFails("没有 approvalId 就拼不出 approval/answer") {
            ApprovalDraft("", "approve", "s").paramsJson()
        }
        expectFails("自报审批字符串没有通路") {
            ApprovalDraft("ap-1", "approve", "s").withSelfReportedApproval("trust-me").paramsJson()
        }
        expectFails("决策值不在闭集里要拒") { ApprovalDraft("ap-1", "maybe", "s").paramsJson() }
        val j = ApprovalDraft("ap-1", "approve", "s").paramsJson()
        expect(j.contains("\"approvalId\""), "approval/answer 只认工单号：$j")
        expect(!j.contains("trust-me"), "参数里不得出现自报审批串")
    }

    check("turnCancelRequiresBothSessionAndOperation") {
        expectFails("缺 operationId 的 turn/cancel") { TurnOps.cancelParams("s", "") }
        expectFails("缺 sessionId 的 turn/cancel") { TurnOps.cancelParams("", "op-1") }
        val j = TurnOps.cancelParams("s", "op-1")
        expect(j.contains("\"sessionId\"") && j.contains("\"operationId\""), "取消要带显式归属：$j")
    }

    // ④ 多目标与迟到数据隔离。
    check("noAutoFailoverToAnotherTarget") {
        val ts = TargetStore()
        ts.add(Target("inst-a", "https://127.0.0.1:8001", pin, "公司电脑"))
        ts.add(Target("inst-b", "https://127.0.0.1:8002", pin, "家里电脑"))
        expect(ts.setActive("inst-a"), "显式切换应当成立")
        expect(ts.failoverCandidateFor("inst-a") == null, "故障时不许自动换到另一台目标")
        expect(!ts.setActive("inst-ghost"), "未知 instanceId 不能悄悄改掉当前目标")
        expect(ts.active()!!.instanceId == "inst-a", "当前目标仍应是原来那台")
    }

    check("lateFramesFromOlderEpochAreDropped") {
        val gate = EpochGate("inst-a")
        val e1 = gate.newEpoch()
        val e2 = gate.newEpoch()
        expect(!gate.accepts(e1, "sess:1"), "旧 epoch 的迟到帧要丢")
        expect(gate.accepts(e2, "sess:2"), "当前 epoch 的新游标要收")
        expect(!gate.accepts(e2, "sess:2"), "同一 epoch 同一条游标重复投递要丢")
        expect(gate.accepts(e2, "sess:3"), "同一 epoch 的新游标仍要收")
    }

    check("draftsAreKeptPerTarget") {
        val ts = TargetStore()
        ts.add(Target("inst-a", "https://127.0.0.1:8001", pin, "A"))
        ts.add(Target("inst-b", "https://127.0.0.1:8002", pin, "B"))
        ts.putDraft("inst-a", "写到一半")
        expect(ts.draftFor("inst-b") == "", "B 的草稿不能串到 A 的内容")
        expect(ts.draftFor("inst-a") == "写到一半", "分目标草稿要留得住")
        expectFails("未登记的目标不许存草稿") { ts.putDraft("inst-ghost", "x") }
    }

    // ⑤ 上游标真的在 TLS 请求头里出去——对着本机 HTTPS 探针跑，不靠读自构造对象。
    check("sseResumeSendsLastEventIdOverTheWire") {
        val probe = TlsProbeServer(certPem, keyPem)
        val port = probe.start()
        try {
            val sse = SseClient(SecureTransport(pin), "https://127.0.0.1:$port", { "Bearer probe-only" })
            val stream = sse.open("sess:7")
            try {
                val f = stream.next(6000L)
                expect(f != null && f.greeting, "探针的 `: connected` 没解析成问候帧：$f")
            } finally {
                stream.close()
            }
            val sent = probe.header("Last-Event-ID")
            expect(sent == "sess:7", "Last-Event-ID 要真在请求头上，实得 $sent")
            expect(probe.header("Authorization") == "Bearer probe-only", "Bearer 要随流发出")
        } finally {
            probe.stop()
        }
    }

    println("mobile-client-tests failures=$failures")
    if (failures > 0L) kotlin.system.exitProcess(1)
}
