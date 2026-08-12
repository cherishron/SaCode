use anyhow::Result;
use serde_json::{json, Value};
use std::io::{self, BufRead, Write};

use crate::tools::ToolRegistry;

/// JSON-RPC 标准错误码
///
/// 参考：https://www.jsonrpc.org/specification#error_object
/// MCP 规范在 JSON-RPC 基础上扩展，但 server 侧主要使用标准错误码。
mod error_code {
    pub const PARSE_ERROR: i32 = -32700;
    pub const INVALID_REQUEST: i32 = -32600;
    pub const METHOD_NOT_FOUND: i32 = -32601;
    pub const INVALID_PARAMS: i32 = -32602;
    pub const INTERNAL_ERROR: i32 = -32603;
}

/// MCP 协议版本 — 2025-06-18 draft
const MCP_PROTOCOL_VERSION: &str = "2025-06-18";

pub fn run_stdio_server() -> Result<()> {
    let stdin = io::stdin();
    let mut stdout = io::stdout();
    let registry = ToolRegistry::builtin();

    for line in stdin.lock().lines() {
        // IO 错误（如 stdin 关闭）才退出，单行解析错误返回 envelope 继续
        let line = match line {
            Ok(l) => l,
            Err(_) => break, // stdin 关闭，正常退出
        };
        if line.trim().is_empty() {
            continue;
        }

        // 解析 JSON — parse error 返回 envelope，不退出 server
        let request: Value = match serde_json::from_str(&line) {
            Ok(v) => v,
            Err(e) => {
                let response = json!({
                    "jsonrpc": "2.0",
                    "id": null,
                    "error": {
                        "code": error_code::PARSE_ERROR,
                        "message": format!("parse error: {}", e)
                    }
                });
                let _ = writeln!(stdout, "{}", serde_json::to_string(&response)?);
                let _ = stdout.flush();
                continue;
            }
        };

        // notification（无 id）不回复，仅处理请求
        let is_notification = !request.is_object()
            || request.get("id").is_none();
        if is_notification {
            // 仍需处理 notifications/initialized 等，但不回复
            continue;
        }

        let response = handle_request(&registry, &request);
        match response {
            Ok(value) => {
                let _ = writeln!(stdout, "{}", serde_json::to_string(&value)?);
                let _ = stdout.flush();
            }
            Err(e) => {
                // 内部错误 — 返回 envelope 而非退出
                let id = request.get("id").cloned().unwrap_or(Value::Null);
                let response = json!({
                    "jsonrpc": "2.0",
                    "id": id,
                    "error": {
                        "code": error_code::INTERNAL_ERROR,
                        "message": format!("internal error: {}", e)
                    }
                });
                let _ = writeln!(stdout, "{}", serde_json::to_string(&response)?);
                let _ = stdout.flush();
            }
        }
    }

    Ok(())
}

