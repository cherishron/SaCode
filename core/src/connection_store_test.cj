package core

import std.fs.*
import std.env.getVariable
import std.unittest.*
import stdx.encoding.json.*

func connectionTestDefinition(id: String): String {
    return "{\"id\":\"${id}\",\"title\":\"开发 :: 数据库,=\",\"kind\":\"database\",\"enabled\":false,\"spec\":{\"engine\":\"postgresql\",\"host\":\"localhost\",\"port\":5432,\"database\":\"demo\",\"user\":\"tester\",\"credentialRef\":\"DB_TEST_PASSWORD\",\"tlsMode\":\"verify-full\"}}"
}

@Test
func connectionDefinitionsPersistWithoutClaimingLiveConnection() {
    let root = canonicalize(Directory.createTemp(Path(getVariable("TMP").getOrThrow()))).toString()
    try {
        let store = ConnectionDefinitionStore(root, "user", "")
        let saved = JsonValue.fromStr(store.save(connectionTestDefinition("one"), 0)).asObject()
        @Expect(saved["revision"].asInt().getValue(), Int64(1))
        let replay = JsonValue.fromStr(ConnectionDefinitionStore(root, "user", "").describe()).asObject()
        let rows = replay["definitions"].asArray()
        @Expect(rows.size(), Int64(1))
        if (rows.size() != 1) { return }
        let row = rows[0].asObject()
        @Expect(row["title"].asString().getValue(), "开发 :: 数据库,=")
        @Expect(row["enabled"].asBool().getValue(), false)
        @Expect(row.get("connected").isNone(), true)
        @Expect(row["spec"].asObject()["credentialRef"].asString().getValue(), "DB_TEST_PASSWORD")
    } finally { removeIfExists(root, recursive: true) }
}

@Test
func connectionDefinitionsRejectStaleMutationAndKeepStoredRevision() {
    let root = canonicalize(Directory.createTemp(Path(getVariable("TMP").getOrThrow()))).toString()
    try {
        let store = ConnectionDefinitionStore(root, "user", "")
        store.save(connectionTestDefinition("one"), 0)
        @ExpectThrows[Exception](store.save(connectionTestDefinition("two"), 0))
        @ExpectThrows[Exception](store.control("one", "remove", 0))
        let enabled = JsonValue.fromStr(store.control("one", "enable", 1)).asObject()
        @Expect(enabled["revision"].asInt().getValue(), Int64(2))
        @Expect(enabled["definitions"].asArray()[0].asObject()["enabled"].asBool().getValue(), true)
        let removed = JsonValue.fromStr(store.control("one", "remove", 2)).asObject()
        @Expect(removed["definitions"].asArray().size(), Int64(0))
    } finally { removeIfExists(root, recursive: true) }
}

@Test
func connectionDefinitionsIsolateUserAndCanonicalProjects() {
    let root = canonicalize(Directory.createTemp(Path(getVariable("TMP").getOrThrow()))).toString()
    try {
        Directory.create(root + "/a"); Directory.create(root + "/b")
        ConnectionDefinitionStore(root, "project", root + "/a").save(connectionTestDefinition("one"), 0)
        let same = JsonValue.fromStr(ConnectionDefinitionStore(root, "project", root + "/a/.").describe()).asObject()
        @Expect(same["definitions"].asArray().size(), Int64(1))
        let other = JsonValue.fromStr(ConnectionDefinitionStore(root, "project", root + "/b").describe()).asObject()
        @Expect(other["definitions"].asArray().size(), Int64(0))
        let user = JsonValue.fromStr(ConnectionDefinitionStore(root, "user", "").describe()).asObject()
        @Expect(user["definitions"].asArray().size(), Int64(0))
    } finally { removeIfExists(root, recursive: true) }
}

