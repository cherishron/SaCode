use std::io::{BufRead, BufReader, Write};
use std::process::{Command, Stdio};

#[test]
fn mcp_serve_initialize_smoke_test() {
    let sacode = env!("CARGO_BIN_EXE_sacode");

    let mut child = Command::new(sacode)
        .args(["mcp", "serve"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .expect("spawn sacode mcp serve");

    let mut stdin = child.stdin.take().expect("child stdin");
    writeln!(
        stdin,
        "{{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"initialize\"}}"
    )
    .expect("write initialize request");
    drop(stdin);

    let stdout = child.stdout.take().expect("child stdout");
    let mut lines = BufReader::new(stdout).lines();
    let ready_line = lines
        .next()
        .expect("ready line present")
        .expect("read ready line");
    assert!(ready_line.contains("SaCode MCP stdio server ready"));

    let response_line = lines
        .next()
        .expect("response line present")
        .expect("read response line");
    let response: serde_json::Value =
        serde_json::from_str(&response_line).expect("parse initialize response");

    assert_eq!(response["jsonrpc"], "2.0");
    assert_eq!(response["id"], 1);
    assert_eq!(
        response["result"]["serverInfo"]["name"],
        "sacode-built-in-mcp"
    );

    let status = child.wait().expect("wait child exit");
    assert!(status.success());
}
