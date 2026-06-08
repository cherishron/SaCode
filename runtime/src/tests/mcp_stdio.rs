use super::*;

#[test]
fn test_mcp_stdio_initialize() {
    let registry = ToolRegistry::builtin();
    let request = serde_json::json!({
        "jsonrpc": "2.0",
        "id": 1,
        "method": "initialize"
    });

    let response = crate::mcp::servers::stdio::handle_request(&registry, &request)
        .expect("initialize should succeed");

    assert_eq!(response["jsonrpc"], "2.0");
    assert_eq!(response["id"], 1);
    assert_eq!(
        response["result"]["serverInfo"]["name"],
        "sacode-built-in-mcp"
    );
}

#[test]
fn test_mcp_stdio_tools_list_exposes_builtin_tools() {
    let registry = ToolRegistry::builtin();
    let request = serde_json::json!({
        "jsonrpc": "2.0",
        "id": 2,
        "method": "tools/list"
    });

    let response = crate::mcp::servers::stdio::handle_request(&registry, &request)
        .expect("tools/list should succeed");
    let tools = response["result"]["tools"].as_array().expect("tools array");

    assert!(tools.iter().any(|tool| tool["name"] == "fs.read"));
    assert!(tools.iter().any(|tool| tool["name"] == "fs.list"));
    assert!(tools.iter().any(|tool| tool["name"] == "git.diff"));
}

#[test]
fn test_mcp_stdio_tools_call_executes_fs_list() {
    let _guard = sandbox_test_lock();
    crate::sandbox::reset_global_policy();
    let temp_dir = tempfile::tempdir().expect("create temp dir");
    let _cwd = CurrentDirGuard::enter(temp_dir.path());
    fs::write(temp_dir.path().join("demo.txt"), "hello").expect("write file");
    let registry = ToolRegistry::builtin();
    let request = serde_json::json!({
        "jsonrpc": "2.0",
        "id": 3,
        "method": "tools/call",
        "params": {
            "name": "fs.list",
            "arguments": {
                "path": ".",
                "recursive": false,
                "include_hidden": false
            }
        }
    });

    let response = crate::mcp::servers::stdio::handle_request(&registry, &request)
        .expect("tools/call should succeed");

    assert_eq!(response["result"]["isError"], false);
    assert!(response["result"]["data"].is_object());
    let text = response["result"]["content"][0]["text"]
        .as_str()
        .unwrap_or("");
    assert!(text.contains("demo.txt"));
}
