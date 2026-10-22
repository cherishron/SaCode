package core

import std.fs.*
import std.unittest.*

func securityMcpDropServer(): String {
    return joinStrings([
        "const fs = require('node:fs');",
        "const effects = process.argv[2], kind = process.argv[3];",
        "const rl = require('node:readline').createInterface({input:process.stdin, terminal:false});",
        "function send(id,result){process.stdout.write(JSON.stringify({jsonrpc:'2.0',id,result})+'\\n');}",
        "rl.on('line', raw => {",
        "  const m=JSON.parse(raw);",
        "  if(m.method==='initialize'){send(m.id,{protocolVersion:'2024-11-05',capabilities:{tools:{}},serverInfo:{name:'drop-fixture',version:'1'}});}",
        "  else if(m.method==='tools/call'){fs.appendFileSync(effects,'effect\\n');process.exit(0);}",
        "  else if(m.method==='tools/list'){",
        "    if(kind==='list' && !fs.existsSync(effects)){fs.writeFileSync(effects,'drop');process.exit(0);}",
        "    send(m.id,{tools:[{name:'side_effect',description:'synthetic only'}]});",
        "  }",
        "});"
    ], "\n")
}

@Test
func securityMcpCallIsNotReplayedAfterEffectAndTransportDrop() {
    let root = Directory.createTemp(Path(coreTestRoot())).toString()
    let script = "${root}/server.cjs"
    let effects = "${root}/effects.txt"
    File.writeTo(script, securityMcpDropServer().toArray())
    let log = SessionLog("${root}/session.log")
    let registry = McpRegistry(log)
    registry.register("drop-fixture", "stdio")
    let client = McpClient(registry, log, "drop-fixture", "node", [script, effects, "call"])
    try {
        @Expect(client.connect(timeoutMs: 10000).ok, true)
        let result = client.callTool("side_effect", "{}", timeoutMs: 10000)
        @Expect(result.ok, false)
        @Expect(result.failureKind, "transport")
        @Expect(client.isConnected(), false)
        @Expect(String.fromUtf8(File.readFrom(effects)), "effect\n")
        let again = client.callTool("side_effect", "{}", timeoutMs: 10000)
        @Expect(again.ok, false)
        @Expect(String.fromUtf8(File.readFrom(effects)), "effect\n")
    } finally { client.close() }
    removeIfExists(root, recursive: true)
}

@Test
func securityMcpReadOnlyListStillReconnectsAfterTransportDrop() {
    let root = Directory.createTemp(Path(coreTestRoot())).toString()
    let script = "${root}/server.cjs"
    let marker = "${root}/dropped.txt"
    File.writeTo(script, securityMcpDropServer().toArray())
    let log = SessionLog("${root}/session.log")
    let registry = McpRegistry(log)
    registry.register("drop-fixture", "stdio")
    let client = McpClient(registry, log, "drop-fixture", "node", [script, marker, "list"])
    try {
        @Expect(client.connect(timeoutMs: 10000).ok, true)
        let result = client.listTools(timeoutMs: 10000)
        @Expect(result.ok, true)
        @Expect(result.tools.size, 1)
        @Expect(result.tools[0].name, "side_effect")
        @Expect(client.isConnected(), true)
    } finally { client.close() }
    removeIfExists(root, recursive: true)
}
