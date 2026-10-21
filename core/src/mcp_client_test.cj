package core

import std.collection.*
import std.fs.*
import std.io.*
import std.process.*
import std.env.*
import std.time.*
import std.unittest.*

// MCP 真实客户端测试（H/W70）：不起假 provider，spawn 一个真 Node MCP 服务器
// （stdio + NDJSON JSON-RPC），走真握手、真工具清单、真工具调用。
//
// 测试拓扑：
//   - 每个需要网络的用例自写 `core-mcp-server.js` 再 spawn，用例结束自停自删；
//   - 客户端不靠 sleep 赌时序：发 initialize 后按 deadline 等真回复；
//   - 服务器启动时先吐一行非 JSON 噪声 `NOISE`，用来证明客户端会跳过它。

let mcpServerScript: String = "core-mcp-server.js"
let mcpServerName: String = "fake-mcp"

func mcpServerBody(): String {
    // 关键约束：**JS 侧不能有 // 注释**。若把整份脚本拼成一整行，一条 // 会把
    // 后面所有内容都吞掉，node 直接报 SyntaxError: Unexpected end of input。
    // 因此这里按行拼接、用真换行连接；「通知无回复」的分支用空语句 `;` 占位。
    return joinStrings([
        "const rl = require('readline').createInterface({ input: process.stdin, terminal: false });",
        "function send(o){ process.stdout.write(JSON.stringify(o) + '\\n'); }",
        "process.stdout.write('NOISE\\n');",
        "rl.on('line', (raw) => {",
        "  let m;",
        "  try { m = JSON.parse(raw); } catch (e) { return; }",
        "  if (m.method === 'initialize') {",
        "    send({ jsonrpc: '2.0', id: m.id, result: {",
        "      protocolVersion: '2024-11-05',",
        "      capabilities: { tools: {} },",
        "      serverInfo: { name: 'fake-mcp-server', version: '1.0.0' } } });",
        "  } else if (m.method === 'notifications/initialized') {",
        "    ;",
        "  } else if (m.method === 'tools/list') {",
        "    send({ jsonrpc: '2.0', id: m.id, result: { tools: [",
        "      { name: 'hello', description: 'say hello to a name' },",
        "      { name: 'boom', description: 'always fails' } ] } });",
        "  } else if (m.method === 'tools/call') {",
        "    const p = m.params || {};",
        "    const a = p.arguments || {};",
        "    if (p.name === 'hello') {",
        "      send({ jsonrpc: '2.0', id: m.id, result: {",
        "        content: [ { type: 'text', text: 'hello ' + (a.name || 'world') } ], isError: false } });",
        "    } else if (p.name === 'boom') {",
        "      send({ jsonrpc: '2.0', id: m.id, result: {",
        "        content: [ { type: 'text', text: 'kaboom' } ], isError: true } });",
        "    } else {",
        "      send({ jsonrpc: '2.0', id: m.id, error: { code: -32602, message: 'unknown tool' } });",
        "    }",
        "  } else {",
        "    send({ jsonrpc: '2.0', id: m.id, error: { code: -32601, message: 'method not found' } });",
        "  }",
        "});",
    ], "\n")
}

func writeMcpServer(): Unit {
    File.writeTo(mcpServerScript, mcpServerBody().toArray())
}

func deleteMcpServer(): Unit {
    removeIfExists(mcpServerScript, recursive: false)
}

func mcpNewLog(tag: String): (String, SessionLog) {
    let root = "core-mcpclient-${tag}"
    removeIfExists(root, recursive: true)
    Directory.create(root, recursive: true)
    let log = SessionLog("${root}/session.log")
    return (root, log)
}

func mcpCleanup(root: String): Unit {
    removeIfExists(root, recursive: true)
}

func mcpAuditCount(log: SessionLog, server: String): Int64 {
    var n: Int64 = 0
    for (event in log.snapshotEvents()) {
        if (event.eventType == "mcp/call" && event.data.startsWith("${server}::")) {
            n = n + 1
        }
    }
    return n
}

// 未登记的服务器：连 node 都不 spawn，也不落审计事件。
@Test
func mcpConnectRejectsUnregisteredServer() {
    let (root, log) = mcpNewLog("unreg")
    let reg = McpRegistry(log)
    let client = McpClient(reg, log, "ghost-server", "node", [mcpServerScript])
    let r = client.connect()
    @Expect(r.ok, false)
    @Expect(r.failureKind, "not-registered")
    @Expect(r.message, "mcp-server-not-registered")
    @Expect(mcpAuditCount(log, "ghost-server"), Int64(0))
    mcpCleanup(root)
}

