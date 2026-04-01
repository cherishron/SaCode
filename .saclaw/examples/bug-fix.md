# Bug 修复示例

## 场景描述

修复搜索功能在处理特殊字符（如 `%`, `_`, `\`）时出现的查询错误和潜在的安全风险。

## Prime 阶段

### 1. 加载项目上下文

```bash
@IFLOW.md
@src/app/api/search/route.ts
@src/lib/search-utils.ts
@prisma/schema.prisma
```

### 2. 明确需求

```bash
"搜索功能在处理特殊字符（如 %、_、\）时会出现错误，需要修复这个问题。

问题描述：
- 用户输入包含特殊字符时，搜索返回错误
- 可能存在 SQL 注入风险
- 特殊字符未被正确转义

验收标准：
- 特殊字符能够正确处理
- 修复 SQL 注入风险
- 保持搜索功能正常工作
- 添加输入验证
- 添加错误处理
- 添加单元测试"
```

### 3. 问题复现

```bash
"请复现问题：
1. 访问搜索页面
2. 输入包含特殊字符的查询（如 'test%', 'test_', 'test\'）
3. 观察返回结果或错误信息
4. 记录错误堆栈和日志"
```

**复现步骤**：
```bash
# 测试用例 1：百分号
GET /api/search?query=test%

# 测试用例 2：下划线
GET /api/search?query=test_

# 测试用例 3：反斜杠
GET /api/search?query=test\

# 测试用例 4：组合特殊字符
GET /api/search?query=%test_\
```

### 4. 影响评估

```bash
"请评估问题的影响：
- 对用户的影响
- 对系统的影响
- 安全风险"
```

**影响评估**：
```markdown
## 影响评估

| 影响类型 | 严重程度 | 描述 |
|---------|---------|------|
| 用户体验 | 高 | 用户无法搜索包含特殊字符的内容 |
| 系统稳定性 | 中 | 可能导致查询错误和异常 |
| 安全风险 | 高 | 存在 SQL 注入风险 |
| 数据完整性 | 低 | 不会导致数据丢失 |
```

### 5. 制定计划

```bash
"请帮我制定详细的修复计划，包括：
1. 分析问题原因
2. 设计修复方案
3. 实现输入验证
4. 实现参数化查询
5. 添加错误处理
6. 编写测试用例
7. 更新文档"
```

**实施计划**：
```markdown
## 实施计划

### 阶段 1：问题分析
- [ ] 分析现有代码
- [ ] 识别问题根源
- [ ] 确定修复方案

### 阶段 2：实现修复
- [ ] 实现输入验证
- [ ] 实现参数化查询
- [ ] 添加特殊字符转义
- [ ] 添加错误处理

### 阶段 3：测试验证
- [ ] 编写单元测试
- [ ] 编写集成测试
- [ ] 执行回归测试
- [ ] 执行安全测试

### 阶段 4：文档更新
- [ ] 更新 API 文档
- [ ] 更新错误处理指南
- [ ] 添加问题说明
```

### 6. 评估风险

```bash
"请评估修复过程中可能遇到的风险：
- 回归风险
- 性能影响
- 兼容性问题"
```

**风险评估**：
```markdown
## 风险评估

| 风险 | 影响 | 概率 | 缓解措施 |
|------|------|------|----------|
| 功能回归 | 高 | 中 | 完整的回归测试 |
| 性能下降 | 中 | 低 | 性能测试和优化 |
| 兼容性问题 | 中 | 低 | 充分的测试覆盖 |
| 修复不完整 | 高 | 低 | 代码审查和安全审计 |
```

### 7. 确定技术方案

```bash
"请帮我选择合适的技术方案：
- 输入验证：Zod schema vs 手动验证？
- 查询方式：参数化查询 vs 字符串转义？
- 错误处理：自定义错误类 vs 标准错误？"
```

**技术方案评估**：
```markdown
## 技术方案评估

### 输入验证方案选择
**推荐方案**：Zod schema
**理由**：
- 类型安全
- 自动错误消息
- 易于维护
- 支持复杂验证规则

### 查询方式选择
**推荐方案**：Prisma 参数化查询
**理由**：
- 自动防止 SQL 注入
- 类型安全
- 性能优秀
- 易于使用

