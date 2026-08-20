# 沙箱审计日志格式

## 概述

SaCode 对所有 `Modify` 级别工具（`fs.write`、`fs.edit`、`fs.patch`、`git.commit` 等）在执行前后自动写入审计日志。日志文件为 **JSON Lines** 格式（每行一个完整 JSON 对象），位于项目 `.sacode/audit.log`。

## 日志位置

```
<project-root>/.sacode/audit.log
```

## 日志阶段

单次工具调用产生两条日志：

| 阶段 | 触发时机 | 用途 |
|------|----------|------|
| `preflight_*` | 执行前 | 记录工具有意调用，以及沙箱拦截结果 |
| `execution` | 执行后 | 记录执行结果（成功/失败/错误） |

## 通用字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `ts` | string | RFC3339 时间戳，如 `2026-08-19T10:00:00Z` |
| `tool` | string | 工具名，如 `fs.write`、`git.commit`、`shell.exec` |
| `phase` | string | 日志阶段（见上表） |
| `status` | string | 状态码（见下） |
| `input` | object | 工具输入参数（仅 `Modify` 级别工具包含） |
| `extra` | object | 额外上下文（可选，见下） |

## 状态码

### preflight 阶段

| 状态码 | 含义 | 说明 |
|--------|------|------|
| `pending` | 预检开始 | 工具即将接受安全检查 |
| `allowed` | 预检通过 | 工具通过安全检查，准备执行 |
| `network_blocked` | 网络访问被拦截 | `shell.exec` 含网络命令时触发 |
| `command_blocked` | 危险命令被拦截 | `rm -rf /`、`format C:` 等危险命令 |
| `path_blocked` | 路径访问被拦截 | 超出沙箱允许范围的路径 |
| `task_spawn_blocked` | 任务派生被拦截 | 不允许的任务启动行为 |

### execution 阶段

| 状态码 | 含义 | 说明 |
|--------|------|------|
| `success` | 执行成功 | `output.success == true` |
| `failure` | 执行失败 | `output.success == false`（工具逻辑失败） |
| `error` | 执行异常 | 工具抛出异常/panic |

## 记录示例

### 预检通过

```json
{"ts":"2026-08-19T10:00:00Z","tool":"fs.write","phase":"preflight_allowed","status":"allowed","input":{"path":"/tmp/test.txt","content":"..."}}
```

### 危险命令拦截

```json
{"ts":"2026-08-19T10:00:00Z","tool":"shell.exec","phase":"preflight_blocked","status":"command_blocked","input":{"command":"rm -rf /"},"extra":{"command":"rm -rf /"}}
```

### 执行成功

```json
{"ts":"2026-08-19T10:00:00Z","tool":"git.commit","phase":"execution","status":"success","input":{"message":"fix bug","paths":["src/main.rs"]},"extra":{"result":{"success":true,"message":"commit abc123","data":{}}}}
```

### 执行失败

```json
{"ts":"2026-08-19T10:00:00Z","tool":"test.run","phase":"execution","status":"failure","input":{"command":"cargo test"},"extra":{"result":{"success":false,"message":"2 tests failed","data":{}}}}
```

### 执行异常

```json
{"ts":"2026-08-19T10:00:00Z","tool":"fs.write","phase":"execution","status":"error","input":{"path":"/readonly/test.txt","content":"test"},"extra":{"error":"Permission denied (os error 13)"}}
```

## 企业 SIEM 接入

### 日志采集

每条记录为独立 JSON 行，可使用标准日志采集工具（Filebeat、Fluentd、Logstash）直接读取：

```yaml
# Filebeat 示例配置
filebeat.inputs:
  - type: log
    enabled: true
    paths:
      - /path/to/project/.sacode/audit.log
    json.keys_under_root: true
    json.overwrite_keys: true
```

### 字段映射

| Elasticsearch / OpenSearch 字段 | 来源 | 说明 |
|--------------------------------|------|------|
| `@timestamp` | `ts` | 事件时间 |
| `event.action` | `phase` | 审计阶段 |
| `event.outcome` | `status` | 执行结果 |
| `tool.name` | `tool` | 工具名 |
| `tool.parameters` | `input` | 工具参数 |
| `tool.extra` | `extra` | 额外上下文 |
| `observer.product` | 固定值 `SaCode` | 产品标识 |
| `observer.vendor` | 固定值 `cherishron` | 厂商标识 |

