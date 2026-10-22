/**
 * napi_init.cpp - NAPI 桥接层入口
 *
 * 暴露两个 NAPI 接口供 ArkTS 调用：
 *   1. initKuikly()  — 初始化 Kuikly Native 运行时
 *   2. loadPage(pageName, params) — 加载 Kuikly 页面
 *
 * 对应 design.md 模块 B、tasks.md 任务 5.1
 * 对应 spec 5.2.1.2（NAPI 桥接入口）、5.2.3.1（so 加载失败）
 */

#include "napi/native_api.h"
#include "libshared_api.h"
#include <hilog/log.h>
#include <dlfcn.h>
#include <string>

#define LOG_DOMAIN 0x0001
#define LOG_TAG "KuiklyNAPI"

// libshared.so 动态加载句柄
static void* g_sharedLibHandle = nullptr;
// libshared_symbols 函数指针类型
typedef libshared_symbols* (*libshared_symbols_fn_t)(void);
// 缓存的 symbols 指针
static libshared_symbols* g_symbols = nullptr;

/**
 * 加载 libshared.so 并获取导出符号结构体。
 *
 * @return 0 表示成功，-1 表示 so 加载失败，-2 表示符号解析失败
 */
static int32_t loadSharedLib() {
    if (g_symbols != nullptr) {
        return 0; // 已加载
    }

    // 尝试加载 libshared.so
    g_sharedLibHandle = dlopen("libshared.so", RTLD_NOW | RTLD_LOCAL);
    if (g_sharedLibHandle == nullptr) {
        HILOG_ERROR(LOG_DOMAIN, LOG_TAG, "Failed to load libshared.so: %{public}s", dlerror());
        return -1;
    }

    // 获取 libshared_symbols 函数指针
    auto symbolsFn = (libshared_symbols_fn_t)dlsym(g_sharedLibHandle, "libshared_symbols");
    if (symbolsFn == nullptr) {
        HILOG_ERROR(LOG_DOMAIN, LOG_TAG, "Failed to find libshared_symbols: %{public}s", dlerror());
        dlclose(g_sharedLibHandle);
        g_sharedLibHandle = nullptr;
        return -2;
    }

    // 获取符号结构体
    g_symbols = symbolsFn();
    if (g_symbols == nullptr) {
        HILOG_ERROR(LOG_DOMAIN, LOG_TAG, "libshared_symbols() returned null");
        dlclose(g_sharedLibHandle);
        g_sharedLibHandle = nullptr;
        return -2;
    }

    HILOG_INFO(LOG_DOMAIN, LOG_TAG, "libshared.so loaded successfully");
    return 0;
}

/**
 * NAPI: initKuikly()
 *
 * 初始化 Kuikly Native 运行时。
 *
 * ArkTS 调用方式：const handler = Napi.initKuikly()
 *
 * @return 运行时句柄（number），>0 表示成功，<=0 表示失败
 *         -1: so 加载失败 (ASSET_MISSING)
 *         -2: 符号解析失败 (PAGE_INIT_ERROR)
 *         -3: initKuikly 函数指针为空 (PAGE_INIT_ERROR)
 *
 * 对应 design.md C1：handler = libshared_symbols()->kotlin.root.initKuikly()
 */
static napi_value InitKuikly(napi_env env, napi_callback_info info) {
    int32_t handler = 0;

    // 1. 加载 libshared.so
    int32_t loadResult = loadSharedLib();
    if (loadResult != 0) {
        HILOG_ERROR(LOG_DOMAIN, LOG_TAG, "initKuikly: libshared load failed, code=%{public}d", loadResult);
        handler = loadResult; // -1 或 -2
        napi_value result;
        napi_create_int32(env, handler, &result);
        return result;
    }

    // 2. 调用 initKuikly 初始化运行时
    if (g_symbols->kotlin.root.initKuikly == nullptr) {
        HILOG_ERROR(LOG_DOMAIN, LOG_TAG, "initKuikly: function pointer is null");
        handler = -3;
        napi_value result;
        napi_create_int32(env, handler, &result);
        return result;
    }

    handler = g_symbols->kotlin.root.initKuikly();
    if (handler > 0) {
        HILOG_INFO(LOG_DOMAIN, LOG_TAG, "initKuikly: success, handler=%{public}d", handler);
    } else {
        HILOG_ERROR(LOG_DOMAIN, LOG_TAG, "initKuikly: failed, handler=%{public}d", handler);
    }

    napi_value result;
    napi_create_int32(env, handler, &result);
    return result;
}