### 错误处理方案选择
**推荐方案**：自定义错误类 + 标准错误
**理由**：
- 统一的错误格式
- 便于错误追踪
- 支持错误分类
- 易于调试
```

## Implement 阶段

### 1. 分析问题

```bash
"请分析搜索功能的代码，找出特殊字符处理的问题：
- 查看 src/app/api/search/route.ts
- 查看 src/lib/search-utils.ts
- 识别不安全的查询方式"
```

**问题分析**：

**修复前的代码**（有问题）：
```typescript
// src/app/api/search/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const query = searchParams.get('query') || '';

  // 问题：直接使用 LIKE 查询，没有转义特殊字符
  const posts = await prisma.post.findMany({
    where: {
      OR: [
        { title: { contains: query } }, // 不安全
        { content: { contains: query } }, // 不安全
      ],
    },
  });

  return NextResponse.json({ success: true, data: posts });
}
```

**问题根源**：
1. 直接使用用户输入进行查询，没有转义特殊字符
2. `%` 和 `_` 在 SQL LIKE 查询中有特殊含义
3. `\` 可能导致转义问题
4. 存在 SQL 注入风险

### 2. 实现输入验证

```bash
"请实现输入验证：
- 验证查询参数
- 限制查询长度
- 过滤危险字符"
```

**代码实现**：
```typescript
// src/lib/search-utils.ts
import { z } from 'zod';

// 定义搜索查询的验证 schema
export const searchQuerySchema = z.object({
  query: z
    .string()
    .min(1, '查询不能为空')
    .max(100, '查询长度不能超过 100 个字符')
    .transform((value) => {
      // 移除前后空格
      return value.trim();
    }),
  tags: z
    .string()
    .optional()
    .transform((value) => {
      if (!value) return [];
      return value.split(',').map((tag) => tag.trim());
    }),
  category: z.string().optional(),
});

export type SearchQuery = z.infer<typeof searchQuerySchema>;

// 验证搜索查询
export function validateSearchQuery(params: URLSearchParams): SearchQuery {
  const query = searchQuerySchema.safeParse({
    query: params.get('query') || '',
    tags: params.get('tags') || undefined,
    category: params.get('category') || undefined,
  });

  if (!query.success) {
    throw new ValidationError('搜索参数无效', query.error.errors);
  }

  return query.data;
}

// 自定义验证错误类
export class ValidationError extends Error {
  constructor(
    message: string,
    public details: z.ZodIssue[]
  ) {
    super(message);
    this.name = 'ValidationError';
  }
}
```

### 3. 实现安全的查询

```bash
"请实现安全的查询：
- 使用 Prisma 的参数化查询
- 正确处理特殊字符
- 添加模糊搜索支持"
```

**修复后的代码**：
```typescript
// src/app/api/search/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { validateSearchQuery, ValidationError } from '@/lib/search-utils';

export async function GET(request: NextRequest) {
  try {
    // 验证输入
    const searchParams = request.nextUrl.searchParams;
    const { query, tags, category } = validateSearchQuery(searchParams);

    // 使用 Prisma 的参数化查询（自动防止 SQL 注入）
    const posts = await prisma.post.findMany({
      where: {
        AND: [
          // 搜索查询（Prisma 自动转义特殊字符）
          {
            OR: [
              { title: { contains: query, mode: 'insensitive' } },
              { content: { contains: query, mode: 'insensitive' } },
            ],
          },
          // 标签过滤
          ...(tags.length > 0
            ? [
                {
                  tags: {
                    some: {
                      name: { in: tags },
                    },
                  },
                },
              ]
            : []),
          // 分类过滤
          ...(category
            ? [
                {
                  category: {
                    name: category,
                  },
                },
              ]
            : []),
        ],
      },
      include: {
        author: {
          select: {
            id: true,
            name: true,
            avatar: true,
          },
        },
        tags: true,
        category: true,
      },
      orderBy: {
        createdAt: 'desc',
      },
      take: 20, // 限制结果数量
    });

    return NextResponse.json({
      success: true,
      data: posts,
      count: posts.length,
    });
  } catch (error) {
    // 处理验证错误
    if (error instanceof ValidationError) {
      return NextResponse.json(
        {
          success: false,
          error: '搜索参数无效',
          details: error.details,
        },
        { status: 400 }
      );
    }

    // 处理其他错误
    console.error('搜索错误:', error);
    return NextResponse.json(
      {
        success: false,
        error: '搜索失败，请稍后重试',
      },
      { status: 500 }
    );
  }
}
```

### 4. 添加特殊字符处理

```bash
"请添加特殊字符处理：
- 实现转义函数
- 处理 LIKE 查询的特殊字符"
```

**特殊字符处理**：
```typescript
// src/lib/search-utils.ts

