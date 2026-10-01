# CI/CD 集成指南

> SaCode 支持通过 Ghost 模式（stdin 输入、`--json` 结构化输出）集成到 CI/CD 流水线。
> 最后更新：2026-08-19

---

## 一、前置条件

1. 仓库根目录或 CI 环境已配置 SaCode provider（`sacode login` 或 `SACODE_API_KEY` 环境变量）
2. 确保 CI runner 有网络访问模型服务的权限

---

## 二、GitHub Actions 模板

### 2.1 PR 代码审查

在 `.github/workflows/sacode-review.yml` 中添加：

```yaml
name: SaCode Code Review
on:
  pull_request:
    paths-ignore: ['**/*.md']

jobs:
  code-review:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Install SaCode
        run: |
          curl -fsSL https://sacode.sh | bash -s -- v1.0.0
          echo "$HOME/.sacode/bin" >> $GITHUB_PATH

      - name: Configure SaCode
        env:
          SACODE_API_KEY: ${{ secrets.SACODE_API_KEY }}
        run: |
          sacode config set kernel.current_provider deepseek

      - name: Run Code Review
        if: github.event.pull_request.draft == false
        run: |
          git diff origin/${{ github.base_ref }}...HEAD --unified=10 > diff.patch
          sacode "审查以下 diff，标注风险点和建议变更，输出结构化结果" \
            --mode plan --json < diff.patch > review-result.json

      - name: Upload Review Artifacts
        uses: actions/upload-artifact@v4
        with:
          name: sacode-review
          path: review-result.json
```

### 2.2 Rust 项目（Cargo）

```yaml
name: Rust Build & Test
on:
  push:
    branches: [main, dev]
  pull_request:

jobs:
  rust:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Install SaCode
        run: curl -fsSL https://sacode.sh | bash -s -- v1.0.0

      - name: Setup Rust
        uses: actions-rs/toolchain@v1
        with:
          toolchain: stable
          profile: minimal
          override: true

      - name: Build
        run: |
          export SACODE_API_KEY=${{ secrets.SACODE_API_KEY }}
          sacode "构建项目并运行测试，如有失败请自动修复" \
            --mode build --json

      - name: Upload Artifacts
        uses: actions/upload-artifact@v4
        with:
          name: rust-target
          path: target/debug/
```

### 2.3 Node.js 项目

```yaml
name: Node.js CI
on:
  push:
    branches: [main, dev]
  pull_request:

jobs:
  node:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: 20

      - name: Install Dependencies
        run: npm install

      - name: Install SaCode
        run: curl -fsSL https://sacode.sh | bash -s -- v1.0.0

      - name: Build & Test
        run: |
          export SACODE_API_KEY=${{ secrets.SACODE_API_KEY }}
          sacode "运行 npm test 并修复失败测试" \
            --mode build --json

      - name: Lint Check
        run: |
          npm run lint --if-present
```

### 2.4 Python 项目

```yaml
name: Python CI
on:
  push:
    branches: [main, dev]
  pull_request:

jobs:
  python:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup Python
        uses: actions/setup-python@v5
        with:
          python-version: '3.12'

      - name: Install Dependencies
        run: pip install -r requirements.txt

      - name: Install SaCode
        run: curl -fsSL https://sacode.sh | bash -s -- v1.0.0

      - name: Run Tests
        run: |
          export SACODE_API_KEY=${{ secrets.SACODE_API_KEY }}
          sacode "运行 pytest 并修复失败测试" \
            --mode build --json
```

### 2.5 自动修复循环

```yaml
name: Auto-Fix
on:
  push:
    branches: [main, dev]

jobs:
  auto-fix:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          token: ${{ secrets.GITHUB_TOKEN }}

      - name: Install SaCode
        run: curl -fsSL https://sacode.sh | bash -s -- v1.0.0

      - name: Run Auto-Fix
        run: |
          export SACODE_API_KEY=${{ secrets.SACODE_API_KEY }}
          git config user.name "sacode-bot"
          git config user.email "sacode-bot@github.com"
          git checkout -b autofix/$(date +%Y%m%d)
          sacode "运行所有测试，修复失败项" --mode build --json

      - name: Commit and Push
        run: |
          git add -A
          git commit -m "auto: fix test failures" || true
          git push origin HEAD
```

---

## 三、GitLab CI 模板

### 3.1 PR 代码审查

```yaml
sacode-review:
  image: node:20
  stage: review
  rules:
    - if: '$CI_PIPELINE_SOURCE == "merge_request_event"'
  script:
    - curl -fsSL https://sacode.sh | bash -s -- v1.0.0
    - git diff origin/$CI_MERGE_REQUEST_TARGET_BRANCH_NAME...HEAD > diff.patch
    - SACODE_API_KEY=$SACODE_API_KEY sacode "审查变更" --mode plan --json < diff.patch
  artifacts:
    paths:
      - review-result.json
```

### 3.2 Rust 项目

```yaml
rust-ci:
  image: rust:1.82
  stage: build
  script:
    - curl -fsSL https://sacode.sh | bash -s -- v1.0.0
    - SACODE_API_KEY=$SACODE_API_KEY sacode "构建并测试 Rust 项目" --mode build --json
  artifacts:
    paths:
      - target/debug/
```

---

## 四、通用用法（适用于任意 CI）

```bash
# 1. 安装
curl -fsSL https://sacode.sh | bash -s -- v1.0.0

# 2. 配置（使用环境变量）
export SACODE_API_KEY=your-key-here

# 3. 对 diff 做审查（Ghost 模式 + JSON 输出）
git diff HEAD~1 --unified=10 | sacode "审查变更" --mode plan --json

# 4. 对测试日志做诊断
cargo test 2>&1 | sacode "分析测试失败原因" --mode plan --json

# 5. 批量处理日志
for f in logs/*.log; do
  sacode "提取 $f 中的 error 条目并归类" --mode plan --json < "$f"
done

# 6. 自动修复代码
sacode "运行测试并修复所有失败" --mode build --json
```

---

## 五、输出格式说明

`--json` 模式下 SaCode 输出结构：

```json
{
  "prompt": "审查变更",
  "mode": "plan",
  "provider_response": { "content": "..." },
  "events": [...],
  "tool_results": [...],
  "route_records": [...],
  "conflicts": [...],
  "summary_record": { ... }
}
```

CI 脚本应解析 `provider_response.content` 字段获取最终结论。

---

## 六、Secrets 配置

### GitHub Actions

在仓库 Settings → Secrets and variables → Actions 中添加：

| Secret | 说明 |
|--------|------|
| `SACODE_API_KEY` | SaCode provider API Key |
| `GITHUB_TOKEN` | 自动提交修复时需要 |

### GitLab CI

在 Project Settings → CI/CD → Variables 中添加：

| Variable | 说明 |
|----------|------|
| `SACODE_API_KEY` | SaCode provider API Key |

---

## 七、注意事项

| 场景 | 建议 |
|------|------|
| 大 diff（>500 行） | 先 `git diff --stat` 筛选关键文件，再单独审查 |
| 网络不稳定 | 设置 `SACODE_TIMEOUT_SECONDS=120` |
| 多文件审查 | 使用 `/add-dir <path>` 添加多个目录 |
| 安全扫描 | 在 build 阶段前置运行 `sacode "扫描安全问题" --mode build` |
| 速率限制 | 设置 `SACODE_RATE_LIMIT=10` 限制并发 |
| 调试 | 添加 `--log-level debug` 查看详细执行日志 |