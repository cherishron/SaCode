# D. 提交与安全

目标：仓库里**没有真实密钥**、**没有构建产物**、**提交可追溯**。

## 检查项

- **凭据**：API Key / Token / 密码 / 私钥 / Cookie / 认证头 / 数据库连接串及其配置文件（`.env`）**一律不入库**——测试、夹具、文档、截图、提交说明同样适用。
- 只提交**明确无效的占位值**与无秘密的配置模板。
- **产物**：构建产物、依赖、日志、二进制按 `.gitignore` 忽略，不入库。
- **暂存**：提交前用 `git status` / `git diff --cached` 看**实际暂存差异**；**禁止 `git add -A` / `git add .`**（易夹带游离产物），按路径精确 `add`。
- **粒度与说明**：一次提交一件事；message 用约定格式（如 `type(scope): 描述`，中文）。
- **大文件 / 二进制**：不入库，走专门分发渠道。

## `.gitignore` 基线（按需裁剪）

```gitignore
# 构建产物与依赖
/target/
/dist/
build/
out/
node_modules/
# 运行与日志
*.log
*.tmp
*.dump
# 本地配置与凭据
.env
.env.*
*.local
credentials*
!credentials*.example
# 编辑器 / 系统
.DS_Store
Thumbs.db
.idea/
.vscode/*
```

## 提交前检查（可粘贴）

```bash
git status --short
git diff --cached --stat          # 看实际暂存了什么
git diff --cached | grep -inE 'api[_-]?key|secret|token|password|BEGIN .*PRIVATE KEY'
```

grep 命中要**逐条核对**（不是自动判定泄露），但要当红灯处理。

## 安全红线

- 发现真实凭据 → **停止提交、不回显其值**、提示用户撤销 / 轮换；**不擅自改写历史**。
- 未经明确授权不提交、不推送。
- 不能只看 `.gitignore`；要看**实际暂存差异**。

## 输出

- 违规项（凭据 / 产物 / 大文件）清单 + 证据路径。
- `.gitignore` 补全建议 + 暂存前检查清单。