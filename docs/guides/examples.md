# SaCode 示例集

本文档提供可以直接复制的命令和提示词组合，目标是让你更快进入可用状态。

## 1. 仓库理解

### 总结真实入口和分层

```bash
sacode "总结这个仓库的真实入口、主要分层和当前高风险模块"
```

### 要求优先看可执行真源

```bash
sacode "先读 Cargo.toml、README、CI workflow 和主入口，再解释仓库如何运行"
```

### 聚焦某个目录

```bash
sacode "只看 runtime/src/agents，解释这一层现在负责什么"
```

## 2. 风险分析

### 找最可能的回归点

```bash
sacode "找出当前仓库最容易引发回归的模块，并说明原因"
```

### 结合当前 diff 看风险

```bash
git diff | sacode "根据这份改动指出最可能的风险点和建议验证顺序"
```

### 聚焦某个包的验证路径

```bash
sacode "如果改动只影响 sacode-runtime，建议我先跑哪些测试"
```

## 3. 方案设计

### 先做规划

```bash
sacode "设计一套改进 TUI 任务状态流转的方案" --mode plan
```

### 聚焦最小改动路径

```bash
sacode "为这个问题给出最小可行修复路径，尽量少改文件" --mode plan
```

### 输出验证顺序

```bash
sacode "给这个方案附上建议验证顺序，按性价比排序" --mode plan
```

## 4. 代码修改

### 常规受控修改

```bash
sacode "修复当前 /models 选择后 provider 和 model 不同步的问题" --mode build
```

### 指定只改一小块

```bash
sacode "只修改 interfaces/cli/src/tui 相关文件，修复输入框光标定位问题" --mode build
```

### 高确定性批处理

```bash
sacode "批量整理 docs 下 Markdown 标题层级和导航链接" --mode yolo
```

## 5. 文档工作流

### 找文档缺口

```bash
sacode "评估当前文档体系最薄弱的部分，并给出补齐建议"
```

### 根据改动更新文档

```bash
git diff | sacode "根据这些改动判断 README、API 文档和教程需要同步哪些内容"
```

### 只补命令参考

```bash
sacode "整理当前 CLI 和 TUI 的高频命令，补成命令速查文档"
```

## 6. 提交前检查

### 让 SaCode 给验证顺序

```bash
sacode "根据这个仓库的 CI 规则，给我最合理的本地验证顺序"
```

### 总结本次改动

```bash
git diff | sacode "总结这次改动的核心变化、风险点和建议测试"
```

### 生成提交说明

```bash
git diff | sacode "根据改动生成一条简洁准确的 commit message"
```

## 7. 管道模式

### 总结一个文件

```bash
cat README.md | sacode "总结这个文件的主要信息"
```

### 总结 Git 差异

```bash
git diff | sacode "总结这次改动做了什么，重点说为什么"
```

### 看目录结构

```bash
ls -la | sacode "根据目录输出判断这个项目的主要结构和用途"
```

## 8. TUI 示例

### 首次进入后的最短路径

```text
/doctor
/connect
/models
```

然后输入：

```text
解释这个仓库的真实入口和开发验证顺序
```

### 用记忆沉淀流程

```text
/memory append 发布前按 cargo test --workspace -> cargo build --release -> node scripts/check-release.js 顺序验证 --type workflow
```

### 查看知识加载情况

```text
/wiki
```

## 9. 初始化项目

### 轻量初始化

```bash
sacode init
```

### 深度初始化

```bash
sacode init-deep
```

### 初始化后立即追问

```bash
sacode "基于当前 AGENTS.md，指出这个仓库最重要的协作约束"
```

## 10. 运维与升级

### 看当前状态

```bash
sacode status
```

### 诊断配置

```bash
sacode doctor
```

### 检查更新

```bash
sacode update --check
```

### 执行更新

```bash
sacode update
```

## 11. 好用的提示词模板

### 解释型

```text
先读最关键的入口和配置文件，再解释这个功能是怎么串起来的。
```

### 排错型

```text
先给我最可能的三个根因，再给最省时的验证顺序。
```

### 重构型

```text
优先给出最小正确改动，避免引入新抽象，除非复用价值明确。
```

### 文档型

```text
只保留当前实现可验证的内容，删掉旧设计稿和无法确认的描述。
```
