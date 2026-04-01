# 博客搜索功能开发示例

## 场景描述

为博客系统实现文章搜索功能，支持全文搜索、标签过滤和分类过滤。

## Prime 阶段

### 1. 加载项目上下文

```bash
@IFLOW.md
@docs/core/architecture.md
@docs/technical/api.md
```

### 2. 明确需求

```bash
"我需要实现文章搜索功能，要求：
1. 支持全文搜索
2. 支持按标签过滤
3. 支持按分类过滤
4. 返回结果按相关性排序
5. 响应时间 < 500ms

验收标准：
- API 响应时间 < 500ms
- 搜索结果准确率 > 95%
- 支持中文分词
- 支持模糊搜索"
```

### 3. 制定计划

```bash
"请帮我制定详细的实现计划，包括：
1. 数据库模型调整（添加全文搜索索引）
2. API 路由创建（src/app/api/search/route.ts）
3. 前端组件开发（搜索输入框和结果列表）
4. 测试验证（单元测试和集成测试）
5. 文档更新（API 文档和用户手册）"
```

**实施计划**：
```markdown
## 实施计划

### 阶段 1：数据库模型调整
- [ ] 在 Post 模型中添加全文搜索索引
- [ ] 生成 Prisma Client
- [ ] 创建数据库迁移
- [ ] 应用数据库迁移

### 阶段 2：API 路由创建
- [ ] 创建搜索 API 路由文件
- [ ] 实现搜索逻辑
- [ ] 实现标签过滤
- [ ] 实现分类过滤
- [ ] 实现结果排序

### 阶段 3：前端组件开发
- [ ] 创建 SearchInput 组件
- [ ] 创建 SearchResults 组件
- [ ] 创建 SearchPage 页面
- [ ] 集成到导航栏

### 阶段 4：测试验证
- [ ] 编写单元测试
- [ ] 编写集成测试
- [ ] 性能测试
- [ ] 用户测试

### 阶段 5：文档更新
- [ ] 更新 API 文档
- [ ] 更新架构文档
- [ ] 更新开发指南
- [ ] 更新 README
```

### 4. 评估风险

```bash
"请评估实现搜索功能可能遇到的风险：
- 性能问题（大量数据时）
- 数据库索引优化
- 中文分词处理
- 搜索结果排序算法"
```

**风险评估**：
```markdown
## 风险评估

| 风险 | 影响 | 概率 | 缓解措施 |
|------|------|------|----------|
| 性能问题 | 高 | 中 | 使用数据库索引、缓存、分页 |
| 中文分词 | 中 | 低 | 使用成熟的分词库 |
| 排序算法 | 中 | 中 | 使用相关性评分算法 |
| 数据迁移 | 低 | 低 | 备份数据、分步迁移 |
```

### 5. 确定技术方案

```bash
"请帮我选择合适的技术方案：
- 搜索引擎：MySQL 全文搜索 vs MeiliSearch？
- 前端组件：Tailwind CSS vs 第三方库？
- API 路由：API Routes vs Server Actions？"
```

**技术方案评估**：
```markdown
## 技术方案评估

### 搜索引擎选择
**推荐方案**：MySQL 全文搜索
**理由**：
- 无需额外服务
- 性能满足当前需求
- 维护成本低
- 易于集成

### 前端组件选择
**推荐方案**：Tailwind CSS + React 原生组件
**理由**：
- 无需额外依赖
- 样式灵活可控
- 性能优秀
- 符合项目规范

### API 路由选择
**推荐方案**：API Routes
**理由**：
- 功能完整
- 易于测试
- 支持中间件
- 符合项目规范
```

## Implement 阶段

### 1. 实施数据库模型调整

```bash
# 读取现有文件
@prisma/schema.prisma

# 修改文件
"请在 Post 模型中添加全文搜索索引：
@@index([title, content, type: fulltext])"

# 验证修改
!npm run prisma:generate
!npm run prisma:migrate

# 确认完成
"数据库模型调整已完成"
```

### 2. 创建 API 路由

