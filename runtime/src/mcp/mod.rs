use anyhow::{Context, Result};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::{
    collections::BTreeMap,
    fs,
    future::Future,
    io::{BufRead, BufReader, Write},
    path::{Path, PathBuf},
    process::{Child, ChildStdin, ChildStdout, Command, Stdio},
    sync::Arc,
};

use crate::config::SaCodeConfig;
use crate::tools::{SideEffectLevel, ToolExecutor, ToolOutput, ToolRegistry, ToolSpec};

pub mod servers;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct McpConfig {
    #[serde(default)]
    pub mcp: BTreeMap<String, McpServerConfig>,
}

/// MCP server 配置 — 支持 remote (HTTP) 和 stdio (子进程) 两种 transport
///
/// ## remote 类型
/// ```json
/// { "type": "remote", "url": "https://example.com/mcp", "enabled": true }
/// ```
///
/// ## stdio 类型
/// ```json
/// {
///   "type": "stdio",
///   "command": "npx",
///   "args": ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"],
///   "env": { "DEBUG": "true" },
///   "enabled": true
/// }
/// ```
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpServerConfig {
    #[serde(rename = "type")]
    pub server_type: String,
    /// remote 类型的 HTTP 端点；stdio 类型留空
    #[serde(default)]
    pub url: String,
    /// stdio 类型的可执行文件路径
    #[serde(default)]
    pub command: Option<String>,
    /// stdio 类型的命令行参数
    #[serde(default)]
    pub args: Option<Vec<String>>,
    /// stdio 类型的环境变量
    #[serde(default)]
    pub env: Option<BTreeMap<String, String>>,
    pub enabled: bool,
}

