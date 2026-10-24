package host

import core.*
import std.collection.*
import std.sync.*
import stdx.encoding.json.*
import stdx.crypto.crypto.SecureRandom
import stdx.encoding.hex.toHexString

// 结果只属于当前 Host 生命周期；操作元数据不存凭据/上游正文。
// 成功视图沿用已脱敏的供应商配置（含地址但无密钥），不按全局 revision 推断成功。
class HostModelPull {
    let operationId: String
    let providerId: String
    let expectedRevision: Int64
    let timeoutMs: Int64
    let control: ModelCatalogRequest
    let mtx = Mutex()
    var status = "running"
    var failure = ""
    var view = ""
    var settled = false
    var worker: ?Future<Unit> = None
    var deadlineWorker: ?Future<Unit> = None
    var replied = false

    init(operationId: String, providerId: String, revision: Int64, timeoutMs: Int64) {
        this.operationId = operationId
        this.providerId = providerId
        this.expectedRevision = revision
        this.timeoutMs = timeoutMs
        control = ModelCatalogRequest(timeoutMs)
    }

    func running(): Bool {
        mtx.lock()
        try {
            return !settled
        } finally {
            mtx.unlock()
        }
    }

    func describe(): String {
        let reason = control.reason()
        mtx.lock()
        try {
            let current = if (!settled && reason.size > 0) {
                if (reason == "model-pull-deadline") {
                    "timed-out"
                } else {
                    "cancelled"
                }
            } else {
                status
            }
            let obj = JsonObject()
            obj.put("operationId", JsonString(operationId))
            obj.put("providerId", JsonString(providerId))
            obj.put("expectedRevision", JsonInt(expectedRevision))
            obj.put("status", JsonString(current))
            obj.put("error", JsonString(if (!settled && reason.size > 0) {
                reason
            } else {
                failure
            }))
            obj.put("settled", JsonBool(settled))
            obj.put("running", JsonBool(!settled))
            obj.put("timeoutMs", JsonInt(timeoutMs))
            obj.put("elapsedMs", JsonInt(control.elapsedMs()))
            obj.put("scope", JsonString("host-lifetime"))
            obj.put("view", if (view.size > 0) {
                JsonValue.fromStr(view)
            } else {
                JsonNull()
            })
            return obj.toString()
        } finally {
            mtx.unlock()
        }
    }

    func start(rpcId: String): Unit {
        // 网络结果的总等待与实际线程收束分开：DNS/系统调用若暂不响应 close，
        // 到期仍返回确定的「禁止提交」结果，但 settled=false，保留线程和资源所有权。
        deadlineWorker = Some(spawn {
            => while (running()) {
                let reason = control.reason()
                if (reason.size > 0) {
                    reply(rpcId, "", reason)
                    break
                }
                sleep(Duration.millisecond * 10)
            }
        })
        worker = Some(spawn {
            =>
                var result = ""
                var error = ""
                var committed = false
                var commitAdmitted = false
                try {
                    control.checkpoint()
                    let registry = ProviderRegistry.forUser()
                    let snapshot = registry.describe()
                    if (snapshot.revision != expectedRevision) {
                        throw Exception("settings-conflict")
                    }
                    var url = ""
                    var credentialRef = ""
                    for (provider in snapshot.providers) {
                        if (provider.id == providerId) {
                            url = provider.baseUrl
                            credentialRef = provider.credentialRef
                        }
                    }
                    if (url.size == 0) {
                        throw Exception("provider-not-found")
                    }
                    let models = ModelCatalog().fetchModels(url, resolveCredentialKey(credentialRef), control: Some(control))
                    control.beginCommit()
                    commitAdmitted = true
                    mtx.lock();
                    status = "committing"
                    mtx.unlock()
                    registry.applyPulledModelEntries(providerId, models, expectedRevision)
                    committed = true
                    result = providerViewJson(registry.describe(), CredentialStore.forUser())
                } catch (e: Exception) {
                    let reason = control.reason()
                    error = if (reason.size > 0) {
                        reason
                    } else {
                        safeModelPullError(e.message)
                    }
                    if (commitAdmitted && error != "settings-conflict" && error != "settings-rejected" && error !=
                        "provider-settings-busy") {
                        error = "model-pull-outcome-unknown"
                    }
                }
                let stopped = control.finish()
                if (!committed && stopped.size > 0) {
                    error = stopped
                }
                mtx.lock()
                view = result
                failure = error
                status = if (committed && result.size > 0) {
                    "succeeded"
                } else if (committed || error == "model-pull-outcome-unknown") {
                    "outcome-unknown"
                } else if (error == "model-pull-cancelled") {
                    "cancelled"
                } else if (error == "model-pull-deadline") {
                    "timed-out"
                } else {
                    "failed"
                }
                settled = true
                mtx.unlock()
                reply(rpcId, if (committed) {
                    result
                } else {
                    ""
                }, if (committed && result.size == 0) {
                    "model-pull-outcome-unknown"
                } else {
                    error
                })
        })
    }

