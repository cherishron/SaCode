# SaCode 快速上手

本文档面向第一次接触 SaCode 的开发者，目标是帮助你在几分钟内完成安装、配置和第一次任务执行。

## 1. 安装

### 通过 npm 安装（推荐）

```bash
npm install -g @cherishron/sacode
sacode --version
```

### 验证安装

安装成功后，你应该能看到版本号输出。如果遇到以下错误：

#### 错误 1：`command not found: sacode`

**原因**：npm 全局安装路径不在系统 PATH 中

**解决步骤**：
1. 找到 npm 全局安装路径：
   ```bash
   npm config get prefix
   ```
2. 检查该路径是否在系统 PATH 中：
   ```bash
   echo $PATH | grep $(npm config get prefix)
   ```
3. 如果不在，添加到 PATH：
   ```bash
   export PATH=$(npm config get prefix)/bin:$PATH
   echo 'export PATH=$(npm config get prefix)/bin:$PATH' >> ~/.bashrc
   source ~/.bashrc
   ```

#### 错误 2：`EACCES: permission denied`

**原因**：权限不足

**解决步骤**：
```bash
sudo npm install -g @cherishron/sacode
```

或者修复 npm 权限：
```bash
mkdir ~/.npm-global
npm config set prefix '~/.npm-global'
export PATH=~/.npm-global/bin:$PATH
echo 'export PATH=~/.npm-global/bin:$PATH' >> ~/.bashrc
source ~/.bashrc
npm install -g @cherishron/sacode
```

#### 错误 3：网络连接问题

**原因**：npm registry 连接失败

**解决步骤**：
```bash
# 使用淘宝镜像
npm config set registry https://registry.npmmirror.com
npm install -g @cherishron/sacode
```

### 手动安装

如果 npm 安装失败，可以从 GitHub Releases 手动下载二进制文件：

