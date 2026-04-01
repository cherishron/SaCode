# 前端组件开发示例

## 场景描述

创建一个可复用的 PostCard 卡片组件，用于显示博客文章信息，支持响应式设计和交互效果。

## Prime 阶段

### 1. 加载项目上下文

```bash
@IFLOW.md
@docs/core/architecture.md
@docs/technical/development.md
```

### 2. 明确需求

```bash
"我需要创建一个 PostCard 组件，要求：
1. 显示文章标题、摘要、作者、日期
2. 支持点击跳转到文章详情
3. 支持响应式设计（移动端、平板、桌面）
4. 使用 Tailwind CSS 样式
5. 添加悬停效果和过渡动画
6. 支持显示文章标签
7. 支持显示文章封面图（可选）

验收标准：
- 组件可复用，支持不同的文章数据
- 响应式布局在所有设备上正常显示
- 悬停效果流畅自然
- 无障碍访问符合 WCAG 2.1 AA 标准
- TypeScript 类型定义完整
- 性能优化良好（无不必要的重渲染）"
```

### 3. 制定计划

```bash
"请帮我制定详细的实现计划，包括：
1. 创建组件文件和类型定义
2. 实现组件逻辑和结构
3. 添加 Tailwind CSS 样式
4. 实现响应式布局
5. 添加交互效果和动画
6. 实现可访问性功能
7. 编写组件测试
8. 集成到应用中"
```

**实施计划**：
```markdown
## 实施计划

### 阶段 1：组件基础结构
- [ ] 创建组件文件 `src/components/PostCard.tsx`
- [ ] 定义 TypeScript 接口 `PostCardProps`
- [ ] 实现基础组件结构
- [ ] 添加必要的导入和依赖

### 阶段 2：样式实现
- [ ] 使用 Tailwind CSS 实现卡片布局
- [ ] 添加卡片阴影和边框
- [ ] 实现响应式布局（breakpoints）
- [ ] 添加悬停效果和过渡动画
- [ ] 优化移动端显示

### 阶段 3：功能增强
- [ ] 实现点击跳转功能
- [ ] 添加标签显示
- [ ] 添加封面图支持（可选）
- [ ] 实现日期格式化
- [ ] 添加加载状态支持

### 阶段 4：可访问性优化
- [ ] 添加语义化 HTML 标签
- [ ] 实现 ARIA 属性
- [ ] 添加键盘导航支持
- [ ] 优化屏幕阅读器支持
- [ ] 确保颜色对比度符合标准

### 阶段 5：性能优化
- [ ] 使用 React.memo 避免不必要的重渲染
- [ ] 优化图片加载（lazy loading）
- [ ] 实现组件懒加载
- [ ] 优化动画性能

### 阶段 6：测试和集成
- [ ] 编写单元测试
- [ ] 编写快照测试
- [ ] 集成到应用中
- [ ] 验证响应式效果
- [ ] 更新文档
```

### 4. 评估风险

```bash
"请评估实现 PostCard 组件可能遇到的风险：
- 性能问题（大量卡片渲染）
- 响应式布局兼容性
- 可访问性标准符合性
- Tailwind CSS 样式冲突
- 图片加载性能"
```

**风险评估**：
```markdown
## 风险评估

| 风险 | 影响 | 概率 | 缓解措施 |
|------|------|------|----------|
| 性能问题 | 中 | 中 | 使用 React.memo、虚拟滚动、图片懒加载 |
| 响应式兼容性 | 高 | 低 | 使用标准 breakpoints、充分测试 |
| 可访问性 | 高 | 低 | 遵循 WCAG 2.1 AA 标准、使用 ARIA |
| 样式冲突 | 中 | 低 | 使用 Tailwind CSS、避免全局样式 |
| 图片加载 | 中 | 中 | 使用 Next.js Image 组件、占位符 |
```

### 5. 确定技术方案