### 告警规则示例

```yaml
# 危险命令拦截告警
alert:
  - type: command_blocked
    condition: status == "command_blocked"
    severity: high
    action: 通知安全管理员

# 工具执行失败告警
  - type: tool_failure
    condition: phase == "execution" && status == "error"
    severity: medium
    action: 记录异常并通知开发者
```

### Logstash 配置示例

```ruby
input {
  file {
    path => "/path/to/project/.sacode/audit.log"
    codec => json_lines
    start_position => "beginning"
  }
}

filter {
  mutate {
    rename => {
      "ts" => "[@timestamp]"
      "tool" => "[tool][name]"
      "input" => "[tool][parameters]"
    }
  }
  mutate {
    add_field => {
      "[observer][product]" => "SaCode"
      "[observer][vendor]" => "cherishron"
    }
  }
}

output {
  elasticsearch {
    hosts => ["https://localhost:9200"]
    index => "sacode-audit-%{+YYYY.MM.dd}"
  }
}
```

## 补充：events.log 格式

### 概述

SaCode 的事件日志 `.sacode/events.log` 与审计日志类似，采用 JSON Lines 格式，但记录的是**工具执行全生命周期事件**（ToolCallStarted → ToolCallFinished / ToolCallDenied），而非仅 `Modify` 级工具的沙箱拦截。

### 字段定义

| 字段 | 类型 | 说明 |
|------|------|------|
| `type` | string | 事件类型：`tool_call_started` / `tool_call_finished` / `tool_call_denied` |
| `session_id` | string | 会话标识（空字符串表示独立调用） |
| `ts` | string | RFC3339 时间戳 |
| `seq` | integer | 单调递增全局序号（用于回放重建） |
| `tool` | string | 工具名 |
| `input` | object | 工具输入参数 |
| `output` | object | 工具输出结果（仅 `tool_call_finished`） |
| `success` | boolean | 是否成功（仅 `tool_call_finished`） |
| `error` | string | 错误信息（仅失败时） |
| `reason` | string | 拒绝原因（仅 `tool_call_denied`） |

### seq 字段说明（v1.1）

- `seq` 自 v1.1.0 起**落盘写入**（`#[serde(default)]` 反序列化）。
- **旧日志兼容**：v1.1.0 之前写入的 events.log 无 `seq` 字段，回放时反序列化得
  `seq=0`，`replay_disk_after` 按**行序**（append-only 保证行序即序号序）重分配为
  `1..=N`，保证旧日志可完整回放。
- 磁盘回放与内存缓冲的 `seq` 一致：同一事件在内存与磁盘中序号相同（连续性保证）。

### 示例

```json
{"type":"tool_call_started","session_id":"","ts":"2026-08-19T10:00:00Z","seq":1,"tool":"fs.read","input":{"path":"src/main.rs"}}
{"type":"tool_call_finished","session_id":"","ts":"2026-08-19T10:00:00Z","seq":2,"tool":"fs.read","input":{"path":"src/main.rs"},"output":{"content":"..."},"success":true}
{"type":"tool_call_denied","session_id":"","ts":"2026-08-19T10:00:00Z","seq":3,"tool":"shell.exec","input":{"command":"rm -rf /"},"reason":"dangerous command blocked"}
```

### 投影与淘汰

- 进程内内存缓冲默认 4096 条（跨会话共享），满后最旧事件被**环状淘汰**。
- `project_session_state()`（内存投影）在淘汰发生时结果静默偏低，`truncated` 字段
  置 `true` 显式暴露该状态。
- `project_session_state_complete()`（磁盘全量 + 内存增量合并投影）不受缓冲淘汰
  影响，`truncated` 恒为 `false`，用于需要全量精确统计的场合（如会话结束汇总）。

### SIEM 接入

events.log 同样可通过 Filebeat/Logstash 采集，索引建议为 `sacode-events-%{+YYYY.MM.dd}`，便于与 audit.log 关联分析。