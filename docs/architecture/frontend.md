# 前端架构

> SACODE Web 前端架构文档 - Vue 3 + Vite + TinyVue

## 技术栈

| 层级 | 技术 | 版本 | 说明 |
|------|------|------|------|
| 框架 | Vue | 3.5+ | Composition API |
| 构建 | Vite | 6.0+ | 原生 ESM 开发服务器 |
| UI 组件 | TinyVue | 3.20+ | OpenTiny 企业级组件库 |
| 路由 | Vue Router | 4.5+ | 官方路由管理器 |
| 状态管理 | Pinia | 2.3+ | Vue 官方状态管理 |
| 样式 | Tailwind CSS | 3.4+ | 原子化 CSS 框架 |
| 语言 | TypeScript | 5.7+ | 严格模式 |

## 目录结构

```
packages/web/
├── src/
│   ├── main.ts              # 应用入口
│   ├── App.vue              # 根组件
│   ├── style.css            # 全局样式
│   ├── lib/
│   │   └── api.ts           # API 客户端
│   ├── router/
│   │   └── index.ts         # 路由配置
│   ├── stores/
│   │   ├── auth.ts          # 认证状态
│   │   └── theme.ts         # 主题状态
│   └── views/
│       ├── Login.vue             # 登录页
│       ├── DashboardLayout.vue   # 布局组件
│       ├── Dashboard.vue         # 仪表盘
│       ├── Chat.vue              # 聊天页
│       ├── IM.vue                # IM 管理
│       └── Settings.vue          # 设置页
├── index.html               # HTML 入口
├── vite.config.ts           # Vite 配置
├── tsconfig.json            # TS 配置
├── tailwind.config.js       # Tailwind 配置
└── package.json             # 依赖配置
```

## 核心模块

### 1. 路由系统

使用 Vue Router 4，支持路由守卫和懒加载：

```typescript
// src/router/index.ts
const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    { path: "/login", name: "login", component: () => import("@/views/Login.vue") },
    { path: "/", redirect: "/dashboard" },
    { path: "/dashboard", name: "dashboard", component: () => import("@/views/Dashboard.vue") },
    // ...其他路由
  ],
});

// 路由守卫
router.beforeEach(async (to, _from, next) => {
  const authStore = useAuthStore();
  if (!authStore.initialized) {
    await authStore.init();
  }
  // 认证逻辑...
});
```

### 2. 状态管理

使用 Pinia Store，支持 TypeScript：

```typescript
// src/stores/auth.ts
export const useAuthStore = defineStore("auth", () => {
  const user = ref<User | null>(null);
  const token = ref<string | null>(localStorage.getItem("token"));
  const initialized = ref(false);

  const isAuthenticated = computed(() => !!token.value && !!user.value);

  async function login(username: string, password: string): Promise<boolean> {
    // 登录逻辑...
  }

  return { user, token, initialized, isAuthenticated, login, logout };
});
```

### 3. API 客户端

统一的 API 请求封装：

```typescript
// src/lib/api.ts
class ApiClient {
  private getHeaders(): HeadersInit {
    const headers: HeadersInit = { "Content-Type": "application/json" };
    const token = localStorage.getItem("token");
    if (token) headers["Authorization"] = `Bearer ${token}`;
    return headers;
  }

  async get<T>(path: string): Promise<T> { /* ... */ }
  async post<T>(path: string, body?: unknown): Promise<T> { /* ... */ }
}

export const api = new ApiClient();
```

### 4. 主题系统

支持浅色/深色/跟随系统三种模式：

```typescript
// src/stores/theme.ts
export const useThemeStore = defineStore("theme", () => {
  const theme = ref<Theme>(getStoredTheme());
  const isDark = ref(false);

  function applyTheme(newTheme: Theme) {
    const effectiveTheme = newTheme === "auto" ? getSystemTheme() : newTheme;
    isDark.value = effectiveTheme === "dark";
    document.documentElement.classList.toggle("dark", isDark.value);
  }

  function init() {
    applyTheme(theme.value);
    setupSystemThemeListener();
  }

  return { theme, isDark, setTheme, toggleTheme, init };
});
```

## 构建优化

### 代码分割

使用 `manualChunks` 拆分第三方库：

```typescript
// vite.config.ts
build: {
  rollupOptions: {
    output: {
      manualChunks: (id) => {
        if (id.includes("node_modules/vue/")) return "vue";
        if (id.includes("node_modules/vue-router/") || id.includes("node_modules/pinia/")) return "vue-ecosystem";
        if (id.includes("@opentiny/vue")) return "tinyvue";
      },
    },
  },
}
```

### 构建产物

| 包名 | 大小 (gzip) | 说明 |
|------|-------------|------|
| vue.js | 43.5 KB | Vue 核心 |
| vue-ecosystem.js | 11.8 KB | Vue Router + Pinia |
| tinyvue.js | 1,506 KB | TinyVue 组件库 |
| 业务代码 | ~3 KB | 页面组件 |

## 样式规范

### Tailwind CSS

优先使用 Tailwind 原子类：

```html
<!-- 推荐 -->
<div class="flex items-center gap-4 p-4 bg-white dark:bg-gray-800 rounded-lg">
  <span class="text-lg font-semibold text-gray-900 dark:text-white">标题</span>
</div>

<!-- 避免 -->
<div class="custom-container">
  <span class="custom-title">标题</span>
</div>
```

### 暗黑模式

使用 `dark:` 前缀适配暗黑模式：

```html
<div class="bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100">
  内容
</div>
```

## 页面组件

### 布局组件

`DashboardLayout.vue` 提供统一的侧边栏 + 主内容布局：

```vue
<template>
  <div class="dashboard-layout">
    <aside class="sidebar">
      <!-- 侧边栏导航 -->
    </aside>
    <main class="main-content">
      <header class="header">
        <!-- 顶部栏 + 主题切换 -->
      </header>
      <div class="content">
        <slot />
      </div>
    </main>
  </div>
</template>
```

### 页面列表

| 页面 | 路由 | 说明 |
|------|------|------|
| Login | /login | 登录/注册 |
| Dashboard | /dashboard | 仪表盘首页 |
| Chat | /chat | AI 对话界面 |
| IM | /im | IM 平台管理 |
| Settings | /settings | 系统设置 |

## 开发命令

```bash
# 开发服务器
pnpm -C packages/web dev

# 构建生产版本
pnpm -C packages/web build

# 预览构建结果
pnpm -C packages/web preview

# 类型检查
pnpm -C packages/web typecheck

# 代码检查
pnpm -C packages/web lint
```

## 迁移记录

### 从 Next.js + React + TDesign 迁移

**迁移原因**：TDesign React 版本与 OpenTiny Vue 版本的 Skills 功能存在差异，选择更成熟的 Vue 生态。

**迁移内容**：
- Next.js → Vite
- React → Vue 3
- TDesign → TinyVue
- React Context → Pinia
- next/router → Vue Router

**迁移日期**：2026-03-14

---

*最后更新：2026-03-15*