// 已登记但二进制不存在 → spawn-failed，绝不抛。
@Test
func mcpConnectReportsMissingBinary() {
    let (root, log) = mcpNewLog("nobb")
    let reg = McpRegistry(log)
    reg.register(mcpServerName, "stdio")
    let client = McpClient(reg, log, mcpServerName, "definitely-not-a-real-binary-xyz", [])
    let r = client.connect(timeoutMs: 5000)
    @Expect(r.ok, false)
    @Expect(r.failureKind, "spawn-failed")
    @Expect(r.message, "mcp-spawn-failed")
    @Expect(client.isConnected(), false)
    @Expect(mcpAuditCount(log, mcpServerName), Int64(0))
    mcpCleanup(root)
}

// 取消闭环：令牌已取消 → 不 spawn、不落审计。
@Test
func mcpConnectCancelledTokenShortCircuits() {
    let (root, log) = mcpNewLog("cancelled")
    let reg = McpRegistry(log)
    reg.register(mcpServerName, "stdio")
    let client = McpClient(reg, log, mcpServerName, "node", [mcpServerScript])
    let token = TurnToken()
    token.cancel()
    let r = client.connect(token: token)
    @Expect(r.ok, false)
    @Expect(r.failureKind, "cancelled")
    @Expect(r.message, "mcp-cancelled")
    @Expect(mcpAuditCount(log, mcpServerName), Int64(0))
    mcpCleanup(root)
}

// 真握手：node 起的 MCP 服务器回 initialize，客户端读到协议版本与服务器名。
// 服务器启动时先吐一行 NOISE 噪声，这里顺带证明客户端会跳过非 JSON-RPC 行。
@Test
func mcpConnectHandshakesRealServer() {
    let (root, log) = mcpNewLog("handshake")
    let reg = McpRegistry(log)
    reg.register(mcpServerName, "stdio")
    writeMcpServer()
    @Expect(Int64(File.readFrom(mcpServerScript).size) > Int64(0), true)
    let client = McpClient(reg, log, mcpServerName, "node", [mcpServerScript])
    let r = client.connect(timeoutMs: 20000)
    @Expect(r.ok, true)
    @Expect(r.op, "initialize")
    @Expect(r.protocolVersion, "2024-11-05")
    @Expect(r.serverName, "fake-mcp-server")
    @Expect(r.serverVersion, "1.0.0")
    @Expect(client.isConnected(), true)
    @Expect(mcpAuditCount(log, mcpServerName), Int64(1))
    client.close()
    deleteMcpServer()
    mcpCleanup(root)
}

// 真工具清单：两个工具，名字与描述逐个对得上。
@Test
func mcpListToolsReturnsRealTools() {
    let (root, log) = mcpNewLog("list")
    let reg = McpRegistry(log)
    reg.register(mcpServerName, "stdio")
    writeMcpServer()
    let client = McpClient(reg, log, mcpServerName, "node", [mcpServerScript])
    client.connect(timeoutMs: 20000)
    let r = client.listTools(timeoutMs: 20000)
    @Expect(r.ok, true)
    @Expect(Int64(r.tools.size), Int64(2))
    @Expect(r.tools[0].name, "hello")
    @Expect(r.tools[0].description, "say hello to a name")
    @Expect(r.tools[1].name, "boom")
    @Expect(r.tools[1].description, "always fails")
    client.close()
    deleteMcpServer()
    mcpCleanup(root)
}

// 真工具调用：参数回显，isError=false。
@Test
func mcpCallToolReturnsRealContent() {
    let (root, log) = mcpNewLog("call")
    let reg = McpRegistry(log)
    reg.register(mcpServerName, "stdio")
    writeMcpServer()
    let client = McpClient(reg, log, mcpServerName, "node", [mcpServerScript])
    client.connect(timeoutMs: 20000)
    let r = client.callTool("hello", "{\"name\":\"World\"}", timeoutMs: 20000)
    @Expect(r.ok, true)
    @Expect(r.content, "hello World")
    @Expect(r.isError, false)
    client.close()
    deleteMcpServer()
    mcpCleanup(root)
}