// 转义 LIKE 查询的特殊字符
export function escapeLikePattern(pattern: string): string {
  // 转义 SQL LIKE 查询中的特殊字符
  return pattern.replace(/([\\%_])/g, '\\$1');
}

// 创建安全的 LIKE 查询模式
export function createLikePattern(query: string): string {
  // 转义特殊字符
  const escaped = escapeLikePattern(query);
  // 添加通配符
  return `%${escaped}%`;
}
```

### 5. 添加错误处理

```bash
"请添加错误处理：
- 处理验证错误
- 处理数据库错误
- 记录错误日志"
```

**错误处理实现**：
```typescript
// src/lib/error-handler.ts
import { Prisma } from '@prisma/client';

export class SearchError extends Error {
  constructor(message: string, public code: string) {
    super(message);
    this.name = 'SearchError';
  }
}

export function handleSearchError(error: unknown): SearchError {
  if (error instanceof ValidationError) {
    return new SearchError(error.message, 'VALIDATION_ERROR');
  }

  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    // 处理 Prisma 错误
    switch (error.code) {
      case 'P2001':
        return new SearchError('查询的记录不存在', 'NOT_FOUND');
      case 'P2002':
        return new SearchError('数据冲突', 'CONFLICT');
      case 'P2003':
        return new SearchError('外键约束失败', 'FOREIGN_KEY');
      default:
        return new SearchError('数据库错误', 'DATABASE_ERROR');
    }
  }

  if (error instanceof Error) {
    return new SearchError(error.message, 'UNKNOWN_ERROR');
  }

  return new SearchError('未知错误', 'UNKNOWN_ERROR');
}
```

### 6. 更新任务状态

```bash
"问题分析已完成"
"输入验证已完成"
"安全查询已完成"
"错误处理已完成"
"测试用例已编写"
```

## Validate 阶段

### 1. 单元测试

```bash
"请编写单元测试：
- 测试输入验证
- 测试特殊字符处理
- 测试错误处理"
```

**测试代码**：
```typescript
// src/lib/__tests__/search-utils.test.ts
import { describe, it, expect } from '@jest/globals';
import {
  validateSearchQuery,
  escapeLikePattern,
  createLikePattern,
  ValidationError,
} from '../search-utils';

describe('validateSearchQuery', () => {
  it('应该验证有效的查询', () => {
    const params = new URLSearchParams({ query: 'test' });
    const result = validateSearchQuery(params);

    expect(result.query).toBe('test');
  });

  it('应该拒绝空查询', () => {
    const params = new URLSearchParams({ query: '' });

    expect(() => validateSearchQuery(params)).toThrow(ValidationError);
  });

  it('应该拒绝过长的查询', () => {
    const params = new URLSearchParams({ query: 'a'.repeat(101) });

    expect(() => validateSearchQuery(params)).toThrow(ValidationError);
  });

  it('应该正确处理标签', () => {
    const params = new URLSearchParams({
      query: 'test',
      tags: 'react,nextjs',
    });
    const result = validateSearchQuery(params);

    expect(result.tags).toEqual(['react', 'nextjs']);
  });

  it('应该正确处理特殊字符', () => {
    const params = new URLSearchParams({ query: 'test%_\\' });
    const result = validateSearchQuery(params);

    expect(result.query).toBe('test%_\\');
  });
});

describe('escapeLikePattern', () => {
  it('应该转义百分号', () => {
    expect(escapeLikePattern('test%')).toBe('test\\%');
  });

  it('应该转义下划线', () => {
    expect(escapeLikePattern('test_')).toBe('test\\_');
  });

  it('应该转义反斜杠', () => {
    expect(escapeLikePattern('test\\')).toBe('test\\\\');
  });

  it('应该转义组合特殊字符', () => {
    expect(escapeLikePattern('%_\\')).toBe('\\%\\_\\\\');
  });
});

