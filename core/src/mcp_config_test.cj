package core

import std.fs.*
import std.unittest.*

func withMcpConfigFixture(run: (String) -> Unit): Unit {
    let parent = "target/tmp/mcp-config-test"
    if (!exists(parent)) { Directory.create(parent, recursive: true) }
    let root = Directory.createTemp(parent).toString()
    try { run(root) } finally { remove(root, recursive: true) }
}

@Test
func mcpConfigFileLoadsRegistryAndLaunchDefinition() {
    withMcpConfigFixture({ root =>
        let path = root + "/config.json"
        let log = SessionLog(root + "/session.log")
        let registry = McpRegistry(log)
        File.writeTo(path, ##"{"mcpServers":{"synthetic":{"command":"synthetic-node","args":["fixture.cjs","--probe"],"env":{"MCP_PROBE":"synthetic-plain"}}}}"##.toArray())
        let result = McpConfigLoader.load(path, registry)
        @Expect(result.ok(), true)
        @Expect(result.error, "")
        @Expect(result.skipped.size, Int64(0))
        @Expect(result.servers.size, Int64(1))
        @Expect(registry.list().size, Int64(1))
        @Expect(registry.list()[0], "synthetic")
        @Expect(result.servers[0].name, "synthetic")
        @Expect(result.servers[0].command, "synthetic-node")
        @Expect(result.servers[0].args, ["fixture.cjs", "--probe"])
        @Expect(result.servers[0].env.size, Int64(1))
        @Expect(result.servers[0].env[0][0], "MCP_PROBE")
        @Expect(result.servers[0].env[0][1], "synthetic-plain")
        @Expect(result.servers[0].transport, "stdio")
    })
}

@Test
func mcpConfigBadServerDoesNotPartiallyRegister() {
    withMcpConfigFixture({ root =>
        let path = root + "/config.json"
        let invalid = [##"{"command":""}"##, ##"{"command":"synthetic-node","args":[1]}"##,
            ##"{"command":"synthetic-node","env":{"MCP_PROBE":1}}"##]
        for (bad in invalid) {
            let log = SessionLog(root + "/session.log")
            let registry = McpRegistry(log)
            registry.register("existing", "stdio")
            let before = log.snapshotEvents().size
            File.writeTo(path, (##"{"mcpServers":{"valid":{"command":"synthetic-node"},"invalid":"## + bad + "}}").toArray())
            let result = McpConfigLoader.load(path, registry)
            @Expect(result.ok(), false)
            @Expect(result.error, "mcp-config-bad-server")
            @Expect(result.servers.size, Int64(0))
            @Expect(result.skipped.size, Int64(0))
            @Expect(registry.list().size, Int64(1))
            @Expect(registry.isRegistered("existing"), true)
            @Expect(registry.isRegistered("valid"), false)
            @Expect(registry.isRegistered("invalid"), false)
            @Expect(log.snapshotEvents().size, before)
        }
    })
}

@Test
func mcpConfigSensitiveEnvironmentSkipsWholeServer() {
    withMcpConfigFixture({ root =>
        let path = root + "/config.json"
        for (key in ["api_key", "Password", "client_secret", "access_TOKEN", "sacode_probe"]) {
            let log = SessionLog(root + "/session.log")
            let registry = McpRegistry(log)
            File.writeTo(path, (##"{"mcpServers":{"safe":{"command":"synthetic-node"},"sensitive":{"command":"synthetic-node","env":{"MCP_PROBE":"synthetic-plain",""## + key + ##"":"invalid-synthetic-secret"}}}}"##).toArray())
            let result = McpConfigLoader.load(path, registry)
            @Expect(result.ok(), true)
            @Expect(result.servers.size, Int64(1))
            @Expect(result.servers[0].name, "safe")
            @Expect(result.skipped.size, Int64(1))
            @Expect(result.skipped[0].name, "sensitive")
            @Expect(result.skipped[0].reason, "mcp-config-secret")
            @Expect(registry.list().size, Int64(1))
            @Expect(registry.isRegistered("safe"), true)
            @Expect(registry.isRegistered("sensitive"), false)
            for (event in log.snapshotEvents()) {
                @Expect(event.data.contains("invalid-synthetic-secret"), false)
                @Expect(event.data.contains("synthetic-plain"), false)
            }
        }
    })
}

@Test
func mcpConfigMissingFileKeepsRegistryUnchanged() {
    withMcpConfigFixture({ root =>
        let log = SessionLog(root + "/session.log")
        let registry = McpRegistry(log)
        let result = McpConfigLoader.load(root + "/missing.json", registry)
        @Expect(result.ok(), false)
        @Expect(result.error, "mcp-config-not-found")
        @Expect(result.servers.size, Int64(0))
        @Expect(result.skipped.size, Int64(0))
        @Expect(registry.list().size, Int64(0))
        @Expect(log.snapshotEvents().size, Int64(0))
    })
}

@Test
func mcpConfigParseErrorKeepsRegistryUnchanged() {
    withMcpConfigFixture({ root =>
        let path = root + "/config.json"
        let log = SessionLog(root + "/session.log")
        let registry = McpRegistry(log)
        File.writeTo(path, ##"{"mcpServers": "##.toArray())
        let result = McpConfigLoader.load(path, registry)
        @Expect(result.ok(), false)
        @Expect(result.error, "mcp-config-parse-error")
        @Expect(result.servers.size, Int64(0))
        @Expect(result.skipped.size, Int64(0))
        @Expect(registry.list().size, Int64(0))
        @Expect(log.snapshotEvents().size, Int64(0))
    })
}