// 服务端 isError=true 要原样透出，不是协议错误。
@Test
func mcpCallToolSurfacesServerError() {
    let (root, log) = mcpNewLog("boom")
    let reg = McpRegistry(log)
    reg.register(mcpServerName, "stdio")
    writeMcpServer()
    let client = McpClient(reg, log, mcpServerName, "node", [mcpServerScript])
    client.connect(timeoutMs: 20000)
    let r = client.callTool("boom", "{}", timeoutMs: 20000)
    @Expect(r.ok, true)
    @Expect(r.isError, true)
    @Expect(r.content, "kaboom")
    client.close()
    deleteMcpServer()
    mcpCleanup(root)
}

// 服务器回 JSON-RPC error → 归一为 protocol 失败，且断开连接。
@Test
func mcpCallToolReportsUnknownToolAsRpcError() {
    let (root, log) = mcpNewLog("unknown")
    let reg = McpRegistry(log)
    reg.register(mcpServerName, "stdio")
    writeMcpServer()
    let client = McpClient(reg, log, mcpServerName, "node", [mcpServerScript])
    client.connect(timeoutMs: 20000)
    let r = client.callTool("nope", "{}", timeoutMs: 20000)
    @Expect(r.ok, false)
    @Expect(r.failureKind, "protocol")
    @Expect(r.message.contains("mcp-rpc-error"), true)
    @Expect(r.message.contains("-32602"), true)
    @Expect(client.isConnected(), false)
    client.close()
    deleteMcpServer()
    mcpCleanup(root)
}

// 未握手就调用 → 权限/状态门拦下，且不误发任何请求。
@Test
func mcpCallToolBeforeConnectIsRejected() {
    let (root, log) = mcpNewLog("pre")
    let reg = McpRegistry(log)
    reg.register(mcpServerName, "stdio")
    let client = McpClient(reg, log, mcpServerName, "node", [mcpServerScript])
    let r = client.listTools(timeoutMs: 5000)
    @Expect(r.ok, false)
    @Expect(r.failureKind, "not-registered")
    @Expect(r.message, "mcp-not-connected")
    @Expect(mcpAuditCount(log, mcpServerName), Int64(0))
    mcpCleanup(root)
}

// 超时：服务器起来了但从不回复（node -e 只挂着 stdin），deadline 到期走 timeout。
@Test
func mcpConnectTimesOutWhenServerStalls() {
    let (root, log) = mcpNewLog("stall")
    let reg = McpRegistry(log)
    reg.register(mcpServerName, "stdio")
    let stallScript = "process.stdin.resume(); setTimeout(() => process.exit(0), 60000);"
    let client = McpClient(reg, log, mcpServerName, "node", ["-e", stallScript])
    let r = client.connect(timeoutMs: 1500)
    @Expect(r.ok, false)
    @Expect(r.failureKind, "timeout")
    @Expect(r.message, "mcp-reply-timeout")
    @Expect(client.isConnected(), false)
    mcpCleanup(root)
}

// 审计对账：一次握手 + 一次列清单 + 两次调用 = 4 条 mcp/call；被拦下的不计数。
@Test
func mcpAuditMatchesRealCalls() {
    let (root, log) = mcpNewLog("audit")
    let reg = McpRegistry(log)
    reg.register(mcpServerName, "stdio")
    writeMcpServer()
    let client = McpClient(reg, log, mcpServerName, "node", [mcpServerScript])
    client.connect(timeoutMs: 20000)
    client.listTools(timeoutMs: 20000)
    client.callTool("hello", "{}", timeoutMs: 20000)
    client.callTool("boom", "{}", timeoutMs: 20000)
    @Expect(mcpAuditCount(log, mcpServerName), Int64(4))
    // 另一台从未登记的服务器：一次不计数
    let ghost = McpClient(reg, log, "ghost-server", "node", [mcpServerScript])
    ghost.connect(timeoutMs: 5000)
    @Expect(mcpAuditCount(log, "ghost-server"), Int64(0))
    client.close()
    deleteMcpServer()
    mcpCleanup(root)
}

// ─── MCP-E：重连 supervisor + 环境净化 ────────────────────

func mcpSupervisorDir(): String {
    let root = "../target/tmp/mcp-supervisor-test"
    if (!exists(root)) { Directory.create(root, recursive: true) }
    return canonicalize(root).toString()
}

