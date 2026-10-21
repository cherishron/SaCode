package core

import std.collection.ArrayList

// MCP 工具桥：把已连接的 McpClient 的工具注册到 ToolRuntime 声明面与执行器表，
// 让模型工具表包含 mcp__<server>__<name> 条目，调用转发到 McpClient.callTool。
//
// 设计要点：
//   - McpToolInfo.inputSchema 非空时用它注册 ToolSpec.schema；空时用通用 schema 兜底。
//   - 桥是可重复调用的同步装配器：每次 sync() 先清旧声明与旧执行器，再从客户端
//     实时 listTools() 注册。断开的客户端 sync() 返回 0 注册数并清理残留。
//   - guard 与取消检查由 ModelToolRuntime.execute 统一处理（与 read/write 同走
//     executeWithApproval 管线）；桥执行器只做转发与结果归一。
//   - 桥不缓存工具清单：每次 sync 都向客户端重新查 tools/list，确保断开→工具消失。

// 通用 schema 兜底：服务器不返回 inputSchema 时用此。
let mcpGenericSchema: String = "{\"type\":\"object\"}"

// 单次 sync 的结果：注册了多少条、清理了多少条旧条目。
public class McpBridgeSyncResult {
    public let serverName: String
    public let registered: Int64
    public let cleaned: Int64
    public init(serverName: String, registered: Int64, cleaned: Int64) {
        this.serverName = serverName
        this.registered = registered
        this.cleaned = cleaned
    }
}

public class McpToolBridge {
    let client: McpClient
    let registry: ToolRegistry
    let runtime: ToolRuntime
    let log: SessionLog
    // 已注册的公开工具名快照：sync 前用它精确清理本桥上次的声明与执行器。
    var registeredNames = ArrayList<String>()

    public init(client: McpClient, registry: ToolRegistry, runtime: ToolRuntime, log: SessionLog) {
        this.client = client
        this.registry = registry
        this.runtime = runtime
        this.log = log
    }

    // 同步：向客户端查 tools/list，把结果注册为 mcp__<server>__<name>。
    // 先清理上次的条目（含断开/重连后工具消失的情况），再注册当前清单。
    // 未连接或 listTools 失败时只清理不注册，返回 registered=0。
    public func sync(token!: TurnToken = TurnToken()): McpBridgeSyncResult {
        let cleaned = unregisterAll()
        if (!client.isConnected()) {
            return McpBridgeSyncResult(client.serverName, Int64(0), cleaned)
        }
        var count: Int64 = 0
        let result = client.listTools(token: token)
        if (result.ok) {
            for (info in result.tools) {
                if (info.name.size == 0) { continue }
                let publicName = mcpPublicToolName(client.serverName, info.name)
                if (registry.has(publicName)) { continue }
                let desc = if (info.description.size > 0) {
                    "MCP(${client.serverName}): ${info.description}"
                } else {
                    "MCP(${client.serverName}): ${info.name}"
                }
                let schema = if (info.inputSchema.size > 0) { info.inputSchema } else { mcpGenericSchema }
                registry.register(ToolSpec(publicName, desc, schema, false))
                let rawName = info.name
                let cli = client
                let rt = runtime
                runtime.executors.add(publicName, { _, args =>
                    let callResult = cli.callTool(rawName, args, token: token)
                    rt.lastDetail.argsAfterPre = args
                    rt.lastDetail.stage = if (callResult.ok && !callResult.isError) {
                        "ran"
                    } else {
                        "mcp-call-error"
                    }
                    rt.lastDetail.verified = callResult.ok && !callResult.isError
                    log.append("tool/runtime/result", if (callResult.ok) {
                        callResult.content
                    } else {
                        callResult.failureKind + ":" + callResult.message
                    })
                    if (callResult.ok && !callResult.isError) {
                        return ApprovalOutcome(true, callResult.content)
                    }
                    let why = if (callResult.isError) {
                        "mcp-tool-error:${callResult.content}"
                    } else {
                        "mcp-call-failed:${callResult.failureKind}:${callResult.message}"
                    }
                    return ApprovalOutcome(false, why)
                })
                registeredNames.add(publicName)
                count += 1
            }
        }
        return McpBridgeSyncResult(client.serverName, count, cleaned)
    }

    // 断开：注销本桥注册的全部公开工具名，并移除对应执行器。
    // 不影响其他桥或内置工具注册的条目。
    public func disconnect(): Int64 {
        return unregisterAll()
    }

    // 清理本桥注册的全部条目，返回清理数。
    func unregisterAll(): Int64 {
        var n: Int64 = 0
        for (name in registeredNames) {
            if (registry.unregister(name)) { n += 1 }
            runtime.executors.remove(name)
        }
        registeredNames.clear()
        return n
    }
}
