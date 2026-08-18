# 国内 Provider 快速接入指南

> 目标：5 分钟内完成任一国内模型服务的配置，运行第一个任务。
> 配合 [getting-started.md](./getting-started.md) 的 `/login` 交互式流程使用。

---

## 一、内置预设一览

| 预设名 | 提供商 | Base URL | 是否需 API Key |
|--------|--------|----------|----------------|
| `deepseek` | DeepSeek（深度求索） | `https://api.deepseek.com` | 是 |
| `qwen` | 通义千问（阿里云 DashScope） | `https://dashscope.aliyuncs.com/compatible-mode/v1` | 是 |
| `zhipu` | 智谱 GLM（智谱 AI） | `https://open.bigmodel.cn/api/paas/v4` | 是 |
| `mimo` | MiMo（小米） | `https://token-plan-cn.xiaomimimo.com/v1` | 是 |
| `longcat` | LongCat | `https://api.longcat.chat/openai/v1` | 是 |
| `openai` | OpenAI | `https://api.openai.com/v1` | 是 |
| `ollama` | Ollama（本地） | `http://127.0.0.1:11434/v1` | 否 |

> 全部为 OpenAI 兼容 API。首次配置只需两步：**选择预设 → 输入 API Key**。

---

## 二、获取 API Key

### DeepSeek（推荐，性价比高）

1. 注册：https://platform.deepseek.com
2. 左侧菜单"API Keys"→ 创建新密钥
3. 复制 `sk-` 开头的密钥，充值后即可使用

### 通义千问（阿里云 DashScope）

1. 注册：https://bailian.console.aliyun.com
2. 开通 DashScope 服务 → "API-KEY 管理"→ 创建密钥
3. 复制 `sk-` 开头密钥

### 智谱 GLM

1. 注册：https://open.bigmodel.cn
2. 控制台 → "API Keys" → 创建密钥（实名认证后可用）
3. 复制 `xxxx.xxxx` 格式密钥（注意：智谱 Key 含 `.` 分隔符）

### MiMo（小米）

1. 注册：https://platform.xiaomimimo.com
2. "API 密钥" → 创建密钥
3. 复制 `sk-` 或 `tp-` 开头密钥

### Ollama（本地，完全免费）

```bash
# 安装并拉取模型
ollama pull glm-4.7-flash  # 或 qwen2.5-coder 等
ollama serve
```

无需 API Key，`/login` 中直接选 ollama 即可。

---

## 三、配置流程

```text
$ sacode
⚠️  未配置模型服务。输入 /login 选择 provider 并配置 API Key 后开始使用。

>>> /login

选择你的模型服务：
  1. ollama (http://127.0.0.1:11434/v1)
  2. deepseek (https://api.deepseek.com)
  3. mimo (https://token-plan-cn.xiaomimimo.com/v1)
  4. longcat (https://api.longcat.chat/openai/v1)
  5. openai (https://api.openai.com/v1)
  6. zhipu (https://open.bigmodel.cn/api/paas/v4)
  7. qwen (https://dashscope.aliyuncs.com/compatible-mode/v1)
  8. 自定义（手动输入 Base URL）
选择编号: 6
zhipu 的 API Key: ********
✅ 已配置 provider zhipu
```

TUI 中同样输入 `/login` 或 `/connect` 走相同流程。

---

## 四、验证与排错

```text
/providers      # 查看已配置的 provider
/doctor         # 检查配置与连通性
```

| 错误 | 排查 |
|------|------|
| `Failed to connect` | Base URL 拼写；网络/代理（`HTTPS_PROXY`） |
| `Authentication failed` | Key 过期或未实名；重新 `/login` |
| 模型列表为空 | 部分 provider 的 `/models` 端点需认证；直接 `/login` 后选模型 |

---

## 五、推荐模型组合

| 场景 | 推荐 | 说明 |
|------|------|------|
| 日常编码（免费） | 智谱 `glm-4.7-flash` | 免费额度充足 |
| 高性价比代码 | DeepSeek `deepseek-chat` | 官方 API 便宜 |
| 长上下文 | 通义 `qwen-plus` / `qwen-turbo` | 最大 1M token |
| 本地隐私 | Ollama `qwen2.5-coder` | 完全本地 |
