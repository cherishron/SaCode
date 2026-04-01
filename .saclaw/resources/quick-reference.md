# 快速参考

## PIV 三阶段

### Prime（准备）
- 加载项目上下文
- 明确需求和验收标准
- 制定详细计划
- 评估风险和依赖
- 确定技术方案

### Implement（实施）
- 查看任务状态
- 选择待办任务
- 使用工具完成任务
- 验证结果
- 更新任务状态
- 更新文档

### Validate（验证）
- TypeScript 类型检查
- 代码风格验证
- 功能测试
- 构建验证
- 更新文档

## 常用命令

### 类型检查
```bash
!npx tsc --noEmit
```

### 代码风格
```bash
!npx eslint .
!npx prettier --write .
```

### 测试
```bash
!npm test
```

### 构建
```bash
!npm run build
```

### 数据库
```bash
!npm run prisma:generate
!npm run prisma:migrate
```

## 文件路径

### 项目文档
```
IFLOW.md
docs/core/architecture.md
docs/technical/api.md
```

### 应用代码
```
src/app/                    # 页面和 API
src/components/             # 组件
src/lib/                    # 工具函数
```

### 数据库
```
prisma/schema.prisma        # 数据模型
```

## 常见错误

### 类型错误
```bash
!npx tsc --noEmit
"请检查并修复类型错误"
```

### 构建错误
```bash
!npm run build
"请分析构建错误的原因"
```

### 测试失败
```bash
!npm test
"请查看测试失败的原因"
```

## 检查清单

### Prime 阶段
- [ ] 已加载项目上下文
- [ ] 需求和验收标准已明确
- [ ] 详细计划已制定
- [ ] 风险和依赖已评估
- [ ] 技术方案已确定

### Implement 阶段
- [ ] 所有任务已完成
- [ ] 所有验证通过
- [ ] 相关文档已更新

### Validate 阶段
- [ ] TypeScript 类型检查通过
- [ ] 代码风格验证通过
- [ ] 功能测试通过
- [ ] 构建验证通过
- [ ] 文档已更新

## 参考资料

- [Javisk 方法论概述](../SKILL.md)
- [完整工作流模板](../templates/workflow-template.md)
- [命令映射表](./commands-mapping.md)