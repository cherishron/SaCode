# Next.js 技术栈参考模板

本模板适用于使用 Next.js (App Router) 的项目。

## 技术栈识别特征

- `package.json` 中包含 `next` 依赖
- 存在 `next.config.js` 或 `next.config.mjs`
- 存在 `app/` 目录（App Router）

## 目录结构

```
项目根目录/
├── app/                    # App Router 页面和 API
│   ├── layout.tsx         # 根布局
│   ├── page.tsx           # 首页
│   ├── api/               # API 路由
│   │   └── [route]/
│   │       └── route.ts
│   └── [feature]/         # 功能页面
│       ├── page.tsx
│       └── layout.tsx
├── components/            # React 组件
│   ├── ui/               # UI 基础组件
│   └── [feature]/        # 功能组件
├── lib/                   # 工具函数和配置
│   ├── utils.ts
│   └── constants.ts
├── hooks/                 # 自定义 Hooks
├── types/                 # 类型定义
├── prisma/                # Prisma 配置（如使用）
│   └── schema.prisma
└── public/                # 静态资源
```

## 核心约定

### Server Components 优先

```tsx
// ✅ 推荐：默认使用 Server Component
async function Page() {
  const data = await fetchData()
  return <div>{data}</div>
}

// ❌ 避免：不必要的 Client Component
'use client'
function Page() {
  const [data, setData] = useState()
  useEffect(() => { fetchData().then(setData) }, [])
  return <div>{data}</div>
}
```

### Client Components 使用场景

```tsx
// 仅在以下情况使用 'use client'：
// 1. 使用 useState, useEffect 等 Hook
// 2. 使用浏览器 API（window, localStorage）
// 3. 使用事件处理（onClick, onChange）
// 4. 使用 Context

'use client'
import { useState } from 'react'

export function Counter() {
  const [count, setCount] = useState(0)
  return <button onClick={() => setCount(c => c + 1)}>{count}</button>
}
```

### 数据获取

```tsx
// Server Component 中直接获取
async function Page() {
  const posts = await prisma.post.findMany()
  return <PostList posts={posts} />
}

// API Route 中
// app/api/posts/route.ts
import { NextResponse } from 'next/server'

export async function GET() {
  const posts = await prisma.post.findMany()
  return NextResponse.json(posts)
}
```

## 常用命令

### 开发
```bash
npm run dev          # 启动开发服务器
npm run build        # 生产构建
npm run start        # 启动生产服务器
npm run lint         # ESLint 检查
```

### 数据库（Prisma）
```bash
npx prisma migrate dev    # 创建迁移
npx prisma generate       # 生成 Client
npx prisma studio         # 打开数据库 GUI
```

### 类型检查
```bash
npx tsc --noEmit    # TypeScript 类型检查
```

## 验证清单

### Prime 阶段
- [ ] 确认 App Router 版本
- [ ] 确认是否使用 Prisma
- [ ] 确认样式方案（Tailwind CSS 推荐）
- [ ] 确认认证方案

### Implement 阶段
- [ ] Server Component 优先
- [ ] 正确使用 'use client' 指令
- [ ] API Route 使用标准响应格式
- [ ] 数据库操作使用 Prisma Client

### Validate 阶段
- [ ] 类型检查通过
- [ ] ESLint 检查通过
- [ ] 构建成功
- [ ] 功能测试通过

## 常见问题

### Q: 何时使用 Server Action？

A: 表单提交、数据变更等操作推荐使用 Server Action：

```tsx
// app/actions.ts
'use server'
export async function createPost(formData: FormData) {
  const title = formData.get('title')
  await prisma.post.create({ data: { title } })
}
```

### Q: 如何处理认证？

A: 推荐使用 NextAuth.js 或中间件：

```tsx
// middleware.ts
export { auth as middleware } from '@/auth'
```

### Q: 如何优化性能？

A: 
1. 使用 `dynamic` 动态导入
2. 使用 `loading.tsx` 加载状态
3. 使用 `Image` 组件优化图片
4. 使用 `generateStaticParams` 静态生成
