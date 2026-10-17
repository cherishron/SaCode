package core
import std.collection.*
import std.fs.*
import std.unittest.*

// 凭证上游契约（M5/M6）：本地 CredentialRef 元数据登记（**不含明文密钥**）。
// log-only `credentials/register` 事件承载 `<ref>::<kind>::<label>`；
// `rotate(ref)` 落 `credentials/rotate` 事件把 ref 版本号 +1；
// `revoke(ref)` 软删。上游还有 CredentialRef 类型化 & DeepSeekAccount 官方账号绑定
// 已按 C01 明确排除。

@Test
func credentialsRegisterAndRotateBumpsRevision() {
    let root = "core-cred-happy"
    removeIfExists(root, recursive: true)
    Directory.create(root, recursive: true)
    let log = SessionLog("${root}/session.log")
    let cred = CredentialRegistry(log)
    cred.register("openai-main", "api-key", "OpenAI 主号")
    @Expect(cred.revision("openai-main"), Int64(1))
    cred.rotate("openai-main")
    @Expect(cred.revision("openai-main"), Int64(2))
    removeIfExists(root, recursive: true)
}

@Test
func credentialsRevokeRemovesFromList() {
    let root = "core-cred-revoke"
    removeIfExists(root, recursive: true)
    Directory.create(root, recursive: true)
    let log = SessionLog("${root}/session.log")
    let cred = CredentialRegistry(log)
    cred.register("openai-main", "api-key", "主号")
    cred.revoke("openai-main")
    @Expect(cred.list().size, Int64(0))
    removeIfExists(root, recursive: true)
}

@Test
func credentialsRejectsEmptyFields() {
    let root = "core-cred-empty"
    removeIfExists(root, recursive: true)
    Directory.create(root, recursive: true)
    let log = SessionLog("${root}/session.log")
    let cred = CredentialRegistry(log)
    var threw = false
    try {
        cred.register("", "api-key", "x")
    } catch (e: Exception) {
        threw = true
    }
    @Expect(threw, true)
    removeIfExists(root, recursive: true)
}

@Test
func credentialsEventsAreLogOnlyAcrossReplay() {
    let root = "core-cred-replay"
    removeIfExists(root, recursive: true)
    Directory.create(root, recursive: true)
    let path = "${root}/session.log"
    let log = SessionLog(path)
    let cred = CredentialRegistry(log)
    log.append("user/message", "开工")
    cred.register("openai-main", "api-key", "主号")
    cred.rotate("openai-main")
    @Expect(log.flush(), true)
    let fresh = SessionLog(path)
    @Expect(fresh.load(), true)
    @Expect(fresh.deriveMessages().size, Int64(1))
    @Expect(CredentialRegistry(fresh).revision("openai-main"), Int64(2))
    removeIfExists(root, recursive: true)
}
