# Search API

> 全文搜索端点文档

---

## Base URL

```
http://localhost:3000/api
```

---

## Endpoints Overview

| Endpoint | Method | Description | Auth |
|----------|--------|-------------|------|
| `/chat/search` | GET | Search messages | Yes |
| `/chat/search/suggestions` | GET | Get search suggestions | Yes |

---

## GET /chat/search

全文搜索消息内容。

### Request

```http
GET /api/chat/search?q=TypeScript&startDate=2026-01-01&endDate=2026-03-22&highlight=true&facets=true&limit=20&offset=0
Authorization: Bearer <token>
```

### Query Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| q | string | - | 搜索关键词（必填） |
| startDate | string | - | 开始日期 (YYYY-MM-DD) |
| endDate | string | - | 结束日期 (YYYY-MM-DD) |
| highlight | boolean | false | 高亮匹配关键词 |
| facets | boolean | false | 返回聚合统计 |
| limit | number | 20 | 每页数量 |
| offset | number | 0 | 偏移量 |

### Response

**200 OK**

```json
{
  "results": [
    {
      "message": {
        "id": "msg_123",
        "sessionId": "sess_456",
        "role": "assistant",
        "content": "TypeScript is a typed superset of JavaScript...",
        "createdAt": "2026-03-20T14:30:00Z"
      },
      "session": {
        "id": "sess_456",
        "title": "TypeScript 学习"
      },
      "highlight": {
        "content": "<mark>TypeScript</mark> is a typed superset of JavaScript..."
      }
    }
  ],
  "total": 15,
  "query": {
    "q": "TypeScript",
    "startDate": "2026-01-01",
    "endDate": "2026-03-22"
  },
  "facets": {
    "byRole": {
      "user": 5,
      "assistant": 10
    },
    "byDate": {
      "2026-03-20": 8,
      "2026-03-19": 5,
      "2026-03-18": 2
    }
  }
}
```

---

## Search Features

### 时间范围过滤

使用 `startDate` 和 `endDate` 参数限制搜索范围：

```http
GET /api/chat/search?q=API&startDate=2026-03-01&endDate=2026-03-22
```

### 关键词高亮

设置 `highlight=true` 返回高亮内容：

```json
{
  "highlight": {
    "content": "Learn how to use <mark>API</mark> endpoints..."
  }
}
```

高亮标签默认为 `<mark>`，可通过 CSS 自定义样式：

```css
mark {
  background-color: #fef08a;
  padding: 0 2px;
  border-radius: 2px;
}
```

### 聚合统计

设置 `facets=true` 返回统计信息：

```json
{
  "facets": {
    "byRole": {
      "user": 5,
      "assistant": 10
    },
    "byDate": {
      "2026-03-20": 8,
      "2026-03-19": 5
    },
    "bySession": {
      "sess_1": 3,
      "sess_2": 7
    }
  }
}
```

---

## GET /chat/search/suggestions

获取搜索建议。

### Request

```http
GET /api/chat/search/suggestions?q=Type&limit=5
Authorization: Bearer <token>
```

### Query Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| q | string | - | 搜索前缀（必填） |
| limit | number | 5 | 返回数量 |

### Response

**200 OK**

```json
{
  "suggestions": [
    {
      "text": "TypeScript",
      "count": 15
    },
    {
      "text": "Type annotation",
      "count": 8
    },
    {
      "text": "Type inference",
      "count": 5
    }
  ]
}
```

---

## Search Syntax

### 基本搜索

直接输入关键词：

```
TypeScript
```

### 精确匹配

使用双引号进行精确匹配：

```
"TypeScript generics"
```

### 排除词

使用 `-` 排除关键词：

```
TypeScript -JavaScript
```

### OR 搜索

使用 `|` 或 `OR`：

```
TypeScript | JavaScript
```

---

## Performance Tips

### 索引优化

- 常用搜索字段已建立索引
- 时间范围查询使用索引优化
- 建议使用 `limit` 限制结果数量

### 缓存策略

- 热门搜索词缓存 5 分钟
- 用户搜索历史缓存 1 小时

### 最佳实践

```javascript
// 推荐：使用分页
fetch('/api/chat/search?q=TypeScript&limit=20&offset=0');

// 不推荐：一次获取所有结果
fetch('/api/chat/search?q=TypeScript&limit=1000');
```

---

## Rate Limiting

| Endpoint | Limit | Window |
|----------|-------|--------|
| `GET /chat/search` | 60 requests | 1 minute |
| `GET /chat/search/suggestions` | 120 requests | 1 minute |

---

## Error Codes

| Code | HTTP Status | Description |
|------|-------------|-------------|
| `QUERY_TOO_SHORT` | 400 | 搜索词太短（最少 2 字符） |
| `INVALID_DATE_RANGE` | 400 | 无效日期范围 |
| `UNAUTHORIZED` | 401 | 未认证 |

---

## Client Example

### React Hook

```typescript
import { useState, useCallback } from 'react';

interface SearchResult {
  message: {
    id: string;
    content: string;
    role: 'user' | 'assistant';
    createdAt: string;
  };
  session: {
    id: string;
    title: string;
  };
  highlight?: {
    content: string;
  };
}

interface SearchResponse {
  results: SearchResult[];
  total: number;
  facets?: {
    byRole: Record<string, number>;
    byDate: Record<string, number>;
  };
}

export function useSearch() {
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [total, setTotal] = useState(0);

  const search = useCallback(async (query: string, options?: {
    startDate?: string;
    endDate?: string;
    highlight?: boolean;
    facets?: boolean;
  }) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ q: query });
      if (options?.startDate) params.set('startDate', options.startDate);
      if (options?.endDate) params.set('endDate', options.endDate);
      if (options?.highlight) params.set('highlight', 'true');
      if (options?.facets) params.set('facets', 'true');

      const response = await fetch(`/api/chat/search?${params}`, {
        headers: {
          Authorization: `Bearer ${token}`
        }
      });

      const data: SearchResponse = await response.json();
      setResults(data.results);
      setTotal(data.total);
      return data;
    } finally {
      setLoading(false);
    }
  }, []);

  return { results, loading, total, search };
}
```

### Vue Composable

```typescript
import { ref, computed } from 'vue';

export function useSearch() {
  const results = ref<SearchResult[]>([]);
  const loading = ref(false);
  const total = ref(0);
  const facets = ref<{
    byRole: Record<string, number>;
    byDate: Record<string, number>;
  } | null>(null);

  async function search(query: string, options?: SearchOptions) {
    loading.value = true;
    try {
      const params = new URLSearchParams({ q: query });
      // ... 构建参数

      const response = await fetch(`/api/chat/search?${params}`);
      const data = await response.json();

      results.value = data.results;
      total.value = data.total;
      facets.value = data.facets || null;
    } finally {
      loading.value = false;
    }
  }

  const hasResults = computed(() => results.value.length > 0);

  return { results, loading, total, facets, search, hasResults };
}
```

---

## Future Enhancements

- [ ] 全文索引优化（SQLite FTS5）
- [ ] 语义搜索支持
- [ ] 搜索历史记录
- [ ] 高级过滤器
- [ ] 导出搜索结果

---

*Document Version: 1.0.0*
*Last Updated: 2026-03-22*
