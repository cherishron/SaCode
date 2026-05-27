# SaCode 新工具扩展方案

## 背景

对比 opencode 工具列表与 sacode 现有工具，发现缺少以下核心工具能力。本方案规划新增 6 个工具以提升 sacode 的实用性。

## 新增工具列表

| 工具名 | 分类 | 优先级 | 描述 |
|--------|------|--------|------|
| `fs.edit` | 文件操作 | P0 | 精确编辑文件（字符串替换） |
| `fs.read_multi` | 文件操作 | P1 | 批量读取多个文件 |
| `fs.list` | 文件操作 | P1 | 列出目录内容 |
| `interaction.ask` | 交互 | P0 | 向用户提问并等待回答 |
| `media.read` | 媒体 | P2 | 读取图片/PDF 等非文本文件 |
| `task.spawn` | 任务 | P1 | 启动子 agent 并行处理 |

---

## 工具详细设计

### 1. fs.edit (P0)

**目的**：精确编辑文件，避免整体覆盖导致丢失上下文。

**Input Schema**：
```json
{
  "type": "object",
  "properties": {
    "path": { "type": "string", "description": "文件路径" },
    "old_string": { "type": "string", "description": "要替换的原始字符串" },
    "new_string": { "type": "string", "description": "替换后的新字符串" },
    "replace_all": { "type": "boolean", "default": false, "description": "是否替换所有匹配" }
  },
  "required": ["path", "old_string", "new_string"]
}
```

**Output Schema**：
```json
{
  "type": "object",
  "properties": {
    "success": { "type": "boolean" },
    "replacements": { "type": "integer", "description": "替换次数" },
    "path": { "type": "string" }
  }
}
```

**实现要点**：
- 读取文件全文，查找 `old_string`
- 若未找到，返回失败并提示用户
- 若找到多次且 `replace_all=false`，返回失败要求用户提供更多上下文
- 执行替换后写入文件

**文件位置**：`runtime/src/tools/fs/edit.rs`（重构现有占位符）

---

### 2. fs.read_multi (P1)

**目的**：批量读取多个文件，减少工具调用次数，提升效率。

**Input Schema**：
```json
{
  "type": "object",
  "properties": {
    "paths": { 
      "type": "array", 
      "items": { "type": "string" },
      "description": "文件路径列表" 
    },
    "limit_per_file": { 
      "type": "integer", 
      "default": 200,
      "description": "每个文件的最大读取行数" 
    }
  },
  "required": ["paths"]
}
```

**Output Schema**：
```json
{
  "type": "object",
  "properties": {
    "files": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "path": { "type": "string" },
          "content": { "type": "string" },
          "lines": { "type": "integer" },
          "error": { "type": "string" }
        }
      }
    },
    "total_files": { "type": "integer" },
    "success_count": { "type": "integer" },
    "failed_count": { "type": "integer" }
  }
}
```

**实现要点**：
- 并行读取多个文件（使用 `rayon` 或 `tokio::join!`）
- 每个文件独立处理，失败不影响其他文件
- 返回聚合结果

**文件位置**：`runtime/src/tools/fs/read_multi.rs`

---

### 3. fs.list (P1)

**目的**：列出目录内容，便于浏览项目结构。

**Input Schema**：
```json
{
  "type": "object",
  "properties": {
    "path": { 
      "type": "string", 
      "default": ".",
      "description": "目录路径" 
    },
    "recursive": { 
      "type": "boolean", 
      "default": false,
      "description": "是否递归列出" 
    },
    "include_hidden": { 
      "type": "boolean", 
      "default": false,
      "description": "是否包含隐藏文件" 
    }
  },
  "required": []
}
```

**Output Schema**：
```json
{
  "type": "object",
  "properties": {
    "path": { "type": "string" },
    "entries": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "name": { "type": "string" },
          "type": { "type": "string", "enum": ["file", "directory"] },
          "size": { "type": "integer" }
        }
      }
    },
    "total_entries": { "type": "integer" }
  }
}
```

**实现要点**：
- 使用 `std::fs::read_dir`
- 递归模式使用 walkdir crate（如已引入）或手动递归
- 按类型分组输出

**文件位置**：`runtime/src/tools/fs/list.rs`

---

### 4. interaction.ask (P0)

**目的**：向用户提问，实现多轮交互确认。

**Input Schema**：
```json
{
  "type": "object",
  "properties": {
    "question": { 
      "type": "string", 
      "description": "问题内容" 
    },
    "options": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "label": { "type": "string" },
          "description": { "type": "string" }
        }
      },
      "description": "可选答案列表（如提供则用户选择，否则自由输入）"
    },
    "allow_multiple": { 
      "type": "boolean", 
      "default": false,
      "description": "是否允许多选" 
    }
  },
  "required": ["question"]
}
```

