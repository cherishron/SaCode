# 测试编写一键流程

## 概述

SaCode 提供从"分析代码→生成测试→运行验证"的一键测试编写流程，支持 `cargo test`、`npm test`、`go test`、`pytest` 等主流测试框架的自动检测和执行。

## 一键流程

### 步骤 1：分析代码，生成测试

```bash
# 在 TUI 中直接输入
请为 src/parser.rs 的 parse_config 函数编写单元测试
```

SaCode 会自动：
1. 读取目标文件内容
2. 分析函数签名、依赖和边界条件
3. 生成符合项目风格和框架的测试代码
4. 通过 `fs.write` 写入测试文件

### 步骤 2：运行测试验证

```bash
# 在 TUI 中直接输入
运行刚才生成的测试
```

SaCode 会自动调用 `test.run` 工具：
- 自动检测项目类型（Cargo/npm/Go/Python）
- 运行对应的测试命令
- 实时显示测试结果
- 如测试失败，自动进入修复循环

### 步骤 3：自动修复（如失败）

如果测试失败，SaCode 会自动：
1. 读取测试错误输出
2. 分析失败原因（代码逻辑错误 / 测试用例错误）
3. 修复代码或测试
4. 重新运行测试

## 常用命令

### 运行所有测试

```bash
# 自动检测框架并运行
/test.run
```

### 运行特定文件

```bash
# 运行指定文件的测试
/test.run tests/unit/parser_test.rs
```

### 运行特定测试

```bash
# 运行指定测试函数
/test.run test_parse_config
```

### 自动修复失败测试

```bash
# 自动分析和修复失败测试
/test.fix
```

## 支持的框架

| 框架 | 检测文件 | 运行命令 | 自动检测 |
|------|----------|----------|----------|
| Cargo | `Cargo.toml` | `cargo test` | ✅ |
| npm | `package.json` | `npm test` | ✅ |
| Go | `go.mod` | `go test ./...` | ✅ |
| pytest | `pytest.ini` / `pyproject.toml` | `python -m pytest` | ✅ |
| Jest | `jest.config.js` | `npx jest` | ✅ |

## 编写测试的 AI 提示

### 基础测试

```
请为 src/parser.rs 的 parse_config 函数编写单元测试。
要求：
1. 覆盖正常输入
2. 覆盖边界条件（空输入、特殊字符）
3. 覆盖错误处理（无效格式、缺少字段）
```

### 集成测试

```
请为 src/api/handler.rs 编写集成测试。
要求：
1. 使用 mock 模拟外部依赖
2. 覆盖正常请求路径
3. 覆盖鉴权失败场景
4. 覆盖超时和重试
```

### 回归测试

```
请为 src/commit.rs 的 git.commit 工具编写回归测试。
要求：
1. 覆盖所有已知的 bug 修复相关场景
2. 参考 CHANGELOG.md 中 1.0.0 版本的修复记录
3. 确保测试可独立运行，不依赖外部环境
```

## 修复循环

SaCode 的 `test.fix` 工具实现了完整的修复循环：

1. **诊断**：分析失败测试的错误输出
2. **策略**：生成修复策略（修复代码 / 修复测试 / 两者都修）
3. **应用**：通过 `fs.edit` 应用修复
4. **验证**：重新运行 `test.run` 确认通过
5. **迭代**：如果仍有失败，重复步骤 1-4

```bash
# 一键修复所有失败测试
/test.fix

# 修复指定测试
/test.fix test_parse_config
```

## 工作流集成

### 在 CI 中使用

```yaml
# .github/workflows/test.yml
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Run tests
        run: sacode --quiet /test.run
```

### 在提交前使用

```bash
# 运行测试 + 代码审查（推荐提交前流程）
/test.run
/review-pr
```

### 在 /goal 中使用

```
/goal 所有测试通过
```

设置后，SaCode 会在每次任务执行完毕后自动检查测试是否通过，满足则标记任务完成。