    func reply(rpcId: String, result: String, error: String): Unit {
        mtx.lock()
        if (replied) {
            mtx.unlock();
            return
        }
        replied = true
        mtx.unlock()
        if (result.size > 0) {
            let response = JsonValue.fromStr(result).asObject()
            response.put("operationId", JsonString(operationId))
            emit(okFrame(rpcId, response.toString()))
        } else {
            emit(errFrameData(rpcId, -32020, error, describe()))
        }
    }

    func shutdown(): Bool {
        control.cancel()
        if (let Some(current) <- worker) {
            try {
                current.get(Duration.second * 3)
            } catch (_: Exception) {
                return false
            }
        }
        if (let Some(current) <- deadlineWorker) {
            try {
                current.get(Duration.second)
            } catch (_: Exception) {
                return false
            }
        }
        return !running()
    }
}

func safeModelPullError(message: String): String {
    for (code in ["settings-conflict", "settings-rejected", "provider-not-found", "model-credential-unavailable",
        "provider-settings-busy", "provider-replay-rejected", "provider-flush-failed", "bad-model-catalog",
        "model-catalog-request-failed", "model-pull-cancelled", "model-pull-deadline"]) {
        if (message == code) {
            return code
        }
    }
    if (message.startsWith("http-status:") && message.size == 15) {
        var digits = true
        for (b in message.toArray().slice(12, 3)) {
            if (b < 48 || b > 57) {
                digits = false
            }
        }
        if (digits) {
            return message
        }
    }
    return "model-catalog-request-failed"
}

func validModelPullId(value: String): Bool {
    if (value.size == 0 || value.size > 96) {
        return false
    }
    for (b in value.toArray()) {
        if (!((b >= 48 && b <= 57) || (b >= 65 && b <= 90) || (b >= 97 && b <= 122) || b == 45 || b == 95)) {
            return false
        }
    }
    return true
}

class HostModelPulls {
    let jobs = ArrayList<HostModelPull>()
    let epoch: String
    var sequence: Int64 = 0

    init() {
        let bytes = Array<Byte>(16, repeat: 0)
        SecureRandom().nextBytes(bytes)
        epoch = toHexString(bytes)
    }

    func start(body: String, rpcId: String): Unit {
        let params = JsonValue.fromStr(body).asObject().get("params").getOrThrow().asObject()
        let revision = params.get("expectedRevision").getOrThrow().asInt().getValue()
        let provider = params.get("providerId").getOrThrow().asString().getValue()
        if (revision < 0 || !validModelPullId(provider) || provider.size > 64) {
            throw Exception("bad-model-pull-params")
        }
        var id = ""
        if (let Some(value) <- params.get("operationId")) {
            id = value.asString().getValue()
        }
        if (id.size == 0) {
            sequence += 1
            id = "host-pull-${epoch}-${sequence}"
        }
        if (!validModelPullId(id)) {
            throw Exception("bad-model-pull-params")
        }
        for (job in jobs) {
            if (job.operationId == id) {
                throw Exception("model-pull-operation-exists")
            }
            if (job.running()) {
                throw Exception("model-pull-in-flight")
            }
        }
        // 不静默淘汰结果后又允许同 ID 重放。达到上限明确拒绝，由调用方另行管理生命周期。
        if (jobs.size >= 128) {
            throw Exception("model-pull-result-capacity")
        }
        var timeout: Int64 = 20000
        if (let Some(value) <- params.get("timeoutMs")) {
            timeout = value.asInt().getValue()
        }
        let job = HostModelPull(id, provider, revision, timeout)
        jobs.add(job)
        job.start(rpcId)
    }

    func busy(): Bool {
        for (job in jobs) {
            if (job.running()) {
                return true
            }
        }
        return false
    }

    func control(method: String, body: String, rpcId: String): Unit {
        let params = JsonValue.fromStr(body).asObject().get("params").getOrThrow().asObject()
        let id = params.get("operationId").getOrThrow().asString().getValue()
        if (!validModelPullId(id)) {
            throw Exception("bad-model-pull-params")
        }
        for (job in jobs) {
            if (job.operationId == id) {
                let requested = if (method == "model/pull/cancel") {
                    job.control.cancel()
                } else {
                    false
                }
                let response = JsonValue.fromStr(job.describe()).asObject()
                response.put("cancelRequested", JsonBool(requested))
                emit(okFrame(rpcId, response.toString()))
                return
            }
        }
        emit(
            errFrameData(rpcId, -32020, "model-pull-operation-unknown",
                "{\"scope\":\"host-lifetime\",\"outcome\":\"unknown\"}"))
    }

    func shutdown(): Bool {
        var settled = true
        for (job in jobs) {
            if (!job.shutdown()) {
                settled = false
            }
        }
        return settled
    }
}