describe('createLikePattern', () => {
  it('应该创建正确的 LIKE 模式', () => {
    expect(createLikePattern('test')).toBe('%test%');
  });

  it('应该转义特殊字符', () => {
    expect(createLikePattern('test%')).toBe('%test\\%%');
  });
});
```

### 2. 集成测试

```bash
"请编写集成测试：
- 测试搜索 API 端点
- 测试特殊字符处理
- 测试错误响应"
```

**集成测试代码**：
```typescript
// src/app/api/search/route.test.ts
import { describe, it, expect, beforeEach } from '@jest/globals';
import { GET } from './route';

describe('GET /api/search', () => {
  beforeEach(() => {
    // 设置测试数据库
  });

  it('应该返回搜索结果', async () => {
    const request = new Request('http://localhost:3000/api/search?query=test');
    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(Array.isArray(data.data)).toBe(true);
  });

  it('应该正确处理特殊字符', async () => {
    const specialChars = ['%', '_', '\\', '%_\\'];

    for (const char of specialChars) {
      const request = new Request(
        `http://localhost:3000/api/search?query=${encodeURIComponent(char)}`
      );
      const response = await GET(request);

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
    }
  });

  it('应该拒绝空查询', async () => {
    const request = new Request('http://localhost:3000/api/search?query=');
    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error).toBe('搜索参数无效');
  });

  it('应该处理数据库错误', async () => {
    // 模拟数据库错误
    const request = new Request('http://localhost:3000/api/search?query=test');
    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(500);
    expect(data.success).toBe(false);
  });
});
```

### 3. 边界条件测试

```bash
"请测试边界条件：
- 测试空结果
- 测试最大长度查询
- 测试特殊字符组合
- 测试并发请求"
```

**边界测试用例**：
```typescript
describe('边界条件测试', () => {
  it('应该正确处理空结果', async () => {
    const request = new Request(
      'http://localhost:3000/api/search?query=nonexistent'
    );
    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.data).toEqual([]);
    expect(data.count).toBe(0);
  });

  it('应该正确处理最大长度查询', async () => {
    const maxLengthQuery = 'a'.repeat(100);
    const request = new Request(
      `http://localhost:3000/api/search?query=${maxLengthQuery}`
    );
    const response = await GET(request);

    expect(response.status).toBe(200);
  });

  it('应该拒绝超过最大长度的查询', async () => {
    const tooLongQuery = 'a'.repeat(101);
    const request = new Request(
      `http://localhost:3000/api/search?query=${tooLongQuery}`
    );
    const response = await GET(request);

    expect(response.status).toBe(400);
  });

  it('应该正确处理所有特殊字符组合', async () => {
    const combinations = [
      '%',
      '_',
      '\\',
      '%_',
      '_%',
      '\\%',
      '%\\',
      '_\\',
      '\\_',
      '%_\\',
    ];

    for (const combo of combinations) {
      const request = new Request(
        `http://localhost:3000/api/search?query=${encodeURIComponent(combo)}`
      );
      const response = await GET(request);

      expect(response.status).toBe(200);
    }
  });
});
```

### 4. 安全测试

```bash
"请执行安全测试：
- 测试 SQL 注入防护
- 测试 XSS 防护
- 测试输入验证"
```

**安全测试用例**：
```typescript
describe('安全测试', () => {
  it('应该防止 SQL 注入', async () => {
    const sqlInjectionAttempts = [
      "test' OR '1'='1",
      "test' DROP TABLE posts--",
      "test' UNION SELECT * FROM users--",
      "test'; DELETE FROM posts WHERE '1'='1'--",
    ];

    for (const attempt of sqlInjectionAttempts) {
      const request = new Request(
        `http://localhost:3000/api/search?query=${encodeURIComponent(attempt)}`
      );
      const response = await GET(request);

      // 应该返回 200，但不会执行恶意 SQL
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
    }
  });

  it('应该正确转义 LIKE 通配符', async () => {
    const wildcardAttempts = [
      'test%',
      'test_',
      'test\\',
      '%test%',
      '_test_',
    ];

    for (const attempt of wildcardAttempts) {
      const request = new Request(
        `http://localhost:3000/api/search?query=${encodeURIComponent(attempt)}`
      );
      const response = await GET(request);

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
    }
  });
});
```

### 5. 回归测试

```bash
"请执行回归测试：
- 测试正常搜索功能
- 测试标签过滤
- 测试分类过滤
- 测试组合查询"
```

**回归测试用例**：
```typescript
describe('回归测试', () => {
  it('应该正常执行搜索', async () => {
    const request = new Request('http://localhost:3000/api/search?query=react');
    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
  });

  it('应该支持标签过滤', async () => {
    const request = new Request(
      'http://localhost:3000/api/search?query=test&tags=react,nextjs'
    );
    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
  });

  it('应该支持分类过滤', async () => {
    const request = new Request(
      'http://localhost:3000/api/search?query=test&category=技术'
    );
    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
  });
});
```

### 6. TypeScript 类型检查

```bash
!npx tsc --noEmit

