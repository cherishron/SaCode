# PCIV 工作流

> 本文件是 iFlow CLI 的标准入口文件，链接到完整的 SKILL.md 技能定义。

## 快速开始

### 加载技能
```
@SKILL.md
```

### 启动工作流
```
/pciv-prime
```

## 工作流阶段

| 阶段 | 命令 | 描述 |
|------|------|------|
| Prime | `/pciv-prime` | 准备阶段：加载上下文、识别技术栈 |
| Clarify | `/pciv-clarify` | 澄清阶段：确认需求、完善方案 |
| Implement | `/pciv-implement` | 实施阶段：执行任务、编写代码 |
| Validate | `/pciv-validate` | 验证阶段：质量检查、测试验证 |

## 常用命令

| 命令 | 描述 |
|------|------|
| `/pciv-check` | 快速质量检查 |
| `/pciv-status` | 查看当前状态 |
| `/pciv-mistake` | 记录错题 |

## 目录结构

```
├── SKILL.md              # 完整技能定义
├── templates/            # 阶段模板
├── examples/             # 示例场景
├── resources/            # 参考资源
└── docs/                 # 文档和状态
```

## 更多信息

详见 [SKILL.md](./SKILL.md)