```bash
"请帮我选择合适的技术方案：
- 样式方案：Tailwind CSS vs CSS Modules vs Styled Components？
- 动画方案：CSS Transitions vs Framer Motion？
- 图片优化：Next.js Image vs 原生 img 标签？
- 性能优化：React.memo vs useMemo vs useCallback？"
```

**技术方案评估**：
```markdown
## 技术方案评估

### 样式方案选择
**推荐方案**：Tailwind CSS
**理由**：
- 项目已使用 Tailwind CSS
- 开发效率高，无需编写额外 CSS
- 响应式设计支持完善
- 性能优秀（JIT 模式）

### 动画方案选择
**推荐方案**：CSS Transitions + Tailwind
**理由**：
- 轻量级，无需额外依赖
- 性能优秀（GPU 加速）
- 满足简单动画需求
- 与 Tailwind CSS 完美集成

### 图片优化方案选择
**推荐方案**：Next.js Image 组件
**理由**：
- 自动优化图片大小和格式
- 支持懒加载
- 支持 WebP 格式
- 性能优秀

### 性能优化方案选择
**推荐方案**：React.memo
**理由**：
- 简单易用，适合组件级优化
- 避免不必要的重渲染
- 性能提升明显
- 符合 React 最佳实践
```

## Implement 阶段

### 1. 创建组件文件和类型定义

```bash
"请创建 src/components/PostCard.tsx

功能：
- 定义 PostCardProps 接口
- 实现组件基础结构
- 添加必要的导入"
```

**代码实现**：
```typescript
// src/components/PostCard.tsx
import Link from 'next/link';
import Image from 'next/image';
import { formatDistanceToNow } from 'date-fns';
import { zhCN } from 'date-fns/locale';

export interface Post {
  id: string;
  title: string;
  excerpt: string;
  author: {
    name: string;
    avatar?: string;
  };
  createdAt: Date;
  tags?: string[];
  coverImage?: string;
  slug: string;
}

export interface PostCardProps {
  post: Post;
  showCover?: boolean;
  className?: string;
}

export default function PostCard({ post, showCover = true, className = '' }: PostCardProps) {
  const timeAgo = formatDistanceToNow(new Date(post.createdAt), {
    addSuffix: true,
    locale: zhCN,
  });

  return (
    <Link href={`/blog/${post.slug}`}>
      <article className={`
        group relative overflow-hidden rounded-xl bg-white
        shadow-md transition-all duration-300
        hover:shadow-xl hover:-translate-y-1
        ${className}
      `}>
        {/* 卡片内容 */}
        <div className="p-6">
          {/* 标签 */}
          {post.tags && post.tags.length > 0 && (
            <div className="mb-3 flex flex-wrap gap-2">
              {post.tags.map((tag) => (
                <span
                  key={tag}
                  className="inline-block rounded-full bg-blue-100 px-3 py-1
                    text-xs font-medium text-blue-600
                    transition-colors duration-200
                    group-hover:bg-blue-200"
                >
                  {tag}
                </span>
              ))}
            </div>
          )}

          {/* 标题 */}
          <h2 className="mb-3 text-xl font-bold text-gray-900
            line-clamp-2 group-hover:text-blue-600
            transition-colors duration-200">
            {post.title}
          </h2>

          {/* 摘要 */}
          <p className="mb-4 text-gray-600 line-clamp-3">
            {post.excerpt}
          </p>

          {/* 作者和日期 */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              {post.author.avatar && (
                <Image
                  src={post.author.avatar}
                  alt={post.author.name}
                  width={32}
                  height={32}
                  className="rounded-full"
                />
              )}
              <span className="text-sm text-gray-700 font-medium">
                {post.author.name}
              </span>
            </div>
            <time className="text-sm text-gray-500">
              {timeAgo}
            </time>
          </div>
        </div>

        {/* 封面图 */}
        {showCover && post.coverImage && (
          <div className="relative h-48 w-full overflow-hidden">
            <Image
              src={post.coverImage}
              alt={post.title}
              fill
              className="object-cover transition-transform duration-300
                group-hover:scale-105"
              sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
            />
          </div>
        )}
      </article>
    </Link>
  );
}
```