"请检查是否有类型错误，并修复它们"
```

### 7. 代码风格验证

```bash
!npx eslint .
!npx prettier --write .

"请检查代码风格是否符合项目规范"
```

### 8. 构建验证

```bash
!npm run build

"请检查构建是否有错误，并修复它们"
```

### 9. 更新文档

```bash
"请更新文档：
- 更新 docs/technical/api.md
- 更新 docs/technical/error-handling.md
- 添加问题说明和修复记录"
```

## 完成检查清单

### Prime 阶段
- [x] 已加载项目上下文
- [x] 问题描述已明确
- [x] 问题已复现
- [x] 影响评估已完成
- [x] 详细计划已制定
- [x] 风险和依赖已评估
- [x] 技术方案已确定

### Implement 阶段
- [x] 问题分析已完成
- [x] 输入验证已实现
- [x] 安全查询已实现
- [x] 特殊字符处理已实现
- [x] 错误处理已实现
- [x] 测试用例已编写

### Validate 阶段
- [x] 单元测试已通过
- [x] 集成测试已通过
- [x] 边界条件测试已通过
- [x] 安全测试已通过
- [x] 回归测试已通过
- [x] TypeScript 类型检查通过
- [x] 代码风格验证通过
- [x] 构建验证通过
- [x] 文档已更新

## 总结

通过 PIV 工作流，我们成功修复了搜索功能的特殊字符处理问题：

1. **Prime 阶段** - 明确问题描述，复现问题，评估影响，制定修复计划，评估风险，选择技术方案
2. **Implement 阶段** - 分析问题根源，实现输入验证，实现安全的参数化查询，添加特殊字符处理，添加错误处理
3. **Validate 阶段** - 编写全面的测试用例，执行安全测试和回归测试，确保修复有效且无副作用

### 关键成果

- ✅ 修复了特殊字符处理问题
- ✅ 消除了 SQL 注入风险
- ✅ 添加了输入验证
- ✅ 添加了错误处理
- ✅ 编写了完整的测试覆盖
- ✅ 更新了相关文档

### 修复前后对比

**修复前**：
- 直接使用用户输入进行查询
- 没有输入验证
- 存在 SQL 注入风险
- 特殊字符导致查询错误

**修复后**：
- 使用 Prisma 参数化查询
- 完整的输入验证（Zod schema）
- 自动防止 SQL 注入
- 正确处理特殊字符
- 完善的错误处理

### 技术要点

- 使用 Zod 进行输入验证
- 使用 Prisma 参数化查询防止 SQL 注入
- 正确转义 LIKE 查询的特殊字符
- 实现自定义错误类
- 编写全面的测试覆盖

## 参考资料

- [Javisk 方法论概述](../SKILL.md)
- [Prime 阶段指南](../templates/prime-phase.md)
- [Implement 阶段指南](../templates/implement-phase.md)
- [Validate 阶段指南](../templates/validate-phase.md)
- [错误处理指南](../templates/error-handling.md)
- [最佳实践](../resources/best-practices.md)
- [Prisma 文档](https://www.prisma.io/docs)
- [Zod 文档](https://zod.dev)
- [OWASP SQL 注入防护](https://owasp.org/www-community/attacks/SQL_Injection)