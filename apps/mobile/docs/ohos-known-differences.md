# 鸿蒙端已知差异清单

> 对应 spec 6.4（差异维度）、design 2.5.2 KnownDifference 五字段
> 登记原则：凡 Android JVM 模式与鸿蒙 Kotlin/Native 模式之间存在差异的项须逐一登记，禁止静默空白

| componentName | description | androidBehavior | ohosBehavior | fallbackStrategy | recordedDate |
|---|---|---|---|---|---|
| KuiklyRenderCoreExecuteMode | 执行模式差异 | JVM（ContextCodeHandler.kt:27 硬编码 `KuiklyRenderCoreExecuteModeBase.JVM`） | Kotlin/Native（KN so 经 NAPI 注入，渲染核心内定，无模式参数） | 差异由渲染库吸收，commonMain 页面层零感知；登记差异，无需额外处理 | 2026-09-18 |
| KRLogAdapter | 日志适配器 | android.util.Log.i/d/e(tag, msg) → LogCat | hilog.info/debug/error(0x30, tag, '%{public}s', msg) | 鸿蒙端独立实现 KRLogAdapter.ets，实现 IKRLogAdapter 接口，经 hilog 输出，固定 DOMAIN=0x30 | 2026-09-18 |
| KRImageAdapter | 图片适配器 | Executors+BitmapFactory+Drawable+Handler(mainLooper)，assets/file/web 三源 | 首版占位策略：fetchDrawable 直接 callback(null)，不崩溃 | 对齐 Android 端 KuiklyFramework.initAdapters placeholder 行为；后续可扩展 TaskPool 子线程加载 | 2026-09-18 |
| KRThreadAdapter | 线程适配器 | Executors.newFixedThreadPool(2).execute(task) | taskpool.execute(task)（鸿蒙 TaskPool 并发机制） | 鸿蒙端独立实现 KRThreadAdapter.ets，禁阻塞 UI 主线程；stackSize() 返回 0 对齐 Android | 2026-09-18 |
| KRRouterAdapter | 路由适配器 | openPage(context, pageName, pageData) / closePage(context)，静态回调变量 | openPage(context, pageName, pageData) / closePage(context)，hilog 日志记录 | 首版 SaUICatalogPage 单页无需导航；预留 router.pushUrl 原生页跳转分支 | 2026-09-18 |
| KRFontAdapter | 字体适配器 | getTypeface(fontFamily, result) → result(null) | getTypeface(fontFamily, result) → result(null) | 完全对齐 Android 端返回 null 行为，不抛异常；后续可扩展 FontRegistry | 2026-09-18 |
| KRColorParserAdapter | 颜色解析适配器 | colorStr.toLongOrNull()?.toInt() | Number(colorStr) → isNaN 判断 → 截断为 32 位整数 | 对齐 Android 端 toLongOrNull().toInt() 语义，保证渲染颜色一致 | 2026-09-18 |
| KRExceptionAdapter | 异常适配器 | android.util.Log.e("KuiklyException", stackTraceToString()) | hilog.error(0x30, "KuiklyException", '%{public}s', name+message+stack) | 鸿蒙端独立实现 KRExceptionAdapter.ets，经 hilog 输出堆栈，不静默 | 2026-09-18 |
| 适配器注册机制 | 适配器注册方式 | KuiklyFramework.initAdapters() → KuiklyRenderAdapterManager 属性设置 | KuiklyAdapterManager 单例 → KuiklyRenderAdapterManager 属性设置 | 对齐官方 KuiklyUI/ohosApp AppKRRenderManager 模式；KuiklyViewDelegate 构造时调用 initIfNeed() 确保一次性注册 | 2026-09-18 |
| NapierInitializer | Napier 日志后端 | Antilog 桥接 LogCat（NapierInitializer.android.kt） | 空实现（Napier 无 ohosArm64 变体不进入依赖集） | 日志可观测性由 KRLogAdapter → hilog 承担，能力不缺失 | 2026-09-18 |
| PlatformContext | 平台上下文 | 包装 android.content.Context | 无平台依赖标记类 | 鸿蒙侧无系统能力依赖载体；getPlatformContext 保持"未初始化即抛出"语义 | 2026-09-18 |
| showToast | Toast 提示 | Toast.makeText(context, message, LENGTH_SHORT).show() | 空实现 | SaUICatalogPage Demo 未使用 toast（调用面为零）；如需补充经渲染库 Toast 组件路径验证 | 2026-09-18 |
| platformModule | DI 模块 | 含 androidContext/androidLogger（koin-android） | 空 Koin Module | 鸿蒙侧不引用 koin-android；appModule 当前为空 module，影响面为零 | 2026-09-18 |
| Kuikly 依赖制品 | 依赖坐标差异 | com.tencent.kuikly-open:core:2.6.0-2.0.21 | com.tencent.kuikly-open:core:2.6.0-2.0.21-ohos（三端 ohos 变体） | 版本号基线一致（2.6.0-2.0.21），ohos 后缀变体由官方 harmony-dev 方式 2 指定 | 2026-09-18 |
| KSP 版本 | KSP 处理器版本 | 2.0.21-1.0.28 | 2.0.21-1.0.27（官方鸿蒙链路指定版本） | 版本差异由官方链路要求决定，不影响 @Page 注解处理语义 | 2026-09-18 |
| napier | Napier 依赖 | io.github.aakira:napier:2.6.1（有 androidMain actual 使用） | 裁剪（无 ohosArm64 变体） | commonMain 已核实无 Napier 直接 import；androidMain 使用不受影响 | 2026-09-18 |
| kotlinx-serialization-json | 序列化依赖 | org.jetbrains.kotlinx:kotlinx-serialization-json:1.6.3 | 裁剪（全库零引用） | commonMain 和 androidMain 均无 serialization-json 直接使用 | 2026-09-18 |
| 构建链路 | 构建工具链 | 单一 Gradle（settings.gradle.kts） | Gradle KBA 链（settings.ohos.gradle.kts）+ hvigor ohpm 两级 | 独立编译链物理隔离，Android 构建文件零 diff | 2026-09-18 |
| 生命周期桥接 | 生命周期联动 | 显式 delegator.onResume/onPause（MainActivity） | ArkUI 组件树自动联动（aboutToAppear/aboutToDisappear） | 壳层不重复实现 onPause/onResume 语义；事件通道 + hilog 记录 | 2026-09-18 |
| 页面注册兜底 | 页面路由注册 | 手动 BridgeManager.registerPageRouter（MainActivity:28-33） | 编译期 KSP 生成 + clean 重建规程 | 鸿蒙侧无法复制手动注册模式；构建文档固化 clean 重建规程 + 容器"页面未找到"错误态 | 2026-09-18 |
| 渲染宿主 | 渲染容器 | core-render-android（View 体系） | @kuikly-open/render（ArkUI C-API） | DSL 统一，由渲染库吸收差异；ohpm 版本与 KMP Kuikly 版本一致 | 2026-09-18 |
| NAPI 桥接层 | C++ NAPI 模块 | 无（Android 端 JVM 进程内直接执行） | napi_init.cpp + libshared_api.h + CMakeLists.txt（dlopen 加载 libshared.so，经 NAPI 暴露 initKuikly/loadPage） | NAPI 层包装 C ABI 符号调用，so 加载失败返回错误码驱动容器错误态 | 2026-09-18 |
| KuiklyViewDelegate | 视图委托 | ContextCodeHandler.kt（KuiklyRenderViewBaseDelegatorDelegate） | KuiklyViewDelegate.ets（IKuiklyViewDelegate） | 委托回调职责对齐：性能监控/生命周期/自定义 View-Module 注册（首版空 Map） | 2026-09-18 |
| EntryAbility 初始化 | 应用初始化入口 | AndroidApplication.onCreate（Napier→PlatformContext→Koin→Adapters→CoreEntry） | EntryAbility.onCreate（NAPI initKuikly → AppStorage 传递 handler） | 鸿蒙侧无 Application 概念，初始化收敛到 Ability onCreate + NAPI 调用 | 2026-09-18 |
| 容器页面 | 页面承载 | MainActivity.loadPage + ContextCodeHandler.openPage（ViewGroup 挂载） | Index.ets Kuikly 组件（pageName/pageData/delegate/nativeManager） | ArkTS 容器组装 Kuikly 组件参数，加载状态机驱动 Loading/Loaded/Error 态 | 2026-09-18 |
| 返回键处理 | 返回键桥接 | MainActivity.dispatchKeyEvent → delegator.onBackPressed() | Index.ets onBackPress() → controller.sendBackPressEvent() | controller 未就绪时返回 false 防卡死；消费结果决定是否退出 | 2026-09-18 |
| onDestroy | 销毁生命周期 | MainActivity.onDestroy → delegator.onDetach() | EntryAbility.onDestroy → AppStorage 事件通道 | 模板缺失 onDestroy 已补齐；ArkUI 组件树 aboutToDisappear 自动联动资源清理 | 2026-09-18 |
| 沉浸式窗口 | 窗口安全区 | XML 布局 fitsSystemWindows / WindowInsets | windowStage.getMainWindowSync().setWindowLayoutFullScreen(true) | EntryAbility onWindowStageCreate 设置全屏沉浸式；initialSize 传入窗口尺寸避免重复排版 | 2026-09-18 |