pub fn handle_request(
    registry: &ToolRegistry,
    request: &Value,
) -> Result<Value> {
    // 校验 jsonrpc 版本 — 必须为 "2.0"
    let jsonrpc = request.get("jsonrpc").and_then(|v| v.as_str()).unwrap_or("");
    if jsonrpc != "2.0" {
        return Ok(json!({
            "jsonrpc": "2.0",
            "id": request.get("id").cloned().unwrap_or(Value::Null),
            "error": {
                "code": error_code::INVALID_REQUEST,
                "message": "jsonrpc must be \"2.0\""
            }
        }));
    }

    let id = request
        .get("id")
        .cloned()
        .unwrap_or(Value::Null);
    let method = request
        .get("method")
        .and_then(|value| value.as_str())
        .unwrap_or("");

    let result = match method {
        "initialize" => json!({
            "protocolVersion": MCP_PROTOCOL_VERSION,
            "capabilities": {
                "tools": { "listChanged": false }
            },
            "serverInfo": {
                "name": "sacode-built-in-mcp",
                "version": env!("CARGO_PKG_VERSION")
            },
            "instructions": "Built-in MCP stdio server exposing selected SaCode tools."
        }),
        "ping" => json!({}),
        "tools/list" => json!({
            "tools": builtin_stdio_tools(registry)
        }),
        "tools/call" => {
            let params = request.get("params").cloned().unwrap_or_else(|| json!({}));
            let name = params
                .get("name")
                .and_then(|value| value.as_str())
                .unwrap_or("");
            // name 缺失返回 invalid params（而非静默走白名单拦截）
            if name.is_empty() {
                return Ok(json!({
                    "jsonrpc": "2.0",
                    "id": id,
                    "error": {
                        "code": error_code::INVALID_PARAMS,
                        "message": "params.name is required for tools/call"
                    }
                }));
            }
            let arguments = params
                .get("arguments")
                .cloned()
                .unwrap_or_else(|| json!({}));
            handle_tool_call(registry, name, arguments)
        }
        // resources 协议方法 — 当前无 resources 数据，返回空列表（符合 MCP 规范）
        "resources/list" => json!({ "resources": [] }),
        "resources/read" => {
            let uri = request
                .get("params")
                .and_then(|p| p.get("uri"))
                .and_then(|u| u.as_str())
                .unwrap_or("");
            return Ok(json!({
                "jsonrpc": "2.0",
                "id": id,
                "error": {
                    "code": error_code::INVALID_PARAMS,
                    "message": format!("resource not found: {}", uri)
                }
            }));
        }
        "resources/templates/list" => json!({ "resourceTemplates": [] }),
        "resources/subscribe" | "resources/unsubscribe" => json!({}),
        // prompts 协议方法 — 当前无 prompts 数据，返回空列表
        "prompts/list" => json!({ "prompts": [] }),
        "prompts/get" => {
            let name = request
                .get("params")
                .and_then(|p| p.get("name"))
                .and_then(|n| n.as_str())
                .unwrap_or("");
            return Ok(json!({
                "jsonrpc": "2.0",
                "id": id,
                "error": {
                    "code": error_code::INVALID_PARAMS,
                    "message": format!("prompt not found: {}", name)
                }
            }));
        },
        // logging 协议方法 — 接受 setLevel 但无实际日志路由
        "logging/setLevel" => json!({}),
        _ => {
            return Ok(json!({
                "jsonrpc": "2.0",
                "id": id,
                "error": {
                    "code": error_code::METHOD_NOT_FOUND,
                    "message": format!("method not found: {}", method)
                }
            }))
        }
    };

    Ok(json!({
        "jsonrpc": "2.0",
        "id": id,
        "result": result,
    }))
}

/// MCP 暴露侧工具白名单 — 仅暴露 ReadOnly 级工具，确保外部调用无副作用风险
const EXPOSED_TOOLS: &[&str] = &[
    "fs.read",
    "fs.list",
    "fs.read_multi",
    "fs.search",
    "git.diff",
    "code.symbols",
    "code.deps",
    "code.search",
    "test.run",
    "web.fetch",
    "web.search",
];

fn builtin_stdio_tools(registry: &ToolRegistry) -> Vec<Value> {
    EXPOSED_TOOLS
        .iter()
        .filter_map(|name| registry.get(name))
        .map(|spec| {
            json!({
                "name": spec.name,
                "title": spec.name,
                "description": spec.description,
                "inputSchema": spec.input_schema,
            })
        })
        .collect()
}

