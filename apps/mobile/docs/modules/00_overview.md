# Module概述

> 来源：https://kuikly.tds.qq.com/API/modules/overview.html

`Kuikly`作为一个跨端的UI框架, 他本身不具备调用平台API的能力, 但是`Kuikly`提供了一套`Module`机制，你可以通过`Module`机制将平台的API暴露给`Kuikly`侧调用。

`Kuikly`内置了一些通用的`Module`, 如果这些`Module`不满足你业务诉求时, 你可以通过扩展原生API来自定义`Module`, 将更多的宿主平台API暴露给`Kuikly`侧使用。

## Kuikly内置的Module

- [MemoryCacheModule](01_memory_cache.md) - 内存缓存
- [SharedPreferencesModule](02_sp.md) - 持久化存储
- [RouterModule](03_router.md) - 页面路由
- [NetworkModule](04_network.md) - 网络请求
- NotifyModule - 通知模块
- SnapshotModule - 截图模块
- CodecModule - 编解码模块
- CalendarModule - 日历模块

## Module使用方式

在Kuikly页面中，可以通过`pager.getModule()`或`pager.acquireModule()`方法获取模块实例。

```kotlin
// 获取模块
val routerModule = pager.getModule("router")

// 使用模块
routerModule?.openPage(...)
```