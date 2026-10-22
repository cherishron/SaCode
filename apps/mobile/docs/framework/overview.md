# Kuikly Framework 模块概述

> Android Kuikly 适配器框架模块，提供统一的初始化 API 和 7 个核心适配器实现。

## 模块定位

`framework` 模块将 Kuikly Android 平台的适配器层从业务代码中分离，作为独立的基础设施模块：

- **框架层** (`framework/`) - Kuikly 适配器、初始化逻辑、页面加载器
- **业务层** (`shared/`) - KMP 共享业务代码
- **应用层** (`androidApp/`) - Android 应用入口

## 目录结构

```
framework/src/main/java/com/sa/demo/kuikly/
├── KuiklyFramework.kt       # 统一初始化入口
├── ContextCodeHandler.kt    # 页面加载处理器
└── adapter/
    ├── KRLogAdapter.kt      # 日志适配器
    ├── KRImageAdapter.kt    # 图片加载适配器
    ├── KRThreadAdapter.kt   # 线程适配器
    ├── KRExceptionAdapter.kt # 异常处理适配器
    ├── KRRouterAdapter.kt   # 路由适配器
    ├── KRColorParserAdapter.kt # 颜色解析适配器
    └── KRFontAdapter.kt     # 字体适配器
```

## 核心组件

### KuiklyFramework

统一的初始化入口，提供 3 个 API（`initCoreEntry()` 移至 AndroidApplication 内联）：

| 方法 | 调用时机 | 说明 |
|------|---------|------|
| `initAdapters()` | Application.onCreate() | 初始化 6 个适配器（图片用 placeholder） |
| `setImageAdapter(context)` | Activity.onCreate() | 设置真实图片适配器（必须覆盖 placeholder） |
| `setRouterCallbacks(onNavigate, onClose)` | Activity.onCreate() | 设置路由回调 |

### ContextCodeHandler

页面加载处理器，封装 `KuiklyRenderViewBaseDelegator`：

- 初始化 Kuikly Render View
- 打开指定页面
- 监听性能数据和加载状态
- 处理异常和生命周期

### 7 个适配器

| 适配器 | 功能 | 类型 |
|--------|------|------|
| `KRLogAdapter` | 日志输出到 Android Log | object 单例 |
| `KRImageAdapter` | 图片加载（assets/file/http） | class（需 Context） |
| `KRThreadAdapter` | 子线程执行任务 | class |
| `KRExceptionAdapter` | 异常日志记录 | object 单例 |
| `KRRouterAdapter` | 页面跳转路由 | class（含回调） |
| `KRColorParserAdapter` | 颜色字符串解析 | class |
| `KRFontAdapter` | 自定义字体加载 | class |

## 依赖关系

```
androidApp
    ├── framework (Kuikly 适配器层)
    └── shared (业务逻辑)

framework
    └── Kuikly libs (core, core-render-android)
```

## 与原代码对比

| 原位置 | 新位置 | 变化 |
|--------|--------|------|
| `androidApp/.../kuikly/adapter/*` | `framework/.../adapter/*` | 迁移到独立模块 |
| `androidApp/.../kuikly/ContextCodeHandler.kt` | `framework/.../ContextCodeHandler.kt` | 迁移到独立模块 |
| `AndroidApplication` 内联适配器初始化 | `KuiklyFramework.initAdapters()` | 提取为统一 API |
| `MainActivity` 内联图片/路由设置 | `KuiklyFramework.setImageAdapter/setRouterCallbacks` | 提取为统一 API |

## 设计原则

1. **单一职责**：framework 只负责 Kuikly Android 适配层
2. **依赖隔离**：androidApp 不再直接依赖 Kuikly libs
3. **API 简化**：Application 和 Activity 代码量大幅减少
4. **可复用**：framework 可被其他 Android 项目引用

---

*最后更新: 2026-05-22*