### 2. 添加样式和响应式布局

```bash
"请优化组件的样式：
- 使用 Tailwind CSS 实现响应式布局
- 添加移动端、平板、桌面的不同样式
- 优化间距和字体大小"
```

**响应式优化**：
```typescript
// 在 PostCard 组件中添加响应式样式
export default function PostCard({ post, showCover = true, className = '' }: PostCardProps) {
  // ... 前面的代码保持不变

  return (
    <Link href={`/blog/${post.slug}`}>
      <article className={`
        group relative overflow-hidden rounded-xl bg-white
        shadow-md transition-all duration-300
        hover:shadow-xl hover:-translate-y-1
        sm:rounded-2xl
        md:rounded-xl
        ${className}
      `}>
        <div className="p-4 sm:p-6 md:p-8">
          {/* 标签 - 移动端标签更小 */}
          {post.tags && post.tags.length > 0 && (
            <div className="mb-2 sm:mb-3 flex flex-wrap gap-1 sm:gap-2">
              {post.tags.map((tag) => (
                <span
                  key={tag}
                  className="inline-block rounded-full bg-blue-100 px-2 py-0.5 sm:px-3 sm:py-1
                    text-[10px] sm:text-xs font-medium text-blue-600
                    transition-colors duration-200
                    group-hover:bg-blue-200"
                >
                  {tag}
                </span>
              ))}
            </div>
          )}

          {/* 标题 - 响应式字体大小 */}
          <h2 className="mb-2 sm:mb-3 text-lg sm:text-xl md:text-2xl font-bold text-gray-900
            line-clamp-2 group-hover:text-blue-600
            transition-colors duration-200">
            {post.title}
          </h2>

          {/* 摘要 - 移动端只显示两行 */}
          <p className="mb-3 sm:mb-4 text-gray-600
            text-sm sm:text-base
            line-clamp-2 sm:line-clamp-3">
            {post.excerpt}
          </p>

          {/* 作者和日期 - 响应式布局 */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 sm:gap-0">
            <div className="flex items-center gap-2">
              {post.author.avatar && (
                <Image
                  src={post.author.avatar}
                  alt={post.author.name}
                  width={28} // 移动端头像更小
                  height={28}
                  className="rounded-full sm:h-8 sm:w-8"
                />
              )}
              <span className="text-xs sm:text-sm text-gray-700 font-medium">
                {post.author.name}
              </span>
            </div>
            <time className="text-xs sm:text-sm text-gray-500">
              {timeAgo}
            </time>
          </div>
        </div>

        {/* 封面图 - 响应式高度 */}
        {showCover && post.coverImage && (
          <div className="relative h-32 sm:h-40 md:h-48 w-full overflow-hidden">
            <Image
              src={post.coverImage}
              alt={post.title}
              fill
              className="object-cover transition-transform duration-300
                group-hover:scale-105"
              sizes="(max-width: 640px) 100vw, (max-width: 768px) 50vw, (max-width: 1024px) 33vw, 25vw"
            />
          </div>
        )}
      </article>
    </Link>
  );
}
```

### 3. 添加性能优化

```bash
"请优化组件性能：
- 使用 React.memo 避免不必要的重渲染
- 优化图片加载"
```

**性能优化实现**：
```typescript
import { memo } from 'react';

// 使用 memo 包装组件
export default memo(function PostCard({ post, showCover = true, className = '' }: PostCardProps) {
  // ... 组件代码保持不变
});
```

### 4. 添加可访问性功能

```bash
"请添加可访问性功能：
- 添加 ARIA 属性
- 优化键盘导航
- 确保颜色对比度符合标准"
```

