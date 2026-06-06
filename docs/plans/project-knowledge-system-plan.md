# 项目级知识沉淀系统方案

## 背景

SaCode 当前已经具备项目知识沉淀的基础能力：

- 项目级 wiki：`.sacode/wiki/`
- 分类记忆文件：`memory.md`、`preferences.md`、`workflows.md`、`decisions.md`
- 记忆索引：`index.json`
- 会话摘要：`.sacode/sessions/*.json`
- 失误记录：`.sacode/mistakes.json`
- CLI 能力：`/memory`、`/wiki`、`/mistakes`

现阶段的问题不在于“能不能记”，而在于“记下来的知识能不能稳定帮助不同用户、不同项目、不同任务”。

因此，下一阶段目标是把现有 wiki / memory 能力升级成一套真正可复用的项目级知识系统。

## 核心目标

1. 让 SaCode 在不同项目里具备长期项目记忆
2. 让知识沉淀能直接帮助执行任务，而不是停留在文档堆积
3. 严格区分用户级偏好和项目级知识，避免跨项目污染
4. 通过自动学习、人工审核、命中反馈，形成持续进化的知识闭环

## 适用价值

该系统面向两类价值场景：

1. 用户在同一个项目内长期使用 SaCode
2. 用户在多个不同项目之间切换使用 SaCode

系统应当帮助用户减少以下重复成本：

- 重复说明项目启动方式
- 重复说明测试和发布流程
- 重复踩历史已知错误
- 重复解释目录边界、模块职责和特殊限制

## 设计原则

1. 只沉淀长期有效的知识
2. 严格区分用户级和项目级
3. 自动学习生成候选，人工确认控制质量
4. 知识使用必须和任务场景相关联
5. 低价值、过时、错误内容必须可归档或淘汰

## 目标结构

在现有 `.sacode/wiki/` 结构基础上扩展为：

```text
.sacode/wiki/
  memory.md
  preferences.md
  workflows.md
  decisions.md
  project-profile.md
  commands.md
  pitfalls.md
  modules.md
  release.md
  index.json
```

### 文件职责

`memory.md`
- 杂项长期有效知识

`preferences.md`
- 用户偏好和项目偏好

`workflows.md`
- 稳定的执行流程和协作流程

`decisions.md`
- 重要决策、长期约束、架构共识

`project-profile.md`
- 项目画像：技术栈、入口、目录结构、依赖方向、关键脚本

`commands.md`
- 常用命令、构建命令、测试命令、运行命令、排查命令

`pitfalls.md`
- 已知坑、常见失败模式、修复办法

`modules.md`
- 各模块职责、依赖关系、边界约束

`release.md`
- 发布流程、校验步骤、平台差异、版本管理规则

## 三层知识模型

### 1. 事实层

记录项目客观事实：

- 技术栈
- 模块结构
- CLI 入口
- 构建测试命令
- 目录边界
- 平台差异

### 2. 经验层

记录项目内高复用经验：

- 常见错误和修复路径
- 哪些命令组合可靠
- 哪些路径或流程容易出问题
- 哪些改动顺序更稳定

### 3. 策略层

记录执行策略：

- 哪些任务优先走什么流程
- 哪些工具需要审批
- 哪些文件必须谨慎修改
- 哪些操作应优先做验证

## 分层范围

### 用户级知识

用户级知识跨项目生效，包括：

- 输出偏好
- 工作方式偏好
- 协作习惯
- 常用审核风格
- 长期稳定的执行习惯

### 项目级知识

项目级知识仅在当前仓库生效，包括：

- 项目结构
- 构建方式
- 测试流程
- 发布流程
- 常见坑
- 模块边界
- 仓库专属规则

系统必须确保项目级知识不污染其他项目。

## 自动学习机制

### 来源 1：命令执行学习

从成功执行的关键命令中提炼候选知识：

- `cargo build`
- `cargo test`
- `npm publish`
- 发布校验脚本
- 项目自定义脚本

提炼目标：

- 哪个命令在什么目录下执行
- 命令之间的先后顺序
- 成功执行依赖的前提条件

### 来源 2：错误修复学习

当一次失败后后续修复成功，自动提炼：

- 失败模式
- 根因
- 修复路径
- 适用范围

优先写入 `pitfalls.md` 或 `workflows.md`。

### 来源 3：会话摘要学习

从 `.sacode/sessions/*.json` 中提取高频稳定结论：

- 多次重复的操作流程
- 高频出现的限制条件
- 多次复用的修复路径

### 来源 4：代码结构学习

自动扫描项目并提炼：

- 项目画像
- 模块职责
- 入口文件
- 核心脚本
- 风险目录

写入 `project-profile.md` 和 `modules.md`。

## 候选知识机制

当前 `MemoryStatus` 建议从：

- `Active`
- `Archived`

扩展为：

- `Candidate`
- `Active`
- `Archived`
- `Rejected`

### 状态流转

1. 自动发现知识 -> `Candidate`
2. 用户确认或多次命中验证 -> `Active`
3. 过时或被替代 -> `Archived`
4. 判断错误 -> `Rejected`

这样可以把自动学习和人工控制结合起来，避免把低质量内容直接写进生效记忆。

## 命中反馈机制

建议给 `MemoryIndexEntry` 扩展以下字段：