@Test
func connectionDefinitionsRejectSecretsUnknownFieldsAndUnsafeTlsBeforePersisting() {
    let root = canonicalize(Directory.createTemp(Path(getVariable("TMP").getOrThrow()))).toString()
    try {
        let store = ConnectionDefinitionStore(root, "user", "")
        for (invalid in [
            connectionTestDefinition("one").replace("\"tlsMode\":\"verify-full\"", "\"password\":\"invalid-test-secret\""),
            connectionTestDefinition("one").replace("verify-full", "disable"),
            connectionTestDefinition("one").replace("\"enabled\":false", "\"connected\":true"),
            connectionTestDefinition("../bad"),
            connectionTestDefinition("one").replace("5432", "0")
        ]) { @ExpectThrows[Exception](store.save(invalid, 0)) }
        let view = JsonValue.fromStr(store.describe()).asObject()
        @Expect(view["revision"].asInt().getValue(), Int64(0))
        @Expect(view["definitions"].asArray().size(), Int64(0))
    } finally { removeIfExists(root, recursive: true) }
}

@Test
func connectionDefinitionsSshDoesNotCreateTrustOrExecutionFacts() {
    let root = canonicalize(Directory.createTemp(Path(getVariable("TMP").getOrThrow()))).toString()
    try {
        let store = ConnectionDefinitionStore(root, "user", "")
        let input = "{\"id\":\"ssh-local\",\"title\":\"测试目标\",\"kind\":\"ssh\",\"enabled\":true,\"spec\":{\"host\":\"::1\",\"port\":2222,\"user\":\"tester\",\"credentialRef\":\"SSH_TEST_KEY\"}}"
        let view = JsonValue.fromStr(store.save(input, 0)).asObject()
        @Expect(view["definitions"].asArray().size(), Int64(1))
        let log = SessionLog(root + "/connections-user.log")
        @Expect(log.load(), true)
        @Expect(log.eventCount(), Int64(1))
        for (event in log.snapshotEvents()) { @Expect(event.eventType, "connection/definition") }
        @ExpectThrows[Exception](store.save(input.replace("::1", "-oProxyCommand=bad"), 1))
    } finally { removeIfExists(root, recursive: true) }
}

@Test
func connectionDefinitionsRejectCorruptReplayWithoutOverwritingEvidence() {
    let root = canonicalize(Directory.createTemp(Path(getVariable("TMP").getOrThrow()))).toString()
    try {
        let path = root + "/connections-user.log"
        let broken = "0\tconnection/definition\t{broken}\n"
        File.writeTo(path, broken.toArray())
        let store = ConnectionDefinitionStore(root, "user", "")
        @ExpectThrows[Exception](store.describe())
        @ExpectThrows[Exception](store.save(connectionTestDefinition("one"), 1))
        @Expect(String.fromUtf8(File.readFrom(path)), broken)
    } finally { removeIfExists(root, recursive: true) }
}

@Test
func connectionDefinitionsMcpPreservesArgumentBoundariesAndCredentialReferences() {
    let root = canonicalize(Directory.createTemp(Path(getVariable("TMP").getOrThrow()))).toString()
    try {
        let store = ConnectionDefinitionStore(root, "user", "")
        let input = "{\"id\":\"mcp-local\",\"title\":\"本地服务\",\"kind\":\"mcp\",\"enabled\":true,\"spec\":{\"transport\":\"stdio\",\"command\":\"node\",\"args\":[\"a b\",\"::,=\"],\"envRefs\":[{\"key\":\"API_TOKEN\",\"credentialRef\":\"MCP_TEST_TOKEN\"}]}}"
        let result = JsonValue.fromStr(store.save(input, 0)).asObject()
        let spec = result["definitions"].asArray()[0].asObject()["spec"].asObject()
        @Expect(spec["args"].asArray()[0].asString().getValue(), "a b")
        @Expect(spec["envRefs"].asArray()[0].asObject()["credentialRef"].asString().getValue(), "MCP_TEST_TOKEN")
        @ExpectThrows[Exception](store.save(input.replace("\"credentialRef\":\"MCP_TEST_TOKEN\"", "\"value\":\"invalid-test-secret\""), 1))
        @ExpectThrows[Exception](store.save(input.replace("stdio", "unknown-transport"), 1))
    } finally { removeIfExists(root, recursive: true) }
}