**可访问性优化**：
```typescript
export default memo(function PostCard({ post, showCover = true, className = '' }: PostCardProps) {
  const timeAgo = formatDistanceToNow(new Date(post.createdAt), {
    addSuffix: true,
    locale: zhCN,
  });

  return (
    <Link
      href={`/blog/${post.slug}`}
      aria-label={`阅读文章：${post.title}`}
      className="focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
    >
      <article
        className={`
          group relative overflow-hidden rounded-xl bg-white
          shadow-md transition-all duration-300
          hover:shadow-xl hover:-translate-y-1
          sm:rounded-2xl
          md:rounded-xl
          ${className}
        `}
        aria-labelledby={`post-title-${post.id}`}
      >
        {/* ... 其他内容保持不变 */}

        {/* 标题 - 添加 id 供 aria-labelledby 使用 */}
        <h2
          id={`post-title-${post.id}`}
          className="mb-2 sm:mb-3 text-lg sm:text-xl md:text-2xl font-bold text-gray-900
            line-clamp-2 group-hover:text-blue-600
            transition-colors duration-200"
        >
          {post.title}
        </h2>

        {/* ... 其他内容保持不变 */}
      </article>
    </Link>
  );
});
```

### 5. 集成到应用

```bash
"请将 PostCard 组件集成到应用中：
- 在博客列表页面使用 PostCard
- 实现网格布局"
```

**集成示例**：
```typescript
// src/app/blog/page.tsx
import PostCard from '@/components/PostCard';
import { getPosts } from '@/lib/posts';

export default async function BlogPage() {
  const posts = await getPosts();

  return (
    <div className="container mx-auto px-4 py-8">
      <h1 className="mb-8 text-3xl font-bold">博客文章</h1>

      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {posts.map((post) => (
          <PostCard key={post.id} post={post} />
        ))}
      </div>
    </div>
  );
}
```

### 6. 更新任务状态

```bash
"组件基础结构已完成"
"样式实现已完成"
"功能增强已完成"
"可访问性优化已完成"
"性能优化已完成"
"测试和集成已完成"
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
"请测试 PostCard 组件的功能：
- 测试点击跳转功能
- 测试标签显示
- 测试封面图显示和隐藏
- 测试日期格式化
- 测试作者信息显示"
```

**测试用例**：
```typescript
// src/components/__tests__/PostCard.test.tsx
import { render, screen } from '@testing-library/react';
import PostCard from '../PostCard';
import { Post } from '../PostCard';

describe('PostCard', () => {
  const mockPost: Post = {
    id: '1',
    title: '测试文章标题',
    excerpt: '这是一篇测试文章的摘要内容，用于测试 PostCard 组件的显示效果。',
    author: {
      name: '测试作者',
      avatar: 'https://example.com/avatar.jpg',
    },
    createdAt: new Date('2024-01-01'),
    tags: ['React', 'TypeScript'],
    coverImage: 'https://example.com/cover.jpg',
    slug: 'test-post',
  };

  it('应该正确渲染文章信息', () => {
    render(<PostCard post={mockPost} />);

    expect(screen.getByText('测试文章标题')).toBeInTheDocument();
    expect(screen.getByText('这是一篇测试文章的摘要内容')).toBeInTheDocument();
    expect(screen.getByText('测试作者')).toBeInTheDocument();
  });

  it('应该正确渲染标签', () => {
    render(<PostCard post={mockPost} />);

    expect(screen.getByText('React')).toBeInTheDocument();
    expect(screen.getByText('TypeScript')).toBeInTheDocument();
  });

  it('应该正确渲染封面图', () => {
    render(<PostCard post={mockPost} showCover={true} />);

    const coverImage = screen.getByAltText('测试文章标题');
    expect(coverImage).toBeInTheDocument();
  });

  it('应该支持隐藏封面图', () => {
    render(<PostCard post={mockPost} showCover={false} />);

    const coverImage = screen.queryByAltText('测试文章标题');
    expect(coverImage).not.toBeInTheDocument();
  });
});
```

### 4. 响应式设计测试

```bash
"请测试响应式设计：
- 测试移动端布局（< 640px）
- 测试平板布局（640px - 1024px）
- 测试桌面布局（> 1024px）
- 测试不同屏幕尺寸下的显示效果"
```

