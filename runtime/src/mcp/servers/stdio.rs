use anyhow::Result;
use serde_json::json;
use std::io::{self, BufRead, Write};

use crate::tools::ToolRegistry;

pub fn run_stdio_server() -> Result<()> {
    let stdin = io::stdin();
    let mut stdout = io::stdout();
    let registry = ToolRegistry::builtin();

    for line in stdin.lock().lines() {
        let line = line?;
        if line.trim().is_empty() {
            continue;
        }
        let request: serde_json::Value = serde_json::from_str(&line)?;
        let response = handle_request(&registry, &request)?;
        writeln!(stdout, "{}", serde_json::to_string(&response)?)?;
        stdout.flush()?;
    }

    Ok(())
}

pub fn handle_request(
    registry: &ToolRegistry,
    request: &serde_json::Value,
) -> Result<serde_json::Value> {
    let id = request
        .get("id")
        .cloned()
        .unwrap_or(serde_json::Value::Null);
    let method = request
        .get("method")
        .and_then(|value| value.as_str())
        .unwrap_or("");

    let result = match method {
        "initialize" => json!({
            "protocolVersion": "2025-06-18",
            "serverInfo": {
                "name": "sacode-built-in-mcp",
                "version": env!("CARGO_PKG_VERSION")
            },
            "instructions": "Built-in MCP stdio server exposing selected SaCode tools."
        }),
        "tools/list" => json!({
            "tools": builtin_stdio_tools(registry)
        }),
        "tools/call" => {
            let params = request.get("params").cloned().unwrap_or_else(|| json!({}));
            let name = params
                .get("name")
                .and_then(|value| value.as_str())
                .unwrap_or("");
            let arguments = params
                .get("arguments")
                .cloned()
                .unwrap_or_else(|| json!({}));
            handle_tool_call(registry, name, arguments)
        }
        _ => {
            return Ok(json!({
                "jsonrpc": "2.0",
                "id": id,
                "error": {
                    "code": -32601,
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

fn builtin_stdio_tools(registry: &ToolRegistry) -> Vec<serde_json::Value> {
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
    arguments: serde_json::Value,
) -> serde_json::Value {
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