```rust
pub struct MemoryIndexEntry {
    pub id: String,
    pub kind: MemoryKind,
    pub scope: MemoryScope,
    pub source: MemoryEntrySource,
    pub status: MemoryStatus,
    pub confidence: Option<f32>,
    pub content: String,
    pub context: String,
    pub file_name: String,
    pub created_at: String,

    pub tags: Vec<String>,
    pub hit_count: u64,
    pub success_count: u64,
    pub failure_count: u64,
    pub last_hit_at: Option<String>,
    pub last_used_session: Option<String>,
    pub related_paths: Vec<String>,
    pub related_commands: Vec<String>,
}
```

### 作用

1. 高频知识优先注入 prompt
2. 长期不命中知识自动降权
3. 错误知识可快速识别和归档
4. 形成知识效果评估闭环

## 项目画像生成器

建议新增自动画像能力，用于生成 `project-profile.md`。

### 建议命令

```bash
sacode memory profile
```

或

```bash
sacode wiki rebuild
```

### 画像内容

- 项目类型
- 包管理方式
- 模块结构
- 入口命令
- 运行方式
- 测试方式
- 发布方式
- 平台兼容信息
- 高风险目录
- 常用脚本

### 对 SaCode 自身仓库的适配示例

应能自动提炼出：

- Rust workspace 项目
- `interfaces/* -> runtime -> kernel` 依赖方向
- `npm-package/` 为发布包目录
- 根 `Cargo.toml` 为版本源头
- 发布前需同步 Linux / Windows 二进制
- 发布校验依赖 `node scripts/check-release.js`

## 工作流知识升级

建议将 `workflows.md` 从静态记录升级为可执行工作流知识。

### 示例：发布工作流

```text
1. 拉取最新代码
2. bump version
3. 构建 Linux 二进制
4. 构建 Windows 二进制
5. 刷新 npm-package/platforms/
6. 运行发布校验
7. 发布到 npm
8. 验证 tarball 可访问性
9. 验证 Windows 安装结果
```

后续当用户输入“发版”时，系统可以优先命中这套流程，而不是每次从头推理。

## mistakes 与 memory 联动

当前 `.sacode/mistakes.json` 是原始失败记录。

建议形成两层联动：

1. mistakes 保存原始失败事件
2. memory 保存提炼后的复用经验

### 自动提炼规则

当同类错误满足以下条件时，生成 `Candidate` 条目：

- 重复出现 3 次以上
- 修复路径稳定
- 对任务完成率有明显影响

提炼结果优先写入：

- `pitfalls.md`
- `workflows.md`
- `release.md`

## Prompt 注入策略

当前 wiki 更偏摘要聚合。

建议升级为按任务场景选择性注入：

### 发版任务

优先注入：

- `release.md`
- `commands.md`
- 相关 `pitfalls`

### 调试任务

优先注入：

- `pitfalls.md`
- 高频 mistakes 提炼知识
- 相关 workflows

### 改代码任务

优先注入：

- `modules.md`
- `decisions.md`
- `project-profile.md`

### 初始化 / 配置任务

优先注入：

- `project-profile.md`
- `workflows.md`
- `preferences.md`

目标是缩短 prompt，提升知识命中精度。

## CLI / TUI 能力扩展建议

建议新增命令：

```bash
sacode memory learn
sacode memory profile
sacode memory candidates
sacode memory approve <id>
sacode memory reject <id>
sacode memory rebuild
sacode memory stats
sacode wiki doctor
```

### 用途说明

`memory learn`
- 从 recent sessions / mistakes / commands 生成候选知识

`memory profile`
- 重建项目画像

`memory candidates`
- 查看待确认的候选知识

`memory approve <id>`
- 将候选知识转为 Active

`memory reject <id>`
- 拒绝低质量候选知识

`memory rebuild`
- 重建索引和汇总

`memory stats`
- 查看命中率、条目数、衰减情况

`wiki doctor`
- 检查 wiki 文件完整性、索引状态和结构质量

## 实施阶段

### P0：先跑通候选知识闭环

目标：让知识开始自动长出来。

范围：

- 新增 `Candidate` / `Rejected` 状态
- 从 `mistakes.json` 和 recent sessions 自动生成候选知识
- 新增 `memory candidates / approve / reject`
- 新增 `project-profile.md` 自动生成

### P1：让知识影响执行质量

目标：让知识真正参与任务执行。

范围：

- 场景化 prompt 注入
- 记录 hit_count / success_count / failure_count
- 高频知识前置
- 自动归档低价值条目

### P2：做成项目协作中枢

目标：让知识系统成为项目助手的长期工作底盘。

范围：

- 工作流模板化
- 模块画像自动维护
- 修复模板化
- 会话恢复与知识联动

## 优先级建议

最值得优先落地的三项：

1. `project-profile.md` 自动生成
2. `mistakes -> candidate memory` 自动提炼
3. `memory candidates / approve / reject` 审核闭环

这三项完成后，系统会从“能记东西”升级成“会长经验”。

## 成功标准

该方案上线后，应满足以下目标：

1. 用户在同一项目重复使用时，重复解释明显减少
2. 常见错误的重复发生率下降
3. 发版、调试、改代码任务的命中知识明显提升
4. 不同项目之间知识不串台
5. 低质量知识不会无限堆积

## 结论

项目级知识沉淀对 SaCode 面向真实用户和真实项目使用是有实际价值的。

它的关键不在“记录更多内容”，而在：

- 记录长期有效知识
- 区分用户级和项目级
- 让知识在正确时机参与执行
- 通过命中反馈持续优化质量

只要按这个方向推进，SaCode 会逐步从“能执行任务的工具”进化成“真正理解当前项目的开发助手”。