**Output Schema**：
```json
{
  "type": "object",
  "properties": {
    "answer": { "type": "string" },
    "answers": { "type": "array", "items": { "type": "string" } },
    "cancelled": { "type": "boolean" }
  }
}
```

**实现要点**：
- 在 REPL/TUI 模式下直接等待用户输入
- 在非交互模式（CLI --json）返回特殊状态码，暂停执行等待外部输入
- 需要在 runner 层面处理异步等待机制

**特殊考虑**：
- 此工具涉及交互流程，需要修改 `runner.rs` 和 `tui.rs`
- 可能需要新增 `InputMode::ToolAsk` 状态

**文件位置**：`runtime/src/tools/interaction/ask.rs`

---

### 5. media.read (P2)

**目的**：读取图片、PDF 等非文本文件，支持视觉分析场景。

**Input Schema**：
```json
{
  "type": "object",
  "properties": {
    "path": { "type": "string", "description": "文件路径" },
    "mode": { 
      "type": "string", 
      "enum": ["base64", "ocr", "describe"],
      "default": "base64",
      "description": "读取模式：base64编码、OCR文字提取、内容描述" 
    }
  },
  "required": ["path"]
}
```

**Output Schema**：
```json
{
  "type": "object",
  "properties": {
    "path": { "type": "string" },
    "mime_type": { "type": "string" },
    "data": { "type": "string", "description": "base64 数据或文本内容" },
    "size_bytes": { "type": "integer" }
  }
}
```

**实现要点**：
- 基础实现：读取文件并返回 base64 编码
- OCR 模式：可选集成外部 OCR 服务（通过 MCP 或调用第三方 API）
- 支持常见格式：png, jpg, gif, pdf

**文件位置**：`runtime/src/tools/media/read.rs`

---

### 6. task.spawn (P1)

**目的**：启动子 agent 并行处理任务，提升复杂任务效率。

**Input Schema**：
```json
{
  "type": "object",
  "properties": {
    "prompt": { "type": "string", "description": "子任务描述" },
    "subagent_type": {
      "type": "string",
      "enum": ["explore", "general"],
      "default": "general",
      "description": "子 agent 类型"
    },
    "context": {
      "type": "string",
      "description": "传递给子 agent 的上下文信息"
    }
  },
  "required": ["prompt"]
}
```

**Output Schema**：
```json
{
  "type": "object",
  "properties": {
    "task_id": { "type": "string" },
    "status": { "type": "string", "enum": ["pending", "running", "completed", "failed"] },
    "result": { "type": "string" },
    "duration_ms": { "type": "integer" }
  }
}
```

**实现要点**：
- 利用现有的 `Supervisor` 和 `Task` 模块
- 子 agent 独立执行，不共享当前上下文
- 返回执行结果摘要

**特殊考虑**：
- 需要修改 `kernel` 层的 `Supervisor` 支持嵌套执行
- 需要考虑并发限制（避免资源耗尽）

**文件位置**：`runtime/src/tools/task/spawn.rs`

---

## 实现步骤

### Phase 1：文件操作工具（Week 1）

1. **重构 fs.edit**
   - 删除现有占位符
   - 实现完整编辑逻辑
   - 注册到 ToolRegistry

2. **新增 fs.read_multi**
   - 创建新文件
   - 实现并行读取
   - 注册到 ToolRegistry

3. **新增 fs.list**
   - 创建新文件
   - 实现目录遍历
   - 注册到 ToolRegistry

### Phase 2：交互工具（Week 2）

4. **新增 interaction.ask**
   - 创建 `runtime/src/tools/interaction/` 目录
   - 实现基础逻辑
   - 修改 `tui.rs` 支持交互等待
   - 修改 `runner.rs` 处理暂停/恢复

### Phase 3：高级工具（Week 3-4）

5. **新增 media.read**
   - 创建 `runtime/src/tools/media/` 目录
   - 实现基础 base64 模式
   - OCR 可选延后实现

6. **新增 task.spawn**
   - 创建 `runtime/src/tools/task/` 目录
   - 基于 Supervisor 实现子任务
   - 添加并发控制

---

## 目录结构变更

