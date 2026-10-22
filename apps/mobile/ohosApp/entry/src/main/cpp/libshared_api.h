/**
 * libshared_api.h - C-ABI 声明头文件
 *
 * 声明 libshared.so（Kotlin/Native ohosArm64 产物）导出的
 * Kuikly 运行时初始化与页面加载入口函数签名。
 *
 * 此头文件由 Kotlin/Native 编译器自动生成（shared/build/bin/ohosArm64/debugShared/libshared_api.h），
 * 此处为 NAPI 层引用的前置声明。当 so 产物同步至 entry/src/main/cpp/ 后，
 * 可直接使用编译器生成的版本替换。
 *
 * 对应 design.md C1 接口：libshared_symbols()->kotlin.root.initKuikly()
 */

#ifndef LIBSHARED_API_H
#define LIBSHARED_API_H

#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

/**
 * Kotlin/Native 导出符号结构体。
 *
 * Kotlin/Native 编译器将所有导出函数按命名空间组织到此结构体中。
 * 通过 libshared_symbols() 获取结构体指针后，按命名路径访问各函数。
 */
typedef struct libshared_symbols {
    struct {
        struct {
            /**
             * 初始化 Kuikly Native 运行时。
             *
             * @return 运行时句柄（int32），>0 表示成功，<=0 表示失败
             *
             * 对应 design.md C1：
             *   handler = libshared_symbols()->kotlin.root.initKuikly()
             *
             * 前置条件：libshared.so 已随 entry 链接
             * 后置条件：Kuikly 运行时就绪，可加载页面
             * 异常映射：so 加载失败/符号缺失 → NAPI 返回失败 → 容器错误态 PAGE_INIT_ERROR
             */
            int32_t (*initKuikly)(void);

            /**
             * 加载 Kuikly 页面。
             *
             * @param pageName 页面路由名（如 "TDCatalogPage"）
             * @param params   页面参数 JSON 字符串（如 '{"appId":1,"debug":1}'）
             * @return 加载结果，>0 表示成功，<=0 表示失败
             *
             * 对应 spec 5.3.1 页面渲染：ArkTS 容器经 NAPI 调用加载 TDCatalogPage
             */
            int32_t (*loadPage)(const char* pageName, const char* params);
        } root;
    } kotlin;
} libshared_symbols;

/**
 * 获取 Kotlin/Native 导出符号结构体指针。
 *
 * @return libshared_symbols 结构体指针，NULL 表示 so 未正确加载
 *
 * 此函数由 Kotlin/Native 运行时自动提供，无需手动声明。
 * so 加载后，通过 dlsym 获取此函数指针即可访问所有导出符号。
 */
libshared_symbols* libshared_symbols(void);

#ifdef __cplusplus
}
#endif

#endif /* LIBSHARED_API_H */