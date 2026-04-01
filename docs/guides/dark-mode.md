# 暗黑模式指南

> SACODE Web 暗黑模式实现指南

## 概述

SACODE 支持三种主题模式：
- **浅色模式** (light) - 默认浅色主题
- **深色模式** (dark) - 深色主题
- **跟随系统** (auto) - 根据系统设置自动切换

## 架构

```
┌─────────────────────────────────────────────────────────────┐
│                      主题系统                                │
├─────────────────────────────────────────────────────────────┤
│  ThemeStore (Pinia)                                         │
│  ├── theme: 'light' | 'dark' | 'auto'                       │
│  ├── isDark: boolean (计算属性)                              │
│  ├── setTheme() - 设置主题                                   │
│  ├── toggleTheme() - 切换主题                                │
│  └── init() - 初始化主题                                     │
├─────────────────────────────────────────────────────────────┤
│  持久化: localStorage ('SACODE-theme')                       │
├─────────────────────────────────────────────────────────────┤
│  系统监听: matchMedia('(prefers-color-scheme: dark)')        │
├─────────────────────────────────────────────────────────────┤
│  CSS 类: document.documentElement.classList.add('dark')      │
└─────────────────────────────────────────────────────────────┘
```

## 使用方式

### 1. 快速切换

在 DashboardLayout 头部右侧有主题切换按钮：

```vue
<template>
  <tiny-button
    :icon="themeStore.isDark ? 'sunny' : 'moon'"
    @click="themeStore.toggleTheme()"
  />
</template>
```

### 2. 设置页面

在设置页面可以选择具体的主题模式：

```vue
<template>
  <tiny-radio-group v-model="generalSettings.theme" @change="onThemeChange">
    <tiny-radio label="light">浅色</tiny-radio>
    <tiny-radio label="dark">深色</tiny-radio>
    <tiny-radio label="auto">跟随系统</tiny-radio>
  </tiny-radio-group>
</template>
```

## 实现细节

### ThemeStore

```typescript
// src/stores/theme.ts
export type Theme = "light" | "dark" | "auto";

export const useThemeStore = defineStore("theme", () => {
  const theme = ref<Theme>(getStoredTheme());
  const isDark = ref(false);

  // 应用主题
  function applyTheme(newTheme: Theme) {
    const effectiveTheme = newTheme === "auto" ? getSystemTheme() : newTheme;
    isDark.value = effectiveTheme === "dark";
    
    const html = document.documentElement;
    if (isDark.value) {
      html.classList.add("dark");
    } else {
      html.classList.remove("dark");
    }
  }

  // 设置主题
  function setTheme(newTheme: Theme) {
    theme.value = newTheme;
    localStorage.setItem("SACODE-theme", newTheme);
    applyTheme(newTheme);
  }

  // 切换主题
  function toggleTheme() {
    setTheme(isDark.value ? "light" : "dark");
  }

  // 初始化
  function init() {
    applyTheme(theme.value);
    setupSystemThemeListener();
  }

  return { theme, isDark, setTheme, toggleTheme, init };
});
```

### 初始化

在应用启动时初始化主题：

```typescript
// src/App.vue
import { onMounted } from "vue";
import { useThemeStore } from "@/stores/theme";

const themeStore = useThemeStore();

onMounted(() => {
  themeStore.init();
});
```

### 系统主题监听

```typescript
function setupSystemThemeListener() {
  const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
  
  mediaQuery.addEventListener("change", () => {
    if (theme.value === "auto") {
      applyTheme("auto");
    }
  });
}
```

## 样式适配

### Tailwind CSS

使用 `dark:` 前缀适配暗黑模式：

```html
<!-- 背景色 -->
<div class="bg-white dark:bg-gray-900">

<!-- 文字颜色 -->
<p class="text-gray-900 dark:text-gray-100">

<!-- 边框 -->
<div class="border-gray-200 dark:border-gray-700">

<!-- 卡片 -->
<div class="bg-gray-50 dark:bg-gray-800 rounded-lg">
```

### CSS 变量

在全局样式中定义 CSS 变量：

```css
/* src/style.css */
:root {
  --primary-color: #f97316;
  --background: #ffffff;
  --foreground: #171717;
}

.dark {
  --background: #0a0a0a;
  --foreground: #ededed;
}

body {
  color: var(--foreground);
  background: var(--background);
}
```

### TinyVue 主题

TinyVue 组件使用 CSS 变量定制：

```css
:root {
  --tv-Brand: #f97316;
  --tv-BrandHover: #ea580c;
  --tv-BrandActive: #c2410c;
}
```

## 组件适配清单

| 组件 | 状态 | 说明 |
|------|------|------|
| Login.vue | ✅ | 橙色渐变背景，白色卡片 |
| DashboardLayout.vue | ✅ | 侧边栏、顶部栏暗黑适配 |
| Dashboard.vue | ✅ | 统计卡片暗黑适配 |
| Chat.vue | ✅ | 消息气泡暗黑适配 |
| IM.vue | ✅ | 表格、卡片暗黑适配 |
| Settings.vue | ✅ | 表单、卡片暗黑适配 |

## 样式示例

### 登录页面

```css
.login-container {
  background: linear-gradient(135deg, #f97316 0%, #ea580c 50%, #c2410c 100%);
}

.login-card {
  background: white;
  border-radius: 16px;
}

.dark .login-card {
  background: #1f2937;
}
```

### 侧边栏

```css
.sidebar {
  background: white;
  border-right: 1px solid #e5e7eb;
}

.dark .sidebar {
  background: #1f2937;
  border-right-color: #374151;
}
```

### 消息气泡

```css
.message.user .message-text {
  background: #f97316;
  color: white;
}

.message.assistant .message-text {
  background: #f3f4f6;
}

.dark .message.assistant .message-text {
  background: #374151;
}
```

## 最佳实践

### 1. 使用 Tailwind dark: 前缀

```html
<!-- 推荐 -->
<div class="bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100">

<!-- 避免 -->
<div class="bg-white text-gray-900">
  <!-- 需要额外的 CSS 类来处理暗黑模式 -->
</div>
```

### 2. 避免硬编码颜色

```html
<!-- 避免 -->
<div style="background: #ffffff">

<!-- 推荐 -->
<div class="bg-white dark:bg-gray-900">
```

### 3. 使用 CSS 变量

```css
/* 推荐 */
.element {
  color: var(--foreground);
  background: var(--background);
}

/* 避免 */
.element {
  color: #171717;
  background: #ffffff;
}
```

### 4. 测试暗黑模式

在开发时测试两种模式：

```bash
# 开发服务器
pnpm -C packages/web dev

# 点击右上角月亮/太阳图标切换主题
```

## 常见问题

### Q: 为什么暗黑模式不生效？

A: 确保在 `App.vue` 中调用了 `themeStore.init()`：

```typescript
onMounted(() => {
  themeStore.init();
});
```

### Q: 如何添加新的暗黑模式样式？

A: 使用 Tailwind 的 `dark:` 前缀：

```html
<div class="bg-white dark:bg-gray-900">
```

### Q: TinyVue 组件如何适配暗黑模式？

A: TinyVue 组件会自动继承父元素的暗黑模式，只需确保 `<html>` 元素有 `dark` 类。

---

*最后更新：2026-03-15*