/**
 * NAPI: loadPage(pageName: string, params: string)
 *
 * 加载 Kuikly 页面。
 *
 * ArkTS 调用方式：const result = Napi.loadPage("TDCatalogPage", '{"appId":1,"debug":1}')
 *
 * @param pageName 页面路由名（如 "TDCatalogPage"）
 * @param params   页面参数 JSON 字符串
 * @return 加载结果，>0 表示成功，<=0 表示失败
 *
 * 对应 spec 5.3.1 页面渲染：ArkTS 容器经 NAPI 调用加载 TDCatalogPage
 */
static napi_value LoadPage(napi_env env, napi_callback_info info) {
    size_t argc = 2;
    napi_value args[2];
    napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);

    if (argc < 2) {
        HILOG_ERROR(LOG_DOMAIN, LOG_TAG, "loadPage: requires 2 arguments");
        napi_value result;
        napi_create_int32(env, -1, &result);
        return result;
    }

    // 获取 pageName 参数
    size_t pageNameLen = 0;
    napi_get_value_string_utf8(env, args[0], nullptr, 0, &pageNameLen);
    std::string pageName(pageNameLen, '\0');
    napi_get_value_string_utf8(env, args[0], &pageName[0], pageNameLen + 1, &pageNameLen);

    // 获取 params 参数
    size_t paramsLen = 0;
    napi_get_value_string_utf8(env, args[1], nullptr, 0, &paramsLen);
    std::string params(paramsLen, '\0');
    napi_get_value_string_utf8(env, args[1], &params[0], paramsLen + 1, &paramsLen);

    HILOG_INFO(LOG_DOMAIN, LOG_TAG, "loadPage: pageName=%{public}s, params=%{public}s",
               pageName.c_str(), params.c_str());

    // 确保 so 已加载
    if (g_symbols == nullptr) {
        int32_t loadResult = loadSharedLib();
        if (loadResult != 0) {
            HILOG_ERROR(LOG_DOMAIN, LOG_TAG, "loadPage: libshared not loaded, code=%{public}d", loadResult);
            napi_value result;
            napi_create_int32(env, loadResult, &result);
            return result;
        }
    }

    // 调用 loadPage
    if (g_symbols->kotlin.root.loadPage == nullptr) {
        HILOG_ERROR(LOG_DOMAIN, LOG_TAG, "loadPage: function pointer is null");
        napi_value result;
        napi_create_int32(env, -3, &result);
        return result;
    }

    int32_t loadResult = g_symbols->kotlin.root.loadPage(pageName.c_str(), params.c_str());
    if (loadResult > 0) {
        HILOG_INFO(LOG_DOMAIN, LOG_TAG, "loadPage: success, result=%{public}d", loadResult);
    } else {
        HILOG_ERROR(LOG_DOMAIN, LOG_TAG, "loadPage: failed, result=%{public}d", loadResult);
    }

    napi_value result;
    napi_create_int32(env, loadResult, &result);
    return result;
}

/**
 * NAPI 模块导出初始化函数
 *
 * 将 initKuikly 和 loadPage 导出为 ArkTS 可调用的接口
 */
static napi_value InitExport(napi_env env, napi_value exports) {
    napi_property_descriptor desc[] = {
        {"initKuikly", nullptr, InitKuikly, nullptr, nullptr, nullptr, napi_default, nullptr},
        {"loadPage", nullptr, LoadPage, nullptr, nullptr, nullptr, napi_default, nullptr},
    };
    napi_define_properties(env, exports, sizeof(desc) / sizeof(desc[0]), desc);
    return exports;
}

/**
 * NAPI 模块描述符
 *
 * nm_modname="entry" 对应 ArkTS import 时的模块名
 * nm_register_func=InitExport 在模块加载时调用，注册导出函数
 */
static napi_module kuiklyNapiModule = {
    .nm_version = 1,
    .nm_flags = 0,
    .nm_filename = "entry/KuiklyNapi",
    .nm_register_func = InitExport,
    .nm_modname = "entry",
    .nm_priv = nullptr,
    .reserved = {0},
};

/**
 * NAPI 模块自动注册入口
 *
 * 使用 __attribute__((constructor)) 确保模块在库加载时自动注册
 */
extern "C" __attribute__((constructor)) void RegisterKuiklyNapiModule(void) {
    napi_module_register(&kuiklyNapiModule);
}