```
runtime/src/tools/
├── mod.rs           # 修改：注册新工具
├── spec.rs          # 保持不变
├── fs/
│   ├── mod.rs       # 修改：导出新模块
│   ├── access.rs    # 保持不变
│   ├── edit.rs      # 重构：完整实现
│   ├── list.rs      # 新增
│   ├── read.rs      # 保持不变
│   ├── read_multi.rs # 新增
│   ├── search.rs    # 保持不变
│   └── write.rs     # 保持不变
├── interaction/     # 新增目录
│   ├── mod.rs       # 新增
│   └── ask.rs       # 新增
├── media/           # 新增目录
│   ├── mod.rs       # 新增
│   └── read.rs      # 新增
├── task/            # 新增目录
│   ├── mod.rs       # 新增
│   └── spawn.rs     # 新增
├── git/             # 保持不变
├── shell/           # 保持不变
├── web/             # 保持不变
└── code/            # 删除（占位符无用）
```

---

## ToolRegistry 变更

`runtime/src/tools/mod.rs` 新增注册：

```rust
impl ToolRegistry {
    pub fn builtin() -> Self {
        let mut tools = HashMap::new();
        // 原有工具
        tools.insert("fs.read".to_string(), fs::read::spec());
        tools.insert("fs.search".to_string(), fs::search::spec());
        tools.insert("fs.write".to_string(), fs::write::spec());
        tools.insert("git.diff".to_string(), git::diff::spec());
        tools.insert("shell.exec".to_string(), shell::exec::spec());
        tools.insert("web.fetch".to_string(), web::fetch::spec());
        tools.insert("web.search".to_string(), web::search::spec());
        // 新增工具
        tools.insert("fs.edit".to_string(), fs::edit::spec());
        tools.insert("fs.read_multi".to_string(), fs::read_multi::spec());
        tools.insert("fs.list".to_string(), fs::list::spec());
        tools.insert("interaction.ask".to_string(), interaction::ask::spec());
        tools.insert("media.read".to_string(), media::read::spec());
        tools.insert("task.spawn".to_string(), task::spawn::spec());
        Self { tools }
    }

    pub fn execute(&self, name: &str, input: serde_json::Value) -> anyhow::Result<ToolOutput> {
        match name {
            // 原有
            "fs.read" => fs::read::execute(input),
            "fs.search" => fs::search::execute(input),
            "fs.write" => fs::write::execute(input),
            "git.diff" => git::diff::execute(input),
            "shell.exec" => shell::exec::execute(input),
            "web.fetch" => web::fetch::execute(input),
            "web.search" => web::search::execute(input),
            // 新增
            "fs.edit" => fs::edit::execute(input),
            "fs.read_multi" => fs::read_multi::execute(input),
            "fs.list" => fs::list::execute(input),
            "interaction.ask" => interaction::ask::execute(input),
            "media.read" => media::read::execute(input),
            "task.spawn" => task::spawn::execute(input),
            _ => anyhow::bail!("unknown tool: {}", name),
        }
    }
}
```

---

## 测试策略

每个新工具需编写单元测试：

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::tools::ToolRegistry;

    #[test]
    fn test_fs_edit_replace_single() {
        // 创建临时文件，测试单次替换
    }

    #[test]
    fn test_fs_edit_not_found() {
        // 测试找不到目标字符串的情况
    }

    #[test]
    fn test_fs_read_multi_parallel() {
        // 测试批量读取
    }

    // ... 其他测试
}
```

---

## 风险与依赖

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| interaction.ask 需要修改 TUI 流程 | 高 | 先实现基础版本，交互增强分阶段 |
| task.spawn 并发控制复杂 | 中 | 添加并发上限（默认 3） |
| media.read OCR 需要外部依赖 | 低 | Phase 3 可选实现，base64 先行 |

---

## 时间估算

| Phase | 内容 | 工时 |
|-------|------|------|
| Phase 1 | fs.edit, fs.read_multi, fs.list | 3-5 天 |
| Phase 2 | interaction.ask + TUI 改造 | 3-5 天 |
| Phase 3 | media.read, task.spawn | 5-7 天 |
| 测试与文档 | 单元测试、API 文档更新 | 2-3 天 |
| **总计** | | **13-20 天** |

---

## 后续优化（可选）

1. **fs.glob** - 更灵活的文件匹配（如 `**/*.rs`）
2. **fs.watch** - 文件变更监听
3. **git.status** - Git 状态查询
4. **git.commit** - Git 提交（重构现有占位符）
5. **code.ast** - AST 分析（重构现有占位符）
6. **code.symbol** - 符号索引（重构现有占位符）

---

## 附录：现有占位符清理

以下文件为空占位符，建议在本方案执行时删除：

- `runtime/src/tools/code/ast.rs`
- `runtime/src/tools/code/symbol.rs`
- `runtime/src/tools/code/mod.rs`
- `runtime/src/tools/shell/sandbox.rs`
- `runtime/src/tools/git/commit.rs`

删除 `code/` 目录后，需更新 `runtime/src/tools/mod.rs` 移除 `pub mod code;`。