1. 访问 [SaCode Releases](https://github.com/cherishron/SaCode/releases)
2. 下载对应平台的二进制文件
3. 解压并移动到系统 PATH 中的目录：
   ```bash
   tar -xzf sacode-linux-x64.tar.gz
   sudo mv sacode /usr/local/bin/
   sacode --version
   ```

### 当前支持平台

- Linux x64
- Windows x64

**注意**：macOS 支持计划中，详见 [产品路线图](../product/roadmap.md)

## 2. 启动方式

### 默认 TUI

```bash
sacode
```

### REPL

```bash
sacode repl
```

### 单次任务

```bash
sacode "分析当前仓库的架构边界"
```

## 3. 配置 Provider

### 方式一：交互式配置

在 TUI 或 REPL 中输入：

```text
/login
```

**详细步骤**：
1. 输入 `/login` 命令
2. 系统提示输入 Base URL
3. 输入你的 API 服务的 Base URL（见下方示例）
4. 系统提示输入 API Key
5. 输入你的 API Key
6. 系统提示输入 Provider 名称（可选）
7. 按回车确认，系统会保存配置到 `~/.sacode/provider.json`

**示例 Base URL**：

- OpenAI：`https://api.openai.com/v1`
- DeepSeek：`https://api.deepseek.com/v1`
- Ollama（本地）：`http://127.0.0.1:11434/v1`
- Azure OpenAI：`https://<resource-name>.openai.azure.com/openai/deployments/<deployment-id>`

**常见错误处理**：

#### 错误 1：`Failed to connect to provider`

**原因**：Base URL 不正确或网络不通

**解决步骤**：
1. 检查 Base URL 是否正确：
   ```bash
   curl -I https://api.openai.com/v1
   ```
2. 检查网络连接：
   ```bash
   ping api.openai.com
   ```
3. 如果使用代理，配置代理：
   ```bash
   export HTTPS_PROXY=http://127.0.0.1:7890
   export HTTP_PROXY=http://127.0.0.1:7890
   ```

#### 错误 2：`Authentication failed`

**原因**：API Key 不正确或已过期

**解决步骤**：
1. 确认 API Key 是否正确
2. 检查 API Key 是否过期
3. 重新配置：
   ```text
   /login
   ```
   输入相同的 Provider 名称会覆盖旧配置

### 方式二：快速接入预设 Provider

```text
/connect
```

**详细步骤**：
1. 输入 `/connect` 命令
2. 系统显示预设 Provider 列表：
   ```
   Available providers:
   1. OpenAI (https://api.openai.com/v1)
   2. DeepSeek (https://api.deepseek.com/v1)
   3. Ollama (http://127.0.0.1:11434/v1)
   ```
3. 输入对应的数字或名称
4. 输入 API Key
5. 系统自动配置并测试连接

### 方式三：直接编辑配置文件

如果你熟悉 JSON 格式，可以直接编辑配置文件：

**用户级配置**：`~/.sacode/provider.json`
**项目级配置**：`<workspace>/.sacode/provider.json`

**配置格式**：
```json
{
  "providers": [
    {
      "name": "openai",
      "base_url": "https://api.openai.com/v1",
      "api_key": "sk-xxxxxxxxxxxxxxxxxxxxxxxx",
      "models": ["gpt-4", "gpt-3.5-turbo"],
      "is_default": true
    }
  ],
  "default_model": "gpt-4"
}
```

**编辑后生效**：
- 用户级配置：重启 SaCode 或输入 `/providers reload`
- 项目级配置：在项目目录下重启 SaCode

### 验证配置

配置完成后，验证是否正常：

```text
/providers
```

你应该能看到刚才配置的 provider 信息。如果有错误，会显示具体的错误消息。

## 4. 选择模型

### 查看可用模型

```text
/models
```

**详细步骤**：
1. 输入 `/models` 命令
2. 系统会调用所有已配置 provider 的模型列表接口
3. 显示可用模型列表，格式如下：
   ```
   Provider: openai
   Available models:
   1. gpt-4
   2. gpt-4-turbo
   3. gpt-3.5-turbo
   4. gpt-4o

   Provider: deepseek
   Available models:
   5. deepseek-chat
   6. deepseek-coder
   ```
4. 输入对应的数字选择模型
5. 系统会：
   - 设置该模型为当前默认模型
   - 切换到对应的 provider

### 手动指定模型

如果知道模型名称，可以直接指定：

```text
/models gpt-4
```

或者在命令行中指定：

```bash
sacode "分析代码" --model gpt-4
```

### 常见错误处理

#### 错误 1：`Failed to fetch models`

**原因**：无法获取模型列表

**解决步骤**：
1. 检查 provider 配置是否正确：
   ```text
   /providers
   ```
2. 手动测试 API 连接：
   ```bash
   curl https://api.openai.com/v1/models \
     -H "Authorization: Bearer $OPENAI_API_KEY"
   ```
3. 如果是本地 provider（如 Ollama），确认服务已启动：
   ```bash
   curl http://127.0.0.1:11434/api/tags
   ```

#### 错误 2：`Model not found`

**原因**：指定的模型不存在

**解决步骤**：
1. 重新查看可用模型列表：
   ```text
   /models
   ```
2. 确认模型名称正确（区分大小写）
3. 检查 API Key 是否有访问该模型的权限

#### 错误 3：`Rate limit exceeded`

**原因**：API 调用频率超限

**解决步骤**：
1. 检查 API Key 的配额限制
2. 等待一段时间后重试
3. 考虑升级 API 计划
4. 或切换到其他 provider

### 模型选择建议

根据任务类型选择合适的模型：

**代码分析、重构、设计**：
- 推荐：`gpt-4`、`gpt-4-turbo`、`deepseek-coder`
- 原因：更强的代码理解能力

**日常问答、文档生成**：
- 推荐：`gpt-3.5-turbo`、`deepseek-chat`
- 原因：响应速度快，成本较低

**大型任务、复杂推理**：
- 推荐：`gpt-4`、`gpt-4o`
- 原因：最强的推理能力

**本地开发、隐私敏感**：
- 推荐：Ollama 本地模型
- 原因：数据不离开本地机器

## 5. 执行模式

### `plan` 模式 - 规划优先

**用途**：适合设计、审查、拆任务，不实际修改代码

**特点**：
- 只做分析和规划，不执行修改操作
- 适合不确定的任务，先看方案
- 可以快速了解任务范围和影响

**示例场景**：

#### 场景 1：设计新功能
```bash
sacode "设计一套缓存失效策略，支持 TTL 和手动清理" --mode plan
```

**输出内容**：
- 任务拆解步骤
- 需要修改的文件列表
- 潜在的风险点
- 建议的验证顺序
- 实现方案选项

#### 场景 2：代码审查
```bash
sacode "审查当前分支的改动，评估是否可以合并" --mode plan
```

**输出内容**：
- 改动摘要
- 代码质量评估
- 潜在问题点
- 合并建议

#### 场景 3：性能优化建议
```bash
sacode "分析这个仓库的性能瓶颈，给出优化建议" --mode plan
```

**输出内容**：
- 性能瓶颈分析
- 优化方案
- 预期收益
- 实施难度评估

### `build` 模式 - 受控修改

**用途**：适合日常改代码任务，修改类动作会请求审批

**特点**：
- 执行实际代码修改
- 每个修改动作都会请求用户确认
- 适合中等确定性的任务
- 保留审批节点，确保安全

**示例场景**：

#### 场景 1：修复 Bug
```bash
sacode "修复 TUI 中 /models 选择后 provider 不同步的问题" --mode build
```

**执行流程**：
1. 分析问题，定位到相关代码
2. 提出修复方案
3. 询问是否执行修改
4. 执行修改并运行测试
5. 请求最终确认
6. 生成提交说明

#### 场景 2：重构代码
```bash
sacode "重构 runtime/src/tools/code/symbol.rs 中的缓存逻辑" --mode build
```

**执行流程**：
1. 分析现有代码
2. 提出重构方案
3. 逐个修改文件，每次请求确认
4. 运行相关测试
5. 确认无误后完成

#### 场景 3：添加新功能
```bash
sacode "为 /memory 命令添加删除功能" --mode build
```

**执行流程**：
1. 分析现有命令结构
2. 设计删除功能的接口
3. 修改相关代码
4. 添加测试
5. 验证功能正常

**审批策略**：
- 默认：每个修改动作都需要确认
- 快速模式：使用 `--approve` 跳过部分确认
- 拒绝模式：使用 `--deny` 拒绝所有修改

### `yolo` 模式 - 自动执行

**用途**：适合明确、低风险、可重复任务

**特点**：
- 自动执行，无需确认
- 适合高确定性任务
- 适合批处理操作
- **注意**：确保任务范围明确，避免意外修改

**示例场景**：

#### 场景 1：批量格式化
```bash
sacode "批量格式化这个仓库的所有 Rust 代码" --mode yolo
```

**执行流程**：
1. 扫描所有 Rust 文件
2. 自动格式化每个文件
3. 运行格式化检查
4. 生成总结报告

#### 场景 2：文档标准化
```bash
sacode "批量整理 docs 目录下的 Markdown 文档标题层级" --mode yolo
```

**执行流程**：
1. 扫描所有 Markdown 文件
2. 标准化标题层级
3. 修正格式问题
4. 生成修改报告

#### 场景 3：清理无用代码
```bash
sacode "删除所有注释掉的代码块" --mode yolo
```

**执行流程**：
1. 扫描代码文件
2. 识别注释掉的代码
3. 删除注释代码
4. 运行测试验证

**安全建议**：
- 使用前先在 `plan` 模式下查看影响范围
- 对于重要项目，先在分支上测试
- 考虑使用 `git stash` 保存当前状态

### 模式切换

**在 TUI 中切换**：
- 快捷键：`Ctrl+M`
- 会在 `plan`、`build`、`yolo` 之间循环切换
- 当前模式会在界面底部显示

**在命令行中指定**：
```bash
sacode "任务描述" --mode <plan|build|yolo>
```

### 模式选择决策树

```
是否需要修改代码？
├─ 否 → 使用 plan 模式
└─ 是 → 是否确定修改范围和影响？
    ├─ 是 → 是否需要逐个确认？
    │   ├─ 是 → 使用 build 模式
    │   └─ 否 → 使用 yolo 模式
    └─ 否 → 使用 plan 模式先规划
```

## 6. TUI 常用命令

### 快捷键详解

#### `Ctrl+Q` - 退出程序

**功能**：立即退出 TUI

**使用场景**：
- 完成所有任务，准备退出
- 遇到无法解决的错误，需要重启
- 误操作需要强制退出

**注意**：退出时会自动保存当前会话状态到 `.sacode/session.json`

#### `Esc` - 清空输入或取消操作

**功能**：
- 清空当前输入框内容
- 取消正在执行的任务（如果支持）
- 退出当前交互模式

**使用场景**：
- 输入错误，需要重新输入
- 不想继续当前任务
- 想要快速返回主输入状态

#### `Ctrl+T` - 开启/关闭思考功能

**功能**：控制是否显示模型推理过程

**开启状态**：
- 显示完整的推理过程
- 适合学习和调试
- 会增加输出长度

**关闭状态**：
- 只显示最终结果
- 适合快速获取答案
- 输出简洁

**切换方式**：
- 按一次：开启
- 再按一次：关闭
- 当前状态会在界面显示

#### `Ctrl+M` - 切换执行模式

**功能**：在 `plan`、`build`、`yolo` 模式间切换

**切换顺序**：
```
plan → build → yolo → plan → ...
```

**使用场景**：
- 根据任务性质调整执行策略
- 不同任务需要不同模式时快速切换
- 根据上次执行结果调整模式

### 斜杠命令详解

#### `/login` - 配置 Provider

**详细用法**：
```text
/login
```

**交互流程**：
1. 提示输入 Base URL
2. 提示输入 API Key
3. 提示输入 Provider 名称（可选）
4. 自动保存配置

**示例**：
```text
/login
Base URL: https://api.openai.com/v1
API Key: sk-xxxxxxxxxxxxxxxxxxxxxxxx
Provider name (optional): my-openai
```

#### `/connect` - 快速接入预设 Provider

**详细用法**：
```text
/connect
```

**支持的预设**：
- OpenAI
- DeepSeek
- Ollama
- Azure OpenAI

**优势**：
- 自动配置，无需手动输入 Base URL
- 自动测试连接
- 支持多种常见 Provider

#### `/providers` - 管理 Provider

**查看所有 Provider**：
```text
/providers
```

**查看特定 Provider**：
```text
/providers show openai
```

**重命名 Provider**：
```text
/provider-rename old-name new-name
```

**删除 Provider**：
```text
/provider-remove provider-name
```

**重新加载配置**：
```text
/providers reload
```

#### `/models` - 管理模型

**查看所有可用模型**：
```text
/models
```

**选择特定模型**：
```text
/models gpt-4
```

**刷新模型列表**：
```text
/models refresh
```

**查看当前模型**：
```text
/models show
```

#### `/memory` - 项目记忆管理

**查看所有记忆**：
```text
/memory
```

**查看记忆摘要**：
```text
/memory summary
```

**搜索记忆**：
```text
/memory search 缓存
```

**添加新记忆**：
```text
/memory append 发布前按 cargo test -> cargo build -> node scripts/check-release.js 顺序验证 --type workflow
```

**支持的类型**：
- `memory`：通用记忆
- `preference`：用户偏好
- `workflow`：工作流程
- `decision`：重要决策

**添加全局记忆**：
```text
/memory append 默认回答保持简洁 --type preference --global
```

#### `/wiki` - 知识库管理

**查看知识库状态**：
```text
/wiki
```

**刷新知识库**：
```text
/wiki refresh
```

**查看知识库路径**：
```text
/wiki path
```

**知识库层级**：
- 用户级：`~/.sacode/wiki/`
- 项目级：`.sacode/wiki/`
- 会话级：临时知识

#### `/loop` - 循环执行

**基本用法**：
```text
/loop 完成这个功能的实现
```

**循环特点**：
- 自动判断任务完成状态
- 达到熔断条件时停止
- 记录每次执行的进度
- 支持中途取消

**熔断条件**：
- 最大迭代次数（默认 10 次）
- 连续失败次数（默认 3 次）
- 用户手动取消

**取消循环**：
```text
/cancel
```

#### `/insight` - 项目洞察

**查看项目洞察**：
```text
/insight
```

**洞察内容**：
- 项目结构分析
- 关键模块识别
- 风险点提示
- 改进建议

**使用场景**：
- 新项目接入
- 定期项目健康检查
- 代码质量评估

### 命令分组详解

#### Skills 管理

**列出所有 Skills**：
```text
/skills list
```

**查看 Skill 详情**：
```text
/skills show skill-name
```

**运行 Skill**：
```text
/skills run skill-name [参数...]
```

**添加新 Skill**：
```text
/skills add skill-name "描述" "提示词模板"
```

**删除 Skill**：
```text
/skills remove skill-name
```

#### MCP 管理

**列出所有 MCP**：
```text
/mcps list
```

**查看 MCP 详情**：
```text
/mcps show mcp-name
```

**启用 MCP**：
```text
/mcp enable mcp-name
```

**禁用 MCP**：
```text
/mcp disable mcp-name
```

**删除 MCP**：
```text
/mcp remove mcp-name
```

#### Todo 管理

**查看待办事项**：
```text
/todo show
```

**确认 Todo**：
```text
/todo confirm
```

**清空 Todo**：
```text
/todo clear
```

#### 任务管理

**列出所有任务**：
```text
/tasks list
```

**添加新任务**：
```text
/tasks add "任务描述"
```

**查看任务详情**：
```text
/tasks show task-id
```

**开始任务**：
```text
/tasks start task-id
```

**完成任务**：
```text
/tasks done task-id
```

**取消任务**：
```text
/tasks cancel task-id
```

**导出任务**：
```text
/tasks export
```

**清空所有任务**：
```text
/tasks clear
```

## 7. 常见工作流

### 7.1 代码理解工作流

#### 目标
快速理解陌生代码仓库的结构、入口和核心逻辑

#### 完整步骤

**步骤 1：启动 SaCode**
```bash
sacode
```

**步骤 2：配置 Provider**
```text
/login
Base URL: https://api.openai.com/v1
API Key: sk-xxxxxxxxxxxxxxxxxxxxxxxx
/models
# 选择 gpt-4 或其他适合代码分析的模型
```

**步骤 3：初始分析**
```text
解释这个仓库的主要分层、真实入口和高风险模块
```

**步骤 4：深入理解**
```text
先读 Cargo.toml、README、CI workflow 和主入口，再解释仓库如何运行
```

**步骤 5：聚焦特定模块**
```text
详细说明 kernel、runtime、interfaces/cli 的职责边界和依赖关系
```

**步骤 6：识别关键路径**
```text
找出这个仓库最重要的代码路径和最容易出问题的地方
```

**步骤 7：沉淀知识**
```text
/memory append 这个仓库的入口在 interfaces/cli/src/cmd/mod.rs，核心逻辑在 runtime/src/agents/ --type memory
```

#### 预期输出
- 仓库整体架构图
- 主要模块职责说明
- 关键代码路径
- 潜在风险点
- 开发验证顺序

### 7.2 问题定位工作流

#### 目标
快速定位问题根源，给出最短修复路径

#### 完整步骤

**步骤 1：描述问题**
```text
定位当前仓库里最可能导致测试失败或回归的问题
```

**步骤 2：结合当前改动**
```bash
git diff | sacode "根据这份改动判断最可能的回归风险和验证顺序"
```

**步骤 3：获取验证建议**
```text
针对这个仓库给我一个最省时的验证顺序，先跑最值钱的检查
```

**步骤 4：逐个验证**
```text
只看 runtime 相关改动，帮我判断先跑哪些 sacode-runtime 测试
```

**步骤 5：定位根因**
```text
根据测试失败信息，分析最可能的代码问题位置
```

**步骤 6：生成修复方案**
```text
给出最小可行修复路径，尽量少改文件，避免引入新问题
```

#### 预期输出
- 最可能的问题位置
- 验证顺序建议
- 修复方案
- 风险评估

### 7.3 代码修改工作流

#### 目标
安全、高效地修改代码，确保质量

#### 完整步骤

**步骤 1：规划阶段（plan 模式）**
```text
设计一套改进 TUI 任务状态流转的方案 --mode plan
```

**查看规划结果**
- 任务拆解
- 影响范围
- 验证建议

**步骤 2：执行阶段（build 模式）**
```bash
sacode "修复 TUI 中 /models 选择后 provider 不同步的问题" --mode build
```

**执行过程中的决策点**
- 询问是否修改文件 A：确认/拒绝
- 询问是否运行测试：确认/拒绝
- 询问是否提交：确认/拒绝

**步骤 3：验证阶段**
```text
根据修改内容，告诉我需要运行哪些测试验证
```

**步骤 4：总结阶段**
```bash
git diff | sacode "总结这次改动的核心变化、风险点和建议测试"
```

**步骤 5：提交阶段**
```bash
git diff | sacode "根据改动生成一条简洁准确的 commit message"
```

#### 预期输出
- 详细的修改方案
- 受控的代码修改
- 完整的验证步骤
- 规范的提交说明

### 7.4 提交前检查工作流

#### 目标
确保提交前所有必要的检查都已完成

#### 完整步骤

**步骤 1：运行诊断**
```text
/doctor
```

**检查项目**：
- Provider 配置
- 默认模型
- 项目级 wiki
- 插件状态

**步骤 2：查看改动摘要**
```bash
git diff | sacode "总结这次改动的核心变化"
```

**步骤 3：获取验证建议**
```text
根据这个仓库的 CI 规则，给我最合理的本地验证顺序
```

**步骤 4：执行验证**
```bash
# 按建议的顺序执行验证
cargo test --workspace
cargo build --release
```

**步骤 5：风险检查**
```bash
git diff | sacode "指出这次改动可能的风险点"
```

**步骤 6：生成提交说明**
```bash
git diff | sacode "根据改动生成一条简洁准确的 commit message"
```

**步骤 7：最终确认**
```bash
git status
git add .
git commit -m "生成的提交说明"
```

#### 预期输出
- 完整的验证清单
- 风险评估报告
- 规范的提交说明
- 清晰的提交记录

### 7.5 项目初始化工作流

#### 目标
为新项目建立完整的 SaCode 协作环境

#### 完整步骤

**步骤 1：轻量初始化**
```bash
cd /path/to/your/project
sacode init
```

**生成内容**：
- 根目录 `AGENTS.md`
- `.sacode/` 基础文件
- 基本配置模板

**步骤 2：深度初始化（可选）**
```bash
sacode init-deep
```

**额外生成内容**：
- 目录级 AGENTS.md
- 工作流模板
- MCP 配置模板
- 更完整的约束说明

**步骤 3：配置 Provider**
```text
/login
# 配置你的 Provider
```

**步骤 4：配置项目记忆**
```text
/memory append "这个项目使用 TypeScript + React" --type memory
/memory append "发布前先运行 npm test，然后 npm run build" --type workflow
```

**步骤 5：测试功能**
```text
基于当前 AGENTS.md，解释这个项目最重要的协作约束
```

**步骤 6：建立知识库**
```text
/wiki refresh
```

**步骤 7：提交初始配置**
```bash
git add AGENTS.md .sacode/
git commit -m "chore: 初始化 SaCode 项目配置"
```

#### 预期输出
- 完整的项目配置
- 清晰的协作约束
- 有效的记忆系统
- 规范的知识库

### 7.6 日常开发工作流

#### 目标
在现有项目中高效使用 SaCode 进行日常开发

#### 完整步骤

**每日开始：**
```bash
cd /your/project
sacode
```

**检查状态：**
```text
/doctor
/status
```

**开始工作：**
```text
# 分析当前任务
帮我理解这个功能的实现方式

# 修改代码
修复这个功能的 bug --mode build

# 代码审查
审查刚才的修改，看是否有问题

# 运行测试
告诉我需要运行哪些测试
```

**记录重要决策：**
```text
/memory append "这个功能采用方案 A 而不是方案 B，因为..." --type decision
```

**总结每日进展：**
```text
总结今天完成的工作和明天需要继续的任务
```

#### 预期输出
- 高效的问题解决
- 完整的知识记录
- 清晰的工作节奏

### 工作流最佳实践

1. **先规划，后执行**：对于复杂任务，先用 `plan` 模式了解全貌
2. **受控修改**：使用 `build` 模式保持控制，避免意外修改
3. **及时记录**：遇到重要决策或发现，及时写入 `memory`
4. **定期总结**：定期查看和总结 `memory`，形成团队知识
5. **验证优先**：修改后先运行测试，确保不引入新问题
6. **提交规范**：每次提交前使用 SaCode 生成规范的提交说明

## 8. 运行数据位置

### 8.1 数据目录结构

项目根目录下的 `.sacode/` 保存运行配置与任务数据：

```text
.sacode/
├── provider.json          # Provider 配置（项目级）
├── mcp.json               # MCP 服务配置
├── profile.json           # 模型配置组合
├── mistakes.json          # 错题本
├── project.json           # 项目元信息
├── audit.log              # 沙箱审计日志
├── session.json           # 会话状态
├── checkpoints/           # 执行现场保存点
│   ├── checkpoint-20250108-143022.json
│   └── checkpoint-20250108-150123.json
├── wiki/                  # 项目级知识库
│   ├── memory/
│   ├── skills/
│   └── cache/
├── skills/                # 项目级 Skills
│   ├── skill-name/
│   │   └── SKILL.md
│   └── another-skill/
│       └── SKILL.md
└── logs/                  # 运行日志
    ├── tui.log
    └── daemon.log
```

用户级配置位于：
```text
~/.sacode/
├── provider.json          # Provider 配置（用户级）
├── profile.json           # 模型配置组合（用户级）
├── wiki/                  # 用户级知识库
│   ├── memory/
│   └── skills/
└── skills/                # 用户级 Skills
```

### 8.2 配置文件详解

#### `provider.json`

**作用**：存储 API Provider 配置

**项目级示例**：
```json
{
  "providers": [
    {
      "name": "openai",
      "base_url": "https://api.openai.com/v1",
      "api_key": "sk-xxxxxxxxxxxxxxxxxxxxxxxx",
      "models": ["gpt-4", "gpt-3.5-turbo"],
      "is_default": true
    }
  ],
  "default_model": "gpt-4"
}
```

**用户级示例**：
```json
{
  "providers": [
    {
      "name": "deepseek",
      "base_url": "https://api.deepseek.com/v1",
      "api_key": "sk-xxxxxxxxxxxxxxxxxxxxxxxx",
      "models": ["deepseek-chat", "deepseek-coder"],
      "is_default": false
    }
  ],
  "default_model": "deepseek-chat"
}
```

**优先级**：项目级配置 > 用户级配置

#### `mcp.json`

**作用**：存储 MCP 服务配置

**示例**：
```json
{
  "mcpServers": {
    "context7": {
      "command": "npx",
      "args": ["-y", "@context7/context7-mcp-server"],
      "enabled": true
    },
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/path/to/allowed"],
      "enabled": false
    }
  }
}
```

#### `profile.json`

**作用**：存储模型配置组合

**示例**：
```json
{
  "profiles": {
    "default": {
      "provider": "openai",
      "model": "gpt-4",
      "max_tokens": 4096,
      "temperature": 0.7
    },
    "code-analysis": {
      "provider": "deepseek",
      "model": "deepseek-coder",
      "max_tokens": 8192,
      "temperature": 0.3
    }
  },
  "current_profile": "default"
}
```

#### `mistakes.json`

**作用**：存储错题本，记录失败任务

**示例**：
```json
{
  "mistakes": [
    {
      "id": "mistake-001",
      "timestamp": "2025-01-08T14:30:22Z",
      "task": "修复 TUI 任务状态流转问题",
      "error": "Failed to parse response",
      "context": "...",
      "suggested_fix": "..."
    }
  ]
}
```

#### `project.json`

**作用**：存储项目元信息

**示例**：
```json
{
  "name": "SaCode",
  "version": "0.1.32",
  "initialized_at": "2025-01-01T00:00:00Z",
  "last_used_at": "2025-01-08T14:30:22Z",
  "config": {
    "execution_mode": "build",
    "default_profile": "default"
  }
}
```

### 8.3 检查点（Checkpoints）

#### 作用
保存执行现场，支持断点续传

#### 创建检查点
```text
# 自动创建
完成任务后自动创建检查点

# 手动创建
/checkpoint save my-checkpoint
```

#### 查看检查点
```text
/checkpoint list
```

#### 恢复检查点
```text
/checkpoint restore checkpoint-20250108-143022
```

#### 删除检查点
```text
/checkpoint clean
```

### 8.4 知识库（Wiki）

#### 层级结构
1. **用户级**：`~/.sacode/wiki/`
   - 跨项目通用知识
   - 个人偏好和习惯
   - 通用工作流程

2. **项目级**：`.sacode/wiki/`
   - 项目特定知识
   - 团队协作约束
   - 项目最佳实践

3. **会话级**：临时知识
   - 当前会话上下文
   - 会话结束后自动清理

#### 知识库管理
```text
# 查看知识库状态
/wiki

# 刷新知识库
/wiki refresh

# 查看知识库路径
/wiki path

# 查看记忆内容
/memory show

# 搜索记忆
/memory search 关键词

# 添加记忆
/memory append "重要信息" --type memory
```

### 8.5 Skills 目录

#### 作用
存储项目级和用户级 Skills

#### Skill 结构
```text
skills/
└── my-skill/
    └── SKILL.md
```

**SKILL.md 格式**：
```markdown
# Skill 名称

## 描述
简要描述这个 Skill 的用途

## 使用场景
什么时候使用这个 Skill

## 参数
- 参数1：说明
- 参数2：说明

## 示例
使用示例

## 注意事项
使用时需要注意的事项
```

#### 管理 Skills
```text
# 列出所有 Skills
/skills list

# 查看 Skill 详情
/skills show my-skill

# 运行 Skill
/skills run my-skill 参数1 参数2

# 添加新 Skill
/skills add new-skill "描述" "提示词模板"
```

### 8.6 日志文件

#### 日志位置
```text
.sacode/logs/
├── tui.log          # TUI 运行日志
├── daemon.log       # Daemon 服务日志
└── audit.log        # 沙箱审计日志
```

#### 查看日志
```bash
# 查看最新 TUI 日志
tail -f .sacode/logs/tui.log

# 查看 Daemon 日志
cat .sacode/logs/daemon.log

# 查看审计日志
cat .sacode/logs/audit.log
```

#### 日志级别
- `DEBUG`：详细调试信息
- `INFO`：一般信息
- `WARN`：警告信息
- `ERROR`：错误信息

### 8.7 数据迁移

#### 从旧版本迁移
```bash
# 备份现有数据
cp -r ~/.sacode ~/.sacode.backup
cp -r .sacode .sacode.backup

# 升级 SaCode
sacode update

# 迁移数据（如果需要）
# 通常自动迁移，无需手动操作
```

#### 手动迁移配置
```bash
# 复制 Provider 配置
cp ~/.sacode.backup/provider.json ~/.sacode/

# 复制记忆数据
cp -r ~/.sacode.backup/wiki ~/.sacode/

# 复制 Skills
cp -r ~/.sacode.backup/skills ~/.sacode/
```

### 8.8 数据清理

#### 清理检查点
```text
/checkpoint clean
```

#### 清理日志
```bash
# 清理旧日志
find .sacode/logs/ -name "*.log" -mtime +7 -delete

# 或者完全清理
rm -rf .sacode/logs/*
```

#### 清理缓存
```bash
# 清理知识库缓存
rm -rf .sacode/wiki/cache/

# 清理 Skill 缓存
rm -rf .sacode/skills/*/.cache/
```

#### 完全重置
```bash
# 备份重要数据
cp -r .sacode .sacode.backup

# 清理项目数据
rm -rf .sacode/

# 重新初始化
sacode init
```

### 8.9 数据安全

#### 敏感信息保护
- API Key 存储在本地，加密存储
- 不要将 `.sacode/` 目录提交到版本控制
- 定期备份重要配置

#### 备份策略
```bash
# 定期备份
tar -czf sacode-backup-$(date +%Y%m%d).tar.gz ~/.sacode/

# 恢复备份
tar -xzf sacode-backup-20250108.tar.gz -C ~/
```

#### 版本控制忽略
确保 `.gitignore` 包含：
```text
.sacode/
*.log
```

### 8.10 故障排除

#### 配置文件损坏
```bash
# 删除损坏的配置
rm .sacode/provider.json

# 重新配置
sacode
/login
```

#### 权限问题
```bash
# 修复权限
chmod 700 ~/.sacode/
chmod 600 ~/.sacode/*.json
```

#### 数据丢失
```bash
# 从备份恢复
cp -r ~/.sacode.backup/* ~/.sacode/
```

## 9. 下一步阅读

### 9.1 按学习路径阅读

#### 新手入门路径
1. **[命令速查](../reference/command-reference.md)** — 了解所有可用命令
2. **[场景教程](tutorials.md)** — 通过实际任务学习使用技巧
3. **[示例集](examples.md)** — 复制现成的命令和提示词

#### 进阶学习路径
1. **[架构说明](../reference/architecture.md)** — 理解系统架构和设计原理
2. **[API 文档](../reference/API.md)** — 深入了解接口和工具系统
3. **[开发指南](../reference/development.md)** — 参与开发和贡献

#### 产品理解路径
1. **[产品 PRD](../product/PRD.md)** — 了解产品定位和功能全景
2. **[路线图](../product/roadmap.md)** — 了解当前版本和未来规划
3. **[升级方案](../plans/capability-upgrade-plan.md)** — 了解功能演进方向

### 9.2 按需求查阅

#### 遇到问题时
- **[命令参考](../reference/command-reference.md)** — 查找相关命令
- **[场景教程](tutorials.md)** — 寻找类似场景的解决方案
- **[示例集](examples.md)** — 查看现成的命令示例

#### 想要深入了解时
- **[架构说明](../reference/architecture.md)** — 了解系统设计
- **[API 文档](../reference/API.md)** — 了解接口细节
- **[开发指南](../reference/development.md)** — 了解开发流程

#### 参与贡献时
- **[开发指南](../reference/development.md)** — 开发流程和规范
- **[发布流程](../release/RELEASE.md)** — 发布流程和检查清单
- **[构建说明](../build/CROSS_COMPILE.md)** — 构建和交叉编译

### 9.3 推荐阅读顺序

#### 第一周：基础使用
- Day 1-2：快速上手 + 命令速查
- Day 3-4：场景教程（前 5 个场景）
- Day 5-7：示例集 + 实际练习

#### 第二周：进阶技巧
- Day 1-2：架构说明（分层和执行链路）
- Day 3-4：API 文档（工具系统和配置）
- Day 5-7：场景教程（后 5 个场景）

#### 第三周：深入理解
- Day 1-2：产品 PRD + 路线图
- Day 3-4：开发指南 + 实际练习
- Day 5-7：方案文档 + 问题分析

### 9.4 实践建议

#### 学习策略
1. **先实践，后理论**：先尝试使用，再深入了解原理
2. **小步快跑**：每次学习一个功能，立即实践
3. **记录问题**：遇到问题记录下来，寻求解决方案
4. **定期回顾**：定期回顾已学内容，巩固知识

#### 实践项目
1. **个人项目**：在自己项目中应用 SaCode
2. **开源贡献**：为 SaCode 项目贡献代码或文档
3. **问题解决**：用 SaCode 解决实际问题
4. **分享经验**：分享使用经验和技巧

### 9.5 获取帮助

#### 文档资源
- 官方文档：`/docs/` 目录
- README：项目根目录 `README.md`
- AGENTS.md：项目协作指南 `AGENTS.md`

#### 社区支持
- GitHub Issues：报告问题和提出建议
- GitHub Discussions：讨论和交流
- Pull Requests：贡献代码和文档

#### 自助排查
1. **查看日志**：`.sacode/logs/` 下的日志文件
2. **运行诊断**：`/doctor` 命令
3. **检查配置**：查看 `.sacode/` 下的配置文件
4. **搜索文档**：在文档中搜索相关问题

### 9.6 常见问题快速索引

#### 安装和配置
- **安装失败**：参见"安装"部分的错误处理
- **Provider 配置**：参见"配置 Provider"部分
- **模型选择**：参见"选择模型"部分

#### 使用问题
- **命令不生效**：检查命令语法和参数
- **执行失败**：查看错误信息和日志
- **性能问题**：检查网络和模型选择

#### 高级功能
- **记忆系统**：参见"运行数据位置"部分
- **Skills 使用**：参见命令参考的 Skills 部分
- **MCP 配置**：参见 API 文档的 MCP 部分

#### 开发相关问题
- **本地开发**：参见开发指南
- **构建发布**：参见发布流程
- **贡献流程**：参见开发指南的贡献部分

### 9.7 持续学习

#### 跟进更新
- **查看版本历史**：关注版本更新日志
- **阅读新功能**：了解新增功能和改进
- **参与测试**：尝试新功能和改进

#### 分享反馈
- **报告问题**：遇到问题时报告给开发团队
- **提出建议**：提出功能改进建议
- **分享经验**：分享使用经验和最佳实践

#### 深入参与
- **贡献代码**：为项目贡献代码
- **改进文档**：帮助完善和改进文档
- **参与讨论**：参与项目讨论和规划

### 9.8 相关资源

#### 官方资源
- 项目主页：[GitHub 仓库](https://github.com/cherishron/SaCode)
- 文档站点：`/docs/` 目录
- 发布页面：[GitHub Releases](https://github.com/cherishron/SaCode/releases)

#### 学习资源
- Rust 官方文档：https://doc.rust-lang.org/
- OpenAI API 文档：https://platform.openai.com/docs
- AI 编程最佳实践：相关博客和教程

#### 工具和插件
- MCP 服务器：Model Context Protocol 服务器
- Skills 库：官方和社区 Skills
- IDE 插件：VSCode、Cursor、JetBrains 插件

### 9.9 实践检查清单

#### 基础能力检查
- [ ] 成功安装 SaCode
- [ ] 配置至少一个 Provider
- [ ] 选择并使用模型
- [ ] 运行基本命令
- [ ] 理解三种执行模式

#### 进阶能力检查
- [ ] 使用记忆系统
- [ ] 创建和使用 Skills
- [ ] 配置和使用 MCP
- [ ] 理解项目知识库
- [ ] 使用检查点功能

#### 高级能力检查
- [ ] 自定义输出风格
- [ ] 配置工作流
- [ ] 调试和问题排查
- [ ] 参与项目贡献
- [ ] 分享使用经验

### 9.10 学习里程碑

#### 里程碑 1：新手（1-2 周）
- 完成安装和基本配置
- 掌握基础命令使用
- 理解基本工作流程
- 解决 3-5 个实际问题

#### 里程碑 2：熟练使用者（1-2 个月）
- 熟练使用所有主要功能
- 理解系统架构和设计
- 能够自定义配置和工具
- 解决 10+ 个复杂问题

#### 里程碑 3：专家（3-6 个月）
- 深入理解内部机制
- 能够贡献代码和文档
- 帮助他人解决问题
- 参与项目规划和改进

通过这个学习路径，你将能够从新手成长为 SaCode 的熟练使用者，甚至成为项目贡献者。记住，实践是最好的学习方式，多尝试、多记录、多分享！
