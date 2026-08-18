# SaCode 快速上手

> 更新时间：2026-08-18
> 目标：5 分钟内从安装到完成第一个任务

本文档按"30 秒安装 → 1 分钟配置 → 3 分钟第一个任务 → 5 分钟进阶用法"渐进组织，新手只需按顺序执行。

---

## 30 秒：安装

### npm 安装（推荐）

```bash
npm install -g @cherishron/sacode
sacode --version
```

### 手动安装

从 [GitHub Releases](https://github.com/cherishron/SaCode/releases) 下载对应平台二进制：

```bash
tar -xzf sacode-linux-x64.tar.gz
sudo mv sacode /usr/local/bin/
sacode --version
```

### 支持平台

- Linux x64
- Windows x64
- macOS（计划中，详见 [路线图](../product/roadmap.md)）

### 常见安装问题

<details>
<summary>命令找不到 / 权限错误 / 网络问题（点击展开）</summary>

#### `command not found: sacode`

npm 全局路径不在 PATH：

```bash
npm config get prefix
export PATH=$(npm config get prefix)/bin:$PATH
```

#### `EACCES: permission denied`

```bash
sudo npm install -g @cherishron/sacode
```

#### npm registry 连接失败（国内）

```bash
npm config set registry https://registry.npmmirror.com
npm install -g @cherishron/sacode
```

</details>

---

## 1 分钟：配置 Provider

> 改进说明（2026-08-18）：`/login` 已重构为交互式选择流程 —— 选择预设 provider → 输入 API Key，2 步完成配置。
> 详见 [report-plan.md](../report-plan.md) 与 [improvement-execution-plan.md](../plans/improvement-execution-plan.md)。
>
> 内置预设：DeepSeek、通义千问（Qwen）、智谱 GLM、MiMo、LongCat、OpenAI、Ollama（本地，无需 Key），另可自定义 Base URL。
>
> 以下两种方式任选其一。

### 方式 A：交互式选择预设 Provider（推荐）

```text
/login
```

选择你的模型服务：

```
  1. ollama (http://127.0.0.1:11434/v1)
  2. deepseek (https://api.deepseek.com)
  3. mimo (https://token-plan-cn.xiaomimimo.com/v1)
  4. longcat (https://api.longcat.chat/openai/v1)
  5. openai (https://api.openai.com/v1)
  6. zhipu (https://open.bigmodel.cn/api/paas/v4)  // 智谱 GLM
  7. qwen (https://dashscope.aliyuncs.com/compatible-mode/v1)  // 通义千问
  8. 自定义（手动输入 Base URL）
选择编号: 6
zhipu 的 API Key: ********
✅ 已配置 provider zhipu
```

仅两步：选择 provider → 输入 API Key（Ollama 本地无需 Key）。Base URL 已内置，无需手动输入。

### 方式 B：自定义 Base URL

在 `/login` 中选择"自定义"，手动输入 Provider 名称与 Base URL。

**常见 Base URL**：

| Provider | Base URL |
|----------|----------|
| OpenAI | `https://api.openai.com/v1` |
| DeepSeek | `https://api.deepseek.com` |
| 通义千问 | `https://dashscope.aliyuncs.com/compatible-mode/v1` |
| 智谱 GLM | `https://open.bigmodel.cn/api/paas/v4` |
| Ollama | `http://127.0.0.1:11434/v1` |
| Azure OpenAI | `https://<resource>.openai.azure.com/openai/deployments/<id>` |

### 验证配置

```text
/providers
```

### 配置文件位置

| 配置文件 | 用途 | 位置 |
|---------|------|------|
| `provider.json` | TUI/REPL 交互配置 | `~/.sacode/`（用户级）、`.sacode/`（项目级） |
| `config.json` | 任务执行配置（`sacode "<task>"` 实际读取） | 同上 |

<details>
<summary>配置文件格式详情（点击展开）</summary>

```json
// provider.json
{
  "providers": [
    {
      "name": "deepseek",
      "base_url": "https://api.deepseek.com/v1",
      "api_key": "YOUR_API_KEY",
      "models": ["deepseek-chat", "deepseek-coder"],
      "is_default": true
    }
  ],
  "default_model": "deepseek-chat"
}
```

```json
// config.json（任务执行用，model 格式为 provider/model）
{
  "model": "sensenova/sensenova-6.7-flash-lite",
  "provider": {
    "sensenova": {
      "name": "SenseNova",
      "base_url": "https://token.sensenova.cn/v1",
      "api_key": "YOUR_API_KEY",
      "models": { "sensenova-6.7-flash-lite": { "name": "sensenova-6.7-flash-lite", "thinking": false } }
    }
  }
}
```

</details>

<details>
<summary>常见配置错误处理（点击展开）</summary>

#### `Failed to connect to provider`

- 检查 Base URL 是否正确
- 检查网络连接：`curl -I https://api.openai.com/v1`
- 如使用代理：`export HTTPS_PROXY=http://127.0.0.1:7890`

#### `Authentication failed`

- 确认 API Key 正确且未过期
- 重新 `/login` 覆盖配置

</details>

---

## 3 分钟：第一个任务

### 选择模型

```text
/models
```

选择适合代码分析的模型（如 `deepseek-coder`、`gpt-4`）。

### 三种启动方式

```bash
# 1. TUI（默认，交互式）
sacode

# 2. REPL
sacode repl

# 3. 单次任务（Ghost 模式）
sacode "分析当前仓库的架构边界"
```

### 三种执行模式

| 模式 | 用途 | 特点 |
|------|------|------|
| `plan` | 规划优先，不修改代码 | 只分析和规划，适合不确定任务 |
| `build` | 受控修改，每个动作请求审批 | 日常改代码首选 |
| `yolo` | 自动执行，无需确认 | 明确、低风险、可重复任务 |

> 改进说明：`yolo` 模式将重命名为更严肃的名称（如 `auto`/`full`），详见 [report-plan.md](../report-plan.md) 步骤 4.5。

**切换模式**：
- TUI 快捷键：`Ctrl+M` 循环切换
- 命令行：`sacode "任务" --mode plan`

**模式选择决策树**：

```
是否需要修改代码？
├─ 否 → plan
└─ 是 → 是否确定修改范围？
    ├─ 是 → 是否需要逐个确认？
    │   ├─ 是 → build
    │   └─ 否 → yolo
    └─ 否 → plan 先规划
```

### 第一个任务示例

```bash
# 进入项目目录
cd /path/to/your/project

# 分析仓库（plan 模式，安全）
sacode "解释这个仓库的主要分层、真实入口和高风险模块" --mode plan

# 修复 bug（build 模式，受控修改）
sacode "修复这个功能的 bug" --mode build

# 生成提交信息（管道模式）
git diff | sacode "根据改动生成一条简洁准确的 commit message"
```

---

## 5 分钟：进阶用法

### 核心命令速查（5 个一级命令）

| 命令 | 用途 |
|------|------|
| `/login` | 配置 Provider |
| `/models` | 管理模型 |
| `/mode` | 切换 plan/build/yolo |
| `/agents` | 多 Agent 编排 |
| `/help` | 上下文感知帮助 |

### 按需发现命令（二级）

| 命令 | 用途 |
|------|------|
| `/memory` | 项目记忆管理 |
| `/wiki` | 知识库管理 |
| `/loop` | 循环执行 |
| `/checkpoint` | 检查点管理 |
| `/doctor` | 诊断 |
| `/connect` | 快速接入预设 Provider |
| `/providers` | Provider 管理 |

> 改进说明：规划方案步骤 6.3 将命令体系分层：一级 5 个 + 二级按需 + 三级归 CLI 不暴露在 TUI。详见 [report-plan.md](../report-plan.md)。

### 常用快捷键

| 快捷键 | 功能 |
|--------|------|
| `Ctrl+Q` | 退出 |
| `Esc` | 清空输入 / 取消操作 |
| `Ctrl+T` | 开关思考过程显示 |
| `Ctrl+M` | 切换执行模式 |

### 常见工作流

#### 代码理解工作流

```text
# 1. 启动
sacode

# 2. 分析
解释这个仓库的主要分层、真实入口和高风险模块

# 3. 深入
先读 Cargo.toml、README、CI workflow 和主入口，再解释仓库如何运行

# 4. 聚焦
详细说明 kernel、runtime、interfaces 的职责边界

# 5. 沉淀
/memory append 这个仓库的入口在 interfaces/cli/src/cmd/mod.rs --type memory
```

#### 问题定位工作流

```bash
git diff | sacode "根据这份改动指出最可能的风险点和建议验证顺序"
```

```text
针对这个仓库给我一个最省时的验证顺序，先跑最值钱的检查
```

#### 代码修改工作流

```bash
# 规划
sacode "设计改进方案" --mode plan

# 执行（受控修改）
sacode "修复这个 bug" --mode build

# 验证
git diff | sacode "总结这次改动的核心变化和风险点"

# 提交
git diff | sacode "根据改动生成 commit message"
```

### 运行数据位置

```text
.sacode/
├── provider.json      # Provider 配置（TUI 用）
├── config.json        # 任务执行配置（CLI 任务读取）
├── mcp.json           # MCP 服务配置
├── profile.json      # 模型配置组合
├── mistakes.json     # 错题本
├── audit.log          # 沙箱审计日志（企业可审计差异化资产）
├── checkpoints/       # 执行现场保存点
├── wiki/              # 项目级知识库
├── skills/            # 项目级 Skills
└── logs/              # 运行日志
```

> **企业级可审计**：`audit.log` 记录所有副作用操作，支持企业 SIEM 接入。这是 SaCode 相对 Claude Code 的差异化能力，详见 [PRD](../product/PRD.md) §5 产品原则。

---

## 下一步阅读

| 目的 | 文档 |
|------|------|
| 查看所有命令 | [命令参考](../reference/command-reference.md) |
| 场景教程 | [场景教程](tutorials.md) |
| 可复制示例 | [示例集](examples.md) |
| 架构理解 | [架构说明](../reference/architecture.md) |
| 产品定位 | [PRD](../product/PRD.md) |
| 版本规划 | [路线图](../product/roadmap.md) |
| 评估与规划 | [可行性评估报告](../report.md) → [改进规划方案](../report-plan.md) |

---

## 完整安装故障排查

<details>
<summary>展开查看完整错误处理</summary>

### npm 全局路径问题

```bash
# 查找 npm 全局路径
npm config get prefix

# 修复 npm 权限（推荐方案）
mkdir ~/.npm-global
npm config set prefix '~/.npm-global'
export PATH=~/.npm-global/bin:$PATH
echo 'export PATH=~/.npm-global/bin:$PATH' >> ~/.bashrc
source ~/.bashrc
npm install -g @cherishron/sacode
```

### Windows 特殊说明

Windows 下若遇到执行策略限制：

```powershell
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
```

### 模型列表获取失败

```text
/models
# 若提示 Failed to fetch models
# 1. 检查 /providers 配置
# 2. 手动测试 API：curl https://api.openai.com/v1/models -H "Authorization: Bearer $KEY"
# 3. 本地 provider 确认服务已启动：curl http://127.0.0.1:11434/api/tags
```

</details>