**测试方法**：
- 使用浏览器开发者工具的设备模拟功能
- 测试不同视口宽度下的布局
- 验证字体大小、间距、图片尺寸是否正确调整

### 5. 可访问性测试

```bash
"请测试可访问性：
- 使用键盘导航测试
- 使用屏幕阅读器测试
- 检查颜色对比度
- 验证 ARIA 属性"
```

**测试工具**：
- axe DevTools - 自动化可访问性测试
- WAVE - Web 可访问性评估工具
- NVDA / JAWS - 屏幕阅读器测试

### 6. 性能测试

```bash
"请测试组件性能：
- 测试大量卡片渲染性能
- 测试图片加载性能
- 测试动画流畅度
- 使用 React DevTools Profiler 分析性能"
```

**性能指标**：
- 首次内容绘制（FCP）< 1.8s
- 最大内容绘制（LCP）< 2.5s
- 累积布局偏移（CLS）< 0.1
- 交互时间（TTI）< 3.9s

### 7. 构建验证

```bash
!npm run build

"请检查构建是否有错误，并修复它们"
```

### 8. 更新文档

```bash
"请更新 docs/technical/components.md，添加 PostCard 组件的文档"
"请更新 docs/technical/development.md，添加组件开发指南"
```

## 完成检查清单

### Prime 阶段
- [x] 已加载项目上下文
- [x] 需求和验收标准已明确
- [x] 详细计划已制定
- [x] 风险和依赖已评估
- [x] 技术方案已确定

### Implement 阶段
- [x] 组件基础结构已完成
- [x] 样式实现已完成
- [x] 功能增强已完成
- [x] 可访问性优化已完成
- [x] 性能优化已完成
- [x] 测试和集成已完成

### Validate 阶段
- [x] TypeScript 类型检查通过
- [x] 代码风格验证通过
- [x] 功能测试通过
- [x] 响应式设计测试通过
- [x] 可访问性测试通过
- [x] 性能测试通过
- [x] 构建验证通过
- [x] 文档已更新

## 总结

通过 PIV 工作流，我们成功创建了 PostCard 组件：

1. **Prime 阶段** - 明确需求和验收标准，制定详细计划，评估风险，选择合适的技术方案
2. **Implement 阶段** - 创建组件，实现样式和响应式布局，添加功能增强，优化性能和可访问性
3. **Validate 阶段** - 全面测试，确保功能正确、响应式布局良好、可访问性符合标准、性能优秀

### 关键成果

- ✅ 可复用的 PostCard 组件，支持不同的文章数据
- ✅ 完整的响应式布局，支持移动端、平板、桌面
- ✅ 流畅的悬停效果和过渡动画
- ✅ 符合 WCAG 2.1 AA 标准的可访问性
- ✅ 完整的 TypeScript 类型定义
- ✅ 优秀的性能表现（使用 React.memo、图片优化）
- ✅ 完整的单元测试覆盖

### 组件特性

- 支持显示文章标题、摘要、作者、日期
- 支持点击跳转到文章详情
- 支持响应式设计（移动端、平板、桌面）
- 使用 Tailwind CSS 样式
- 添加悬停效果和过渡动画
- 支持显示文章标签
- 支持显示文章封面图（可选）
- 完整的可访问性支持
- 性能优化（React.memo、图片懒加载）

## 参考资料

- [Javisk 方法论概述](../SKILL.md)
- [Prime 阶段指南](../templates/prime-phase.md)
- [Implement 阶段指南](../templates/implement-phase.md)
- [Validate 阶段指南](../templates/validate-phase.md)
- [最佳实践](../resources/best-practices.md)
- [Tailwind CSS 文档](https://tailwindcss.com/docs)
- [Next.js Image 组件](https://nextjs.org/docs/api-reference/next/image)
- [WCAG 2.1 AA 标准](https://www.w3.org/WAI/WCAG21/quickref/)