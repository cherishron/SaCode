package core

import std.fs.*
import std.unittest.*

@Test
func mcpEventPolicyAndExplicitOverride() {
    let log = SessionLog("unused-policy.log")
    let registry = McpRegistry(log)
    registry.register("demo", "stdio")
    let initial = McpClient(registry, log, "demo", "node", [])
    @Expect(initial.reconnectPolicy.maxAttempts, Int64(10))
    @Expect(initial.reconnectPolicy.initialDelayMs, 500.0)
    log.append("mcp/server", ##"register::demo::stdio::{"maxAttempts":3,"baseDelayMs":25}"##)
    log.append("mcp/server", ##"{"name":"other","maxAttempts":8,"baseDelayMs":80}"##)
    let configured = McpClient(registry, log, "demo", "node", [])
    @Expect(configured.reconnectPolicy.maxAttempts, Int64(3))
    @Expect(configured.reconnectPolicy.delayForAttempt(2), 50.0)
    let explicit = McpClient(registry, log, "demo", "node", [], reconnectPolicy: McpReconnectPolicy(maxAttempts: 7.0))
    @Expect(explicit.reconnectPolicy.maxAttempts, Int64(7))
    log.append("mcp/server", ##"{"name":"demo","maxAttempts":2,"baseDelayMs":40}"##)
    @Expect(McpClient(registry, log, "demo", "node", []).reconnectPolicy.initialDelayMs, 40.0)
    log.append("mcp/server", ##"{"name":"demo","maxAttempts":0,"baseDelayMs":-1}"##)
    @Expect(McpClient(registry, log, "demo", "node", []).reconnectPolicy.maxAttempts, Int64(10))
}

@Test
func mcpExplicitEnvironmentAfterScrub() {
    let log = SessionLog("unused-env.log")
    let registry = McpRegistry(log)
    registry.register("env", "stdio")
    let script = ##"const rl=require('readline').createInterface({input:process.stdin});rl.on('line',s=>{const m=JSON.parse(s);if(m.method==='initialize')console.log(JSON.stringify({jsonrpc:'2.0',id:m.id,result:{protocolVersion:'2024-11-05',serverInfo:{name:'fixture',version:'1'}}}));if(m.method==='tools/list')console.log(JSON.stringify({jsonrpc:'2.0',id:m.id,result:{tools:[{name:'env',description:process.env.API_KEY+'|'+process.env.MCP_PROBE}]}}));});"##
    let client = McpClient(registry, log, "env", "node", ["-e", script], env: [("API_KEY", "invalid-fixture-override"), ("MCP_PROBE", "explicit")])
    try {
        @Expect(client.connect().ok, true)
        let result = client.listTools()
        @Expect(result.ok, true)
        @Expect(result.tools[0].description, "invalid-fixture-override|explicit")
        for (event in log.snapshotEvents()) {
            @Expect(event.data.contains("invalid-fixture-override"), false)
        }
    } finally { client.close() }
}