impl McpServerConfig {
    /// 判断是否为 stdio 子进程 transport
    pub fn is_stdio(&self) -> bool {
        self.server_type == "stdio"
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpServerDetails {
    pub protocol_version: Option<String>,
    pub server_name: Option<String>,
    pub server_version: Option<String>,
    pub instructions: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpToolInfo {
    pub name: String,
    pub title: Option<String>,
    pub description: Option<String>,
    pub input_schema: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpToolCallResult {
    pub content: serde_json::Value,
    pub is_error: bool,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum McpSource {
    User,
    Project,
}

impl McpSource {
    pub fn label(self) -> &'static str {
        match self {
            Self::User => "user",
            Self::Project => "project",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpServerEntry {
    pub name: String,
    pub server: McpServerConfig,
    pub source: McpSource,
}

#[derive(Debug, Clone)]
pub struct McpConfigStore {
    config: SaCodeConfig,
}

impl McpConfigStore {
    pub fn new(workdir: &Path) -> Self {
        Self::new_from_config(SaCodeConfig::new(workdir))
    }

    pub fn new_from_config(config: SaCodeConfig) -> Self {
        Self { config }
    }

    pub fn load(&self) -> Result<McpConfig> {
        self.config.load_merged_mcp_config()
    }

    pub fn load_from_source(&self, source: McpSource) -> Result<McpConfig> {
        let path = self.path_for_source(source);
        if !path.exists() {
            return Ok(McpConfig::default());
        }

        let content = fs::read_to_string(&path)?;
        Ok(serde_json::from_str(&content)?)
    }

    pub fn save_to_source(&self, config: &McpConfig, source: McpSource) -> Result<()> {
        let path = self.path_for_source(source);
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }

        fs::write(&path, serde_json::to_string_pretty(config)?)?;
        Ok(())
    }

    pub fn add_remote(&self, name: &str, url: &str, source: McpSource) -> Result<()> {
        let mut config = self.load_from_source(source)?;
        config.mcp.insert(
            name.to_string(),
            McpServerConfig {
                server_type: "remote".to_string(),
                url: url.to_string(),
                command: None,
                args: None,
                env: None,
                enabled: true,
            },
        );
        self.save_to_source(&config, source)
    }

    /// 添加 stdio 子进程类型的 MCP server
    ///
    /// 启动 `command` + `args`，通过 stdin/stdout 通信
    pub fn add_stdio(
        &self,
        name: &str,
        command: &str,
        args: &[String],
        env: &BTreeMap<String, String>,
        source: McpSource,
    ) -> Result<()> {
        let mut config = self.load_from_source(source)?;
        config.mcp.insert(
            name.to_string(),
            McpServerConfig {
                server_type: "stdio".to_string(),
                url: String::new(),
                command: Some(command.to_string()),
                args: Some(args.to_vec()),
                env: Some(env.clone()),
                enabled: true,
            },
        );
        self.save_to_source(&config, source)
    }

    pub fn set_enabled(&self, name: &str, enabled: bool, source: McpSource) -> Result<()> {
        let mut config = self.load_from_source(source)?;
        let server = config
            .mcp
            .get_mut(name)
            .ok_or_else(|| anyhow::anyhow!("mcp server not found: {}", name))?;
        server.enabled = enabled;
        self.save_to_source(&config, source)
    }

    pub fn get(&self, name: &str) -> Result<McpServerConfig> {
        let config = self.load()?;
        config
            .mcp
            .get(name)
            .cloned()
            .ok_or_else(|| anyhow::anyhow!("mcp server not found: {}", name))
    }

    pub fn remove(&self, name: &str, source: McpSource) -> Result<()> {
        let mut config = self.load_from_source(source)?;
        if config.mcp.remove(name).is_none() {
            anyhow::bail!("mcp server not found: {}", name);
        }
        self.save_to_source(&config, source)
    }

    pub fn list_entries(&self) -> Result<Vec<McpServerEntry>> {
        let mut merged: BTreeMap<String, McpServerEntry> = BTreeMap::new();

        for source in [McpSource::User, McpSource::Project] {
            let config = self.load_from_source(source)?;
            for (name, server) in config.mcp {
                merged.insert(
                    name.clone(),
                    McpServerEntry {
                        name,
                        server,
                        source,
                    },
                );
            }
        }

        Ok(merged.into_values().collect())
    }

    fn path_for_source(&self, source: McpSource) -> PathBuf {
        match source {
            McpSource::User => self.config.user_mcp_config(),
            McpSource::Project => self.config.project_mcp_config(),
        }
    }
}

// ============================================================================
// Stdio MCP Client — 长连接子进程 transport
// ============================================================================

/// stdio 子进程 MCP client — 持有子进程 handle，复用连接
///
/// 生命周期：
/// 1. `new(config)` 启动子进程 + 发送 initialize
/// 2. `list_tools()` / `call_tool()` 复用连接
/// 3. 子进程随 client drop 而终止
///
/// 当前设计为同步短生命周期：每次 transport 分派创建新 client。
/// 长连接复用（daemon 场景）可在上层封装 `Arc<Mutex<StdioMcpClient>>`。
#[derive(Debug)]
pub struct StdioMcpClient {
    child: Child,
    stdin: ChildStdin,
    stdout: BufReader<ChildStdout>,
    /// JSON-RPC 请求 id 自增计数器
    next_id: u64,
}

impl StdioMcpClient {
    /// 启动子进程并发送 initialize 请求
    pub fn new(config: &McpServerConfig) -> Result<Self> {
        let command = config
            .command
            .as_ref()
            .context("stdio server requires 'command' field")?;

        let mut cmd = Command::new(command);
        if let Some(args) = &config.args {
            cmd.args(args);
        }
        if let Some(env) = &config.env {
            for (k, v) in env {
                cmd.env(k, v);
            }
        }
        cmd.stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null());

        let mut child = cmd
            .spawn()
            .with_context(|| format!("failed to spawn stdio MCP server: {}", command))?;

        let stdin = child
            .stdin
            .take()
            .context("failed to capture child stdin")?;
        let stdout = child
            .stdout
            .take()
            .context("failed to capture child stdout")?;

        let mut client = Self {
            child,
            stdin,
            stdout: BufReader::new(stdout),
            next_id: 1,
        };

        // 发送 initialize — 失败说明子进程不可用
        client.send_request(
            "initialize",
            Some(serde_json::json!({
                "protocolVersion": "2025-06-18",
                "capabilities": {},
                "clientInfo": {
                    "name": "sacode",
                    "version": env!("CARGO_PKG_VERSION")
                }
            })),
        )?;

        Ok(client)
    }

    /// 发送 JSON-RPC 请求并读取响应（同步阻塞）
    ///
    /// 每个请求占一行（JSON），响应也占一行。跳过 notification（无 id 的消息）。
    fn send_request(
        &mut self,
        method: &str,
        params: Option<serde_json::Value>,
    ) -> Result<serde_json::Value> {
        let id = self.next_id;
        self.next_id += 1;

        let mut payload = serde_json::json!({
            "jsonrpc": "2.0",
            "id": id,
            "method": method,
        });
        if let Some(p) = params {
            payload["params"] = p;
        }

        let line = serde_json::to_string(&payload)? + "\n";
        self.stdin
            .write_all(line.as_bytes())
            .context("failed to write to stdio MCP server stdin")?;
        self.stdin
            .flush()
            .context("failed to flush stdio MCP server stdin")?;

        // 读取响应 — 跳过 notification（无 id 或 id != 期望值的消息）
        loop {
            let mut buf = String::new();
            let n = self
                .stdout
                .read_line(&mut buf)
                .context("failed to read from stdio MCP server stdout")?;
            if n == 0 {
                anyhow::bail!("stdio MCP server closed stdout unexpectedly");
            }
            let trimmed = buf.trim();
            if trimmed.is_empty() {
                continue;
            }
            let response: serde_json::Value = serde_json::from_str(trimmed)
                .with_context(|| format!("failed to parse stdio MCP response: {}", trimmed))?;
            // 检查是否为期望的响应（id 匹配）
            if response.get("id").and_then(|v| v.as_u64()) == Some(id) {
                // 检查是否有 error
                if let Some(error) = response.get("error") {
                    anyhow::bail!(
                        "stdio MCP server returned error: {}",
                        error
                            .get("message")
                            .and_then(|m| m.as_str())
                            .unwrap_or("unknown")
                    );
                }
                return Ok(response
                    .get("result")
                    .cloned()
                    .unwrap_or(serde_json::json!({})));
            }
            // id 不匹配 — 可能是 notification，跳过继续读
        }
    }

    /// 列出工具
    pub fn list_tools(&mut self) -> Result<Vec<McpToolInfo>> {
        let result = self.send_request("tools/list", None)?;
        let tools = result
            .get("tools")
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default();

        Ok(tools
            .into_iter()
            .map(|tool| McpToolInfo {
                name: tool
                    .get("name")
                    .and_then(|v| v.as_str())
                    .unwrap_or_default()
                    .to_string(),
                title: tool
                    .get("title")
                    .and_then(|v| v.as_str())
                    .map(str::to_string),
                description: tool
                    .get("description")
                    .and_then(|v| v.as_str())
                    .map(str::to_string),
                input_schema: tool
                    .get("inputSchema")
                    .cloned()
                    .unwrap_or(serde_json::json!({})),
            })
            .collect())
    }

    /// 调用工具
    pub fn call_tool(
        &mut self,
        tool_name: &str,
        arguments: serde_json::Value,
    ) -> Result<McpToolCallResult> {
        let result = self.send_request(
            "tools/call",
            Some(serde_json::json!({
                "name": tool_name,
                "arguments": arguments,
            })),
        )?;

        Ok(McpToolCallResult {
            content: result
                .get("content")
                .cloned()
                .unwrap_or_else(|| result.clone()),
            is_error: result
                .get("isError")
                .and_then(|v| v.as_bool())
                .unwrap_or(false),
        })
    }

    /// 探测 server 元信息（复用已建立的连接）
    pub fn inspect(&mut self) -> Result<McpServerDetails> {
        let result = self.send_request(
            "initialize",
            Some(serde_json::json!({
                "protocolVersion": "2025-06-18",
                "capabilities": {},
                "clientInfo": { "name": "sacode", "version": env!("CARGO_PKG_VERSION") }
            })),
        )?;

        Ok(McpServerDetails {
            protocol_version: result
                .get("protocolVersion")
                .and_then(|v| v.as_str())
                .map(str::to_string),
            server_name: result
                .get("serverInfo")
                .and_then(|v| v.get("name"))
                .and_then(|v| v.as_str())
                .map(str::to_string),
            server_version: result
                .get("serverInfo")
                .and_then(|v| v.get("version"))
                .and_then(|v| v.as_str())
                .map(str::to_string),
            instructions: result
                .get("instructions")
                .and_then(|v| v.as_str())
                .map(str::to_string),
        })
    }
}

impl Drop for StdioMcpClient {
    fn drop(&mut self) {
        // 尝试优雅终止子进程
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

// ============================================================================
// Transport 分派 — 根据 server_type 选择 HTTP 或 stdio
// ============================================================================

pub async fn inspect_server(server: &McpServerConfig) -> Result<McpServerDetails> {
    // stdio transport — 同步路径直接调用，无需 HTTP
    if server.is_stdio() {
        let mut client = StdioMcpClient::new(server)?;
        return client.inspect();
    }
    inspect_server_http(server).await
}

/// HTTP transport 的 server 探测实现
async fn inspect_server_http(server: &McpServerConfig) -> Result<McpServerDetails> {
    let client = http_client()?;
    let payload = serde_json::json!({
        "jsonrpc": "2.0",
        "id": 1,
        "method": "initialize",
        "params": {
            "protocolVersion": "2025-06-18",
            "capabilities": {},
            "clientInfo": {
                "name": "sacode",
                "version": env!("CARGO_PKG_VERSION")
            }
        }
    });

    let response: serde_json::Value = client
        .post(&server.url)
        .header("content-type", "application/json")
        .header("Mcp-Method", "initialize")
        .json(&payload)
        .send()
        .await?
        .json()
        .await?;

    let result = response
        .get("result")
        .cloned()
        .unwrap_or_else(|| serde_json::json!({}));

    Ok(McpServerDetails {
        protocol_version: result
            .get("protocolVersion")
            .and_then(|v| v.as_str())
            .map(str::to_string),
        server_name: result
            .get("serverInfo")
            .and_then(|v| v.get("name"))
            .and_then(|v| v.as_str())
            .map(str::to_string),
        server_version: result
            .get("serverInfo")
            .and_then(|v| v.get("version"))
            .and_then(|v| v.as_str())
            .map(str::to_string),
        instructions: result
            .get("instructions")
            .and_then(|v| v.as_str())
            .map(str::to_string),
    })
}

pub async fn list_tools(server: &McpServerConfig) -> Result<Vec<McpToolInfo>> {
    // stdio transport
    if server.is_stdio() {
        let mut client = StdioMcpClient::new(server)?;
        return client.list_tools();
    }
    list_tools_http(server).await
}

/// HTTP transport 的工具列表实现
async fn list_tools_http(server: &McpServerConfig) -> Result<Vec<McpToolInfo>> {
    let client = http_client()?;
    let payload = serde_json::json!({
        "jsonrpc": "2.0",
        "id": 2,
        "method": "tools/list"
    });

    let response: serde_json::Value = client
        .post(&server.url)
        .header("content-type", "application/json")
        .header("Mcp-Method", "tools/list")
        .json(&payload)
        .send()
        .await?
        .json()
        .await?;

    let tools = response
        .get("result")
        .and_then(|value| value.get("tools"))
        .and_then(|value| value.as_array())
        .cloned()
        .unwrap_or_default();

    Ok(tools
        .into_iter()
        .map(|tool| McpToolInfo {
            name: tool
                .get("name")
                .and_then(|v| v.as_str())
                .unwrap_or_default()
                .to_string(),
            title: tool
                .get("title")
                .and_then(|v| v.as_str())
                .map(str::to_string),
            description: tool
                .get("description")
                .and_then(|v| v.as_str())
                .map(str::to_string),
            input_schema: tool
                .get("inputSchema")
                .cloned()
                .unwrap_or_else(|| serde_json::json!({})),
        })
        .collect())
}

pub async fn call_tool(
    server: &McpServerConfig,
    tool_name: &str,
    arguments: serde_json::Value,
) -> Result<McpToolCallResult> {
    // stdio transport
    if server.is_stdio() {
        let mut client = StdioMcpClient::new(server)?;
        return client.call_tool(tool_name, arguments);
    }
    call_tool_http(server, tool_name, arguments).await
}

/// HTTP transport 的工具调用实现
async fn call_tool_http(
    server: &McpServerConfig,
    tool_name: &str,
    arguments: serde_json::Value,
) -> Result<McpToolCallResult> {
    let client = http_client()?;
    let payload = serde_json::json!({
        "jsonrpc": "2.0",
        "id": 3,
        "method": "tools/call",
        "params": {
            "name": tool_name,
            "arguments": arguments,
        }
    });

    let response: serde_json::Value = client
        .post(&server.url)
        .header("content-type", "application/json")
        .header("Mcp-Method", "tools/call")
        .json(&payload)
        .send()
        .await?
        .json()
        .await?;

    let result = response
        .get("result")
        .cloned()
        .unwrap_or_else(|| serde_json::json!({}));

    Ok(McpToolCallResult {
        content: result
            .get("content")
            .cloned()
            .unwrap_or_else(|| result.clone()),
        is_error: result
            .get("isError")
            .and_then(|v| v.as_bool())
            .unwrap_or(false),
    })
}

pub async fn list_enabled_tool_specs(store: &McpConfigStore) -> Result<Vec<ToolSpec>> {
    let config = store.load()?;
    let mut specs = Vec::new();

    for (server_name, server) in config.mcp {
        if !server.enabled {
            continue;
        }

        let tools = match list_tools(&server).await {
            Ok(value) => value,
            Err(_) => continue,
        };

        for tool in tools {
            specs.push(tool_info_to_spec(&server_name, tool));
        }
    }

    specs.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(specs)
}

fn block_on_mcp_future<F, T>(future: F) -> Result<T>
where
    F: Future<Output = Result<T>>,
{
    if let Ok(handle) = tokio::runtime::Handle::try_current() {
        tokio::task::block_in_place(|| handle.block_on(future))
    } else {
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .map_err(|e| anyhow::anyhow!("runtime init failed: {}", e))?;
        runtime.block_on(future)
    }
}

pub fn register_enabled_tools_sync(
    store: &McpConfigStore,
    registry: &mut ToolRegistry,
) -> Result<Vec<String>> {
    let config = store.load()?;
    let mut names = Vec::new();

    for (server_name, server) in config.mcp {
        if !server.enabled {
            continue;
        }

        let tools = match block_on_mcp_future(list_tools(&server)) {
            Ok(value) => value,
            Err(_) => continue,
        };

        for tool in tools {
            let spec = tool_info_to_spec(&server_name, tool.clone());
            let tool_name = spec.name.clone();
            registry.register(
                spec,
                Arc::new(McpToolExecutor {
                    server: server.clone(),
                    server_name: server_name.clone(),
                    tool_name: tool.name,
                }),
            );
            names.push(tool_name);
        }
    }

    names.sort();
    names.dedup();
    Ok(names)
}

pub async fn find_enabled_search_tool(store: &McpConfigStore) -> Result<Option<(String, String)>> {
    let config = store.load()?;

    for (server_name, server) in config.mcp {
        if !server.enabled {
            continue;
        }

        let tools = match list_tools(&server).await {
            Ok(value) => value,
            Err(_) => continue,
        };

        for tool in tools {
            let lowered_name = tool.name.to_lowercase();
            let lowered_desc = tool.description.clone().unwrap_or_default().to_lowercase();
            if lowered_name.contains("search") || lowered_desc.contains("search") {
                return Ok(Some((server_name, tool.name)));
            }
        }
    }

    Ok(None)
}

fn tool_info_to_spec(server_name: &str, tool: McpToolInfo) -> ToolSpec {
    ToolSpec {
        name: format!("mcp.{}.{}", server_name, tool.name),
        description: tool
            .description
            .unwrap_or_else(|| "Remote MCP tool".to_string()),
        input_schema: tool.input_schema,
        output_schema: serde_json::json!({
            "type": "object"
        }),
        side_effect_level: SideEffectLevel::Execute,
        approval_required: true,
        timeout_ms: Some(30_000),
        tags: vec!["mcp".to_string(), server_name.to_string()],
    }
}

#[derive(Clone)]
struct McpToolExecutor {
    server: McpServerConfig,
    server_name: String,
    tool_name: String,
}

impl ToolExecutor for McpToolExecutor {
    fn execute(&self, input: serde_json::Value) -> Result<ToolOutput> {
        let result = call_mcp_tool_sync(&self.server, &self.tool_name, input)?;
        Ok(ToolOutput::success(serde_json::json!({
            "content": result.content,
            "server": self.server_name,
            "tool": self.tool_name,
            "source": "mcp",
            "is_error": result.is_error,
        })))
    }
}

fn http_client() -> Result<Client> {
    Ok(Client::builder()
        .timeout(std::time::Duration::from_secs(20))
        .build()?)
}

pub fn call_mcp_tool_sync(
    server: &McpServerConfig,
    tool_name: &str,
    arguments: serde_json::Value,
) -> Result<McpToolCallResult> {
    // stdio transport — 同步路径，直接调用，无需 block_on
    if server.is_stdio() {
        let mut client = StdioMcpClient::new(server)?;
        return client.call_tool(tool_name, arguments);
    }
    call_mcp_tool_http_sync(server, tool_name, arguments)
}

/// HTTP transport 的同步工具调用实现
fn call_mcp_tool_http_sync(
    server: &McpServerConfig,
    tool_name: &str,
    arguments: serde_json::Value,
) -> Result<McpToolCallResult> {
    let client = http_client()?;
    let payload = serde_json::json!({
        "jsonrpc": "2.0",
        "id": 3,
        "method": "tools/call",
        "params": {
            "name": tool_name,
            "arguments": arguments,
        }
    });

    block_on_mcp_future(async {
        let response: serde_json::Value = client
            .post(&server.url)
            .header("content-type", "application/json")
            .header("Mcp-Method", "tools/call")
            .json(&payload)
            .send()
            .await?
            .json()
            .await?;

        let result = response
            .get("result")
            .cloned()
            .unwrap_or_else(|| serde_json::json!({}));

        Ok(McpToolCallResult {
            content: result
                .get("content")
                .cloned()
                .unwrap_or_else(|| result.clone()),
            is_error: result
                .get("isError")
                .and_then(|v| v.as_bool())
                .unwrap_or(false),
        })
    })
}

pub fn find_enabled_search_tool_sync(store: &McpConfigStore) -> Result<Option<(String, String)>> {
    let config = store.load()?;

    for (server_name, server) in config.mcp {
        if !server.enabled {
            continue;
        }

        let tools = match block_on_mcp_future(list_tools(&server)) {
            Ok(value) => value,
            Err(_) => continue,
        };

        for tool in tools {
            let lowered_name = tool.name.to_lowercase();
            let lowered_desc = tool.description.clone().unwrap_or_default().to_lowercase();
            if lowered_name.contains("search") || lowered_desc.contains("search") {
                return Ok(Some((server_name, tool.name)));
            }
        }
    }

    Ok(None)
}

pub fn list_enabled_mcp_tool_specs_sync(store: &McpConfigStore) -> Result<Vec<ToolSpec>> {
    let config = store.load()?;
    let mut specs = Vec::new();

    for (server_name, server) in config.mcp {
        if !server.enabled {
            continue;
        }

        let tools = match block_on_mcp_future(list_tools(&server)) {
            Ok(value) => value,
            Err(_) => continue,
        };

        for tool in tools {
            specs.push(tool_info_to_spec(&server_name, tool));
        }
    }

    specs.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(specs)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeMap;

    #[test]
    fn is_stdio_detects_transport_type() {
        let stdio_server = McpServerConfig {
            server_type: "stdio".to_string(),
            url: String::new(),
            command: Some("echo".to_string()),
            args: None,
            env: None,
            enabled: true,
        };
        assert!(stdio_server.is_stdio());

        let remote_server = McpServerConfig {
            server_type: "remote".to_string(),
            url: "https://example.com/mcp".to_string(),
            command: None,
            args: None,
            env: None,
            enabled: true,
        };
        assert!(!remote_server.is_stdio());
    }

    #[test]
    fn stdio_config_serialization_roundtrip() {
        let config = McpServerConfig {
            server_type: "stdio".to_string(),
            url: String::new(),
            command: Some("npx".to_string()),
            args: Some(vec![
                "-y".to_string(),
                "@modelcontextprotocol/server-filesystem".to_string(),
            ]),
            env: Some(BTreeMap::from([("DEBUG".to_string(), "true".to_string())])),
            enabled: true,
        };

        let json = serde_json::to_string(&config).unwrap();
        let deserialized: McpServerConfig = serde_json::from_str(&json).unwrap();
        assert!(deserialized.is_stdio());
        assert_eq!(deserialized.command.as_deref(), Some("npx"));
        assert_eq!(deserialized.args.as_ref().unwrap().len(), 2);
        assert_eq!(
            deserialized.env.as_ref().unwrap().get("DEBUG"),
            Some(&"true".to_string())
        );
    }

    #[test]
    fn stdio_client_new_missing_command_returns_error() {
        let config = McpServerConfig {
            server_type: "stdio".to_string(),
            url: String::new(),
            command: None, // 缺失 command 字段
            args: None,
            env: None,
            enabled: true,
        };
        let result = StdioMcpClient::new(&config);
        assert!(result.is_err());
        assert!(format!("{}", result.unwrap_err()).contains("command"));
    }

    #[test]
    fn stdio_client_new_nonexistent_command_returns_error() {
        let config = McpServerConfig {
            server_type: "stdio".to_string(),
            url: String::new(),
            command: Some("sacode-mcp-nonexistent-command-xyz".to_string()),
            args: None,
            env: None,
            enabled: true,
        };
        let result = StdioMcpClient::new(&config);
        assert!(result.is_err());
    }

    #[test]
    fn add_stdio_persists_config() {
        // 使用临时目录避免污染用户配置
        let temp = std::env::temp_dir().join(format!(
            "sacode-mcp-test-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&temp).unwrap();

        let store = McpConfigStore::new(&temp);
        let env = BTreeMap::from([("KEY".to_string(), "value".to_string())]);
        let args = vec!["--flag".to_string()];

        store
            .add_stdio("test-stdio", "my-server", &args, &env, McpSource::Project)
            .unwrap();

        let loaded = store.get("test-stdio").unwrap();
        assert!(loaded.is_stdio());
        assert_eq!(loaded.command.as_deref(), Some("my-server"));
        assert_eq!(loaded.args.as_ref().unwrap(), &args);
        assert_eq!(
            loaded.env.as_ref().unwrap().get("KEY"),
            Some(&"value".to_string())
        );

        // 清理
        std::fs::remove_dir_all(&temp).ok();
    }

    #[test]
    fn transport_dispatch_uses_stdio_path() {
        // 验证 stdio 类型不会走 HTTP 路径（即使 url 为空也不会尝试 HTTP 请求）
        let stdio_server = McpServerConfig {
            server_type: "stdio".to_string(),
            url: String::new(), // url 为空，若误走 HTTP 会失败
            command: Some("sacode-nonexistent-xyz".to_string()),
            args: None,
            env: None,
            enabled: true,
        };
        // 调用 async 函数会尝试创建 StdioMcpClient，因命令不存在而失败
        // 但不会走 HTTP 路径（HTTP 路径会因 url 为空而不同错误）
        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        let result = rt.block_on(inspect_server(&stdio_server));
        assert!(result.is_err());
        // 错误信息应包含 spawn 相关，而非 HTTP 相关
        let err_msg = format!("{}", result.unwrap_err());
        assert!(err_msg.contains("spawn") || err_msg.contains("failed"));
    }
}