fn handle_tool_call(
    registry: &ToolRegistry,
    name: &str,
    arguments: Value,
) -> Value {
    if !EXPOSED_TOOLS.contains(&name) {
        return json!({
            "content": [{
                "type": "text",
                "text": format!("unsupported built-in MCP tool: {}", name)
            }],
            "isError": true
        });
    }

    match registry.execute(name, arguments) {
        Ok(output) if output.success => json!({
            "content": [{
                "type": "text",
                "text": serde_json::to_string(&output.data).unwrap_or_else(|_| "{}".to_string())
            }],
            "data": output.data,
            "isError": false
        }),
        Ok(output) => json!({
            "content": [{
                "type": "text",
                "text": output.message.unwrap_or_else(|| "tool execution failed".to_string())
            }],
            "isError": true
        }),
        Err(error) => json!({
            "content": [{
                "type": "text",
                "text": error.to_string()
            }],
            "isError": true
        }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_request(method: &str, id: Option<i64>, params: Option<Value>) -> Value {
        let mut req = json!({
            "jsonrpc": "2.0",
            "method": method,
        });
        if let Some(id) = id {
            req["id"] = json!(id);
        }
        if let Some(p) = params {
            req["params"] = p;
        }
        req
    }

    #[test]
    fn initialize_returns_capabilities() {
        let registry = ToolRegistry::builtin();
        let req = make_request("initialize", Some(1), None);
        let resp = handle_request(&registry, &req).unwrap();
        assert_eq!(resp["jsonrpc"], "2.0");
        assert_eq!(resp["id"], 1);
        assert!(resp["result"]["capabilities"].is_object());
        assert!(resp["result"]["capabilities"]["tools"].is_object());
        assert_eq!(resp["result"]["protocolVersion"], MCP_PROTOCOL_VERSION);
    }

    #[test]
    fn ping_returns_empty_result() {
        let registry = ToolRegistry::builtin();
        let req = make_request("ping", Some(2), None);
        let resp = handle_request(&registry, &req).unwrap();
        assert_eq!(resp["id"], 2);
        assert!(resp["result"].is_object());
    }

    #[test]
    fn unknown_method_returns_32601() {
        let registry = ToolRegistry::builtin();
        let req = make_request("nonexistent/method", Some(3), None);
        let resp = handle_request(&registry, &req).unwrap();
        assert_eq!(resp["error"]["code"], error_code::METHOD_NOT_FOUND);
        assert_eq!(resp["id"], 3);
    }

    #[test]
    fn invalid_jsonrpc_version_returns_32600() {
        let registry = ToolRegistry::builtin();
        let req = json!({
            "jsonrpc": "1.0",
            "id": 4,
            "method": "initialize"
        });
        let resp = handle_request(&registry, &req).unwrap();
        assert_eq!(resp["error"]["code"], error_code::INVALID_REQUEST);
    }

    #[test]
    fn tools_call_missing_name_returns_32602() {
        let registry = ToolRegistry::builtin();
        let req = make_request("tools/call", Some(5), Some(json!({ "arguments": {} })));
        let resp = handle_request(&registry, &req).unwrap();
        assert_eq!(resp["error"]["code"], error_code::INVALID_PARAMS);
    }

    #[test]
    fn tools_list_returns_exposed_tools() {
        let registry = ToolRegistry::builtin();
        let req = make_request("tools/list", Some(6), None);
        let resp = handle_request(&registry, &req).unwrap();
        let tools = resp["result"]["tools"].as_array().unwrap();
        // 至少包含 fs.read
        let names: Vec<&str> = tools.iter().map(|t| t["name"].as_str().unwrap()).collect();
        assert!(names.contains(&"fs.read"));
    }

    #[test]
    fn resources_list_returns_empty() {
        let registry = ToolRegistry::builtin();
        let req = make_request("resources/list", Some(7), None);
        let resp = handle_request(&registry, &req).unwrap();
        assert_eq!(resp["result"]["resources"].as_array().unwrap().len(), 0);
    }

    #[test]
    fn prompts_list_returns_empty() {
        let registry = ToolRegistry::builtin();
        let req = make_request("prompts/list", Some(8), None);
        let resp = handle_request(&registry, &req).unwrap();
        assert_eq!(resp["result"]["prompts"].as_array().unwrap().len(), 0);
    }

    #[test]
    fn resources_read_unknown_uri_returns_32602() {
        let registry = ToolRegistry::builtin();
        let req = make_request("resources/read", Some(9), Some(json!({ "uri": "file:///nonexistent" })));
        let resp = handle_request(&registry, &req).unwrap();
        assert_eq!(resp["error"]["code"], error_code::INVALID_PARAMS);
    }

    #[test]
    fn prompts_get_unknown_name_returns_32602() {
        let registry = ToolRegistry::builtin();
        let req = make_request("prompts/get", Some(10), Some(json!({ "name": "nonexistent" })));
        let resp = handle_request(&registry, &req).unwrap();
        assert_eq!(resp["error"]["code"], error_code::INVALID_PARAMS);
    }

    #[test]
    fn logging_set_level_accepted() {
        let registry = ToolRegistry::builtin();
        let req = make_request("logging/setLevel", Some(11), Some(json!({ "level": "info" })));
        let resp = handle_request(&registry, &req).unwrap();
        assert!(resp["result"].is_object());
    }

    #[test]
    fn tools_call_unsupported_returns_iserror() {
        let registry = ToolRegistry::builtin();
        let req = make_request("tools/call", Some(12), Some(json!({
            "name": "fs.write",
            "arguments": {}
        })));
        let resp = handle_request(&registry, &req).unwrap();
        assert_eq!(resp["result"]["isError"], true);
    }
}
