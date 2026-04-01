# React 技术栈参考模板

本模板适用于使用 React 的项目（不含 Next.js 等元框架）。

## 技术栈识别特征

- `package.json` 中包含 `react` 依赖
- 不包含 `next`、`nuxt` 等元框架依赖
- 通常配合 Vite、Webpack 等构建工具

## 目录结构

```
项目根目录/
├── src/
│   ├── components/       # React 组件
│   │   ├── ui/          # UI 基础组件
│   │   └── [feature]/   # 功能组件
│   ├── hooks/           # 自定义 Hooks
│   ├── pages/           # 页面组件（如使用路由）
│   ├── services/        # API 服务
│   ├── store/           # 状态管理
│   ├── utils/           # 工具函数
│   ├── types/           # 类型定义
│   ├── App.tsx          # 应用入口
│   └── main.tsx         # 渲染入口
├── public/              # 静态资源
└── index.html           # HTML 模板
```

## 核心约定

### 函数组件优先

```tsx
// ✅ 推荐：函数组件
function Button({ children, onClick }: ButtonProps) {
  return <button onClick={onClick}>{children}</button>
}

// ❌ 避免：类组件
class Button extends React.Component {
  render() {
    return <button>{this.props.children}</button>
  }
}
```

### Hooks 使用

```tsx
// 状态管理
const [state, setState] = useState(initialValue)

// 副作用
useEffect(() => {
  // 副作用逻辑
  return () => {
    // 清理函数
  }
}, [dependencies])

// 上下文
const value = useContext(MyContext)

// 引用
const ref = useRef(initialValue)

// 记忆化
const memoizedValue = useMemo(() => computeExpensiveValue(a, b), [a, b])
const memoizedCallback = useCallback(() => { doSomething(a, b) }, [a, b])
```

### 状态管理选择

| 场景 | 推荐方案 |
|------|----------|
| 简单状态 | useState |
| 跨组件共享 | Context + useReducer |
| 复杂全局状态 | Zustand / Jotai |
| 服务端状态 | React Query / SWR |

## 常用命令

### 开发
```bash
npm run dev          # 启动开发服务器
npm run build        # 生产构建
npm run preview      # 预览生产构建
npm run lint         # ESLint 检查
```

### 测试
```bash
npm run test         # 运行测试
npm run test:watch   # 监听模式
npm run test:coverage # 覆盖率报告
```

### 类型检查
```bash
npx tsc --noEmit    # TypeScript 类型检查
```

## 验证清单

### Prime 阶段
- [ ] 确认 React 版本
- [ ] 确认构建工具（Vite 推荐）
- [ ] 确认路由方案
- [ ] 确认状态管理方案
- [ ] 确认样式方案

### Implement 阶段
- [ ] 使用函数组件
- [ ] 正确使用 Hooks
- [ ] 组件职责单一
- [ ] Props 类型定义完整

### Validate 阶段
- [ ] 类型检查通过
- [ ] ESLint 检查通过
- [ ] 测试通过
- [ ] 构建成功

## 常见问题

### Q: 如何处理副作用？

A: 使用 useEffect，注意依赖数组：

```tsx
// ✅ 正确
useEffect(() => {
  fetchData(id)
}, [id])

// ❌ 避免：空依赖数组内的值变化时不触发
useEffect(() => {
  fetchData(id)
}, []) // id 变化时不会重新执行
```

### Q: 如何优化渲染性能？

A:
1. 使用 React.memo 避免不必要的重渲染
2. 使用 useMemo 缓存计算结果
3. 使用 useCallback 缓存回调函数
4. 使用虚拟列表处理大列表

### Q: 如何组织组件？

A: 按功能或类型组织：
- `components/ui/` - 基础 UI 组件
- `components/[feature]/` - 功能组件
- `components/layout/` - 布局组件
