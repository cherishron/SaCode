# CI/CD 集成指南

> SaCode 支持通过 Ghost 模式（stdin 输入、`--json` 结构化输出）集成到 CI/CD 流水线。
> 最后更新：2026-08-18

---

## 一、前置条件

1. 仓库根目录或 CI 环境已配置 SaCode provider（`sacode login` 或 `SACODE_API_KEY` 环境变量）
2. 确保 CI runner 有网络访问模型服务的权限

---

## 二、GitHub Actions 模板

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
          SACODE_BASE_URL: https://api.deepseek.com/v1
        run: |
          sacode config set kernel.current_provider deepseek

      - name: Run Code Review
        if: github.event.pull_request.draft == false
        run: |
          git diff origin/${{ github.base_ref }}...HEAD --unified=10 > diff.patch
          sacode "审查以下 diff，标注风险点和建议变更，输出结构化结果" \
            --mode plan --json > review-result.json < diff.patch

      - name: Upload Review Artifacts
        uses: actions/upload-artifact@v4
        with:
          name: saCode-review
          path: review-result.json
```

---

## 三、GitLab CI 模板

在 `.gitlab-ci.yml` 中添加：

```yaml
sacode-review:
  image: rust:1.78
  stage: review
  rules:
    - if: '$CI_PIPELINE_SOURCE == "merge_request_event"'
  script:
    - curl -fsSL https://sacode.sh | bash -s -- v1.0.0
    - git diff origin/$CI_MERGE_REQUEST_TARGET_BRANCH_NAME...HEAD > diff.patch
    - sacode "审查变更" --mode plan --json < diff.patch
```

---

## 四、通用用法（适用于任意 CI）

```bash
# 1. 安装
curl -fsSL https://sacode.sh | bash -s -- v1.0.0

# 2. 配置（使用环境变量）
export SACODE_API_KEY=your-key-here
export SACODE_BASE_URL=https://api.deepseek.com/v1

# 3. 对 diff 做审查（Ghost 模式 + JSON 输出）
git diff HEAD~1 --unified=10 | sacode "审查变更" --mode plan --json

# 4. 对测试日志做诊断
cargo test 2>&1 | sacode "分析测试失败原因" --mode plan --json

# 5. 批量处理日志
for f in logs/*.log; do
  sacode "提取 $f 中的 error 条目并归类" --mode plan --json < "$f"
done
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

## 六、注意事项

| 场景 | 建议 |
|------|------|
| 大 diff（>500 行） | 先 `git diff --stat` 筛选关键文件，再单独审查 |
| 网络不稳定 | 设置 `SACODE_TIMEOUT_SECONDS=120` |
| 多文件审查 | 使用 `/add-dir <path>` 添加多个目录 |
| 安全扫描 | 在 build 阶段前置运行 `sacode "扫描安全问题" --mode build` |