```bash
# 创建搜索 API 路由
"请创建搜索 API 路由文件：src/app/api/search/route.ts

功能：
- 接收搜索查询参数（query, tags, category）
- 执行全文搜索
- 返回排序后的结果
- 处理错误情况

接口：
GET /api/search?query=关键词&tags=标签&category=分类

响应：
{
  success: boolean
  data: Post[]
  error: string | null
}"
```

### 3. 创建前端组件

```bash
# 创建 SearchInput 组件
"请创建 SearchInput 组件：src/components/SearchInput.tsx

功能：
- 搜索输入框
- 实时搜索建议
- 搜索历史记录
- 清除搜索按钮"

# 创建 SearchResults 组件
"请创建 SearchResults 组件：src/components/SearchResults.tsx

功能：
- 搜索结果列表
- 加载状态
- 空状态提示
- 分页功能"

# 创建 SearchPage 页面
"请创建 SearchPage 页面：src/app/search/page.tsx

功能：
- 搜索页面布局
- 集成 SearchInput 和 SearchResults
- URL 参数管理
- SEO 优化"
```

### 4. 集成到应用

```bash
# 集成到导航栏
"请将搜索功能集成到应用中：
- 在导航栏添加搜索按钮
- 创建搜索页面路由
- 实现搜索结果展示"
```

### 5. 更新任务状态

```bash
"数据库模型调整已完成"
"API 路由创建已完成"
"前端组件开发已完成"
"搜索功能集成已完成"
```

## Validate 阶段

### 1. TypeScript 类型检查

```bash
!npx tsc --noEmit

"请检查是否有类型错误，并修复它们"
```

### 2. 代码风格验证

```bash
!npx eslint .
!npx prettier --write .

"请检查代码风格是否符合项目规范"
```

### 3. 功能测试

```bash
"请测试搜索 API 路由是否正常工作：
- 测试全文搜索
- 测试标签过滤
- 测试分类过滤
- 测试结果排序
- 测试错误处理"

"请测试搜索组件的用户交互：
- 测试搜索输入
- 测试搜索建议
- 测试搜索结果
- 测试分页功能"
```

### 4. 性能测试

```bash
"请测试搜索功能的性能：
- 测试响应时间是否 < 500ms
- 测试大量数据时的性能
- 测试并发请求的处理能力"
```

### 5. 构建验证

```bash
!npm run build

"请检查构建是否有错误，并修复它们"
```

### 6. 更新文档

```bash
"请更新 docs/technical/api.md，添加搜索 API 的文档"
"请更新 docs/core/architecture.md，反映搜索功能的架构变更"
"请更新 docs/technical/development.md，添加搜索功能的开发指南"
"请更新 README.md，添加搜索功能的说明"
```

## 完成检查清单

### Prime 阶段
- [x] 已加载项目上下文
- [x] 需求和验收标准已明确
- [x] 详细计划已制定
- [x] 风险和依赖已评估
- [x] 技术方案已确定

### Implement 阶段
- [x] 数据库模型调整已完成
- [x] API 路由创建已完成
- [x] 前端组件开发已完成
- [x] 搜索功能集成已完成
- [x] 相关文档已更新

### Validate 阶段
- [x] TypeScript 类型检查通过
- [x] 代码风格验证通过
- [x] 功能测试通过
- [x] 性能测试通过
- [x] 构建验证通过
- [x] 文档已更新

## 总结

通过 PIV 工作流，我们成功实现了博客搜索功能：

1. **Prime 阶段** - 充分理解需求，制定详细计划，评估风险，选择合适的技术方案
2. **Implement 阶段** - 渐进式实现，每步验证，确保质量
3. **Validate 阶段** - 全面验证，确保功能正确、性能达标、文档完整

整个流程确保了代码质量和开发效率，同时提供了清晰的可追溯性。

## 参考资料

- [Javisk 方法论概述](../SKILL.md)
- [Prime 阶段指南](../templates/prime-phase.md)
- [Implement 阶段指南](../templates/implement-phase.md)
- [Validate 阶段指南](../templates/validate-phase.md)