// 崩溃计数器脚本：首次启动（crash=1）150ms 后退出，后续启动稳定。
// 工具描述返回 process.env.TEST_API_KEY 的值，供环境净化测试验证。
func mcpWriteSupervisorScript(dir: String): String {
    let path = "${dir}/mcp-supervisor-server.js"
    let body = joinStrings([
        "const fs=require('fs'),readline=require('readline');",
        "let crash=0;",
        "try{crash=parseInt(fs.readFileSync(process.env.MCP_CRASH_COUNTER,'utf8'))||0;}catch(e){}",
        "crash++;",
        "try{fs.writeFileSync(process.env.MCP_CRASH_COUNTER,String(crash));}catch(e){}",
        "if(crash===1){setTimeout(()=>process.exit(1),150);}",
        "const rl=readline.createInterface({input:process.stdin,terminal:false});",
        "function send(o){process.stdout.write(JSON.stringify(o)+'\\n');}",
        "rl.on('line',(raw)=>{",
        "  let m;",
        "  try{m=JSON.parse(raw);}catch(e){return;}",
        "  if(m.method==='initialize'){",
        "    send({jsonrpc:'2.0',id:m.id,result:{",
        "      protocolVersion:'2024-11-05',capabilities:{},",
        "      serverInfo:{name:'supervisor-test',version:'1'}}});",
        "  } else if(m.method==='tools/list'){",
        "    const v=process.env.TEST_API_KEY||'<absent>';",
        "    send({jsonrpc:'2.0',id:m.id,result:{tools:[{name:'echo',description:v}]}});",
        "  } else if(m.method==='tools/call'){",
        "    const v=process.env.TEST_API_KEY||'<absent>';",
        "    send({jsonrpc:'2.0',id:m.id,result:{content:[{type:'text',text:v}],isError:false}});",
        "  }",
        "});"
    ], "\n")
    File.writeTo(path, body.toArray())
    return path
}

// 重连耗尽脚本：首次启动（crash=1）150ms 后退出，后续启动立即退出。
func mcpWriteExhaustionScript(dir: String): String {
    let path = "${dir}/mcp-exhaust-server.js"
    let body = joinStrings([
        "const fs=require('fs'),readline=require('readline');",
        "let crash=0;",
        "try{crash=parseInt(fs.readFileSync(process.env.MCP_CRASH_COUNTER,'utf8'))||0;}catch(e){}",
        "crash++;",
        "try{fs.writeFileSync(process.env.MCP_CRASH_COUNTER,String(crash));}catch(e){}",
        "if(crash===1){setTimeout(()=>process.exit(1),150);}else{process.exit(1);}",
        "const rl=readline.createInterface({input:process.stdin,terminal:false});",
        "function send(o){process.stdout.write(JSON.stringify(o)+'\\n');}",
        "rl.on('line',(raw)=>{",
        "  let m;",
        "  try{m=JSON.parse(raw);}catch(e){return;}",
        "  if(m.method==='initialize'){",
        "    send({jsonrpc:'2.0',id:m.id,result:{",
        "      protocolVersion:'2024-11-05',capabilities:{},",
        "      serverInfo:{name:'exhaust-test',version:'1'}}});",
        "  } else if(m.method==='tools/list'){",
        "    send({jsonrpc:'2.0',id:m.id,result:{tools:[{name:'echo',description:'ok'}]}});",
        "  }",
        "});"
    ], "\n")
    File.writeTo(path, body.toArray())
    return path
}

func mcpScrubEventKeys(log: SessionLog): Array<String> {
    let keys = ArrayList<String>()
    for (event in log.snapshotEvents()) {
        if (event.eventType == "mcp/env-scrub") {
            for (k in event.data.split(",").toArray()) {
                if (k.size > 0) { keys.add(k) }
            }
        }
    }
    return keys.toArray()
}

// spawn 前环境净化：TEST_API_KEY 的值被替换为 <redacted>，子进程只看到脱敏值。
@Test
func mcpEnvScrubRedactsSensitiveKeys() {
    let dir = mcpSupervisorDir()
    let script = mcpWriteSupervisorScript(dir)
    let counter = "${dir}/crash-env.txt"
    File.writeTo(counter, "10".toArray())
    setVariable("TEST_API_KEY", "secret123")
    setVariable("MCP_CRASH_COUNTER", counter)
    let log = SessionLog("${dir}/env-scrub.log")
    let reg = McpRegistry(log)
    reg.register("scrub-server", "stdio")
    let policy = McpReconnectPolicy(initialDelayMs: 100.0, maxDelayMs: 300.0, maxAttempts: 3.0)
    let client = McpClient(reg, log, "scrub-server", "node", [script], reconnectPolicy: policy)
    try {
        @Expect(client.connect(timeoutMs: 10000).ok, true)
        let tools = client.listTools(timeoutMs: 10000)
        @Expect(tools.ok, true)
        @Expect(tools.tools.size > 0, true)
        @Expect(tools.tools[0].description == "<redacted>", true)
        let call = client.callTool("echo", "{}", timeoutMs: 10000)
        @Expect(call.ok, true)
        @Expect(call.content == "<redacted>", true)
        @Expect(call.content.contains("secret123"), false)
        let scrubbed = mcpScrubEventKeys(log)
        @Expect(scrubbed.contains("TEST_API_KEY"), true)
    } finally {
        client.close()
        removeVariable("TEST_API_KEY")
        removeVariable("MCP_CRASH_COUNTER")
    }
}

// 子进程异常退出 → 按 McpReconnectPolicy 自动重连，重连后 listTools 成功。
@Test
func mcpReconnectAfterCrash() {
    let dir = mcpSupervisorDir()
    let script = mcpWriteSupervisorScript(dir)
    let counter = "${dir}/crash-reconnect.txt"
    File.writeTo(counter, "0".toArray())
    setVariable("MCP_CRASH_COUNTER", counter)
    let log = SessionLog("${dir}/reconnect.log")
    let reg = McpRegistry(log)
    reg.register("rc-server", "stdio")
    let policy = McpReconnectPolicy(initialDelayMs: 100.0, maxDelayMs: 500.0, maxAttempts: 5.0)
    let client = McpClient(reg, log, "rc-server", "node", [script], reconnectPolicy: policy)
    try {
        @Expect(client.connect(timeoutMs: 10000).ok, true)
        @Expect(client.listTools(timeoutMs: 10000).ok, true)
        // 等待首次启动的子进程崩溃（150ms 后退出）
        sleep(400 * Duration.millisecond)
        // 崩溃后 listTools 应触发重连并成功；重连期间 isConnected() 为 false
        let result = client.listTools(timeoutMs: 15000)
        @Expect(result.ok, true)
        @Expect(client.isConnected(), true)
    } finally {
        client.close()
        removeVariable("MCP_CRASH_COUNTER")
    }
}

// close() 调用 → 不重连；后续 listTools 直接返回 mcp-not-connected。
@Test
func mcpNoReconnectAfterClose() {
    let dir = mcpSupervisorDir()
    let script = mcpWriteSupervisorScript(dir)
    let counter = "${dir}/crash-close.txt"
    File.writeTo(counter, "10".toArray())
    setVariable("MCP_CRASH_COUNTER", counter)
    let log = SessionLog("${dir}/no-reconnect.log")
    let reg = McpRegistry(log)
    reg.register("close-server", "stdio")
    let policy = McpReconnectPolicy(initialDelayMs: 100.0, maxDelayMs: 300.0, maxAttempts: 3.0)
    let client = McpClient(reg, log, "close-server", "node", [script], reconnectPolicy: policy)
    try {
        @Expect(client.connect(timeoutMs: 10000).ok, true)
        client.close()
        @Expect(client.isConnected(), false)
        let result = client.listTools(timeoutMs: 5000)
        @Expect(result.ok, false)
        @Expect(result.message, "mcp-not-connected")
    } finally {
        removeVariable("MCP_CRASH_COUNTER")
    }
}

// 重连耗尽：每次重连的子进程都立即崩溃 → 达到 maxAttempts → mcp-reconnect-exhausted。
@Test
func mcpReconnectExhaustion() {
    let dir = mcpSupervisorDir()
    let script = mcpWriteExhaustionScript(dir)
    let counter = "${dir}/crash-exhaust.txt"
    File.writeTo(counter, "0".toArray())
    setVariable("MCP_CRASH_COUNTER", counter)
    let log = SessionLog("${dir}/exhaustion.log")
    let reg = McpRegistry(log)
    reg.register("ex-server", "stdio")
    let policy = McpReconnectPolicy(initialDelayMs: 50.0, maxDelayMs: 100.0, maxAttempts: 2.0)
    let client = McpClient(reg, log, "ex-server", "node", [script], reconnectPolicy: policy)
    try {
        @Expect(client.connect(timeoutMs: 10000).ok, true)
        @Expect(client.listTools(timeoutMs: 10000).ok, true)
        // 等待首次子进程崩溃
        sleep(400 * Duration.millisecond)
        // 崩溃后重连：crash=2+ 子进程立即退出，重连全部失败 → 耗尽
        let result = client.listTools(timeoutMs: 30000)
        @Expect(result.ok, false)
        @Expect(result.message == "mcp-reconnect-exhausted", true)
    } finally {
        client.close()
        removeVariable("MCP_CRASH_COUNTER")
    }
}
