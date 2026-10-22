/**
 * index.d.ts - NAPI 接口声明
 *
 * 声明 initKuikly 和 loadPage 两个 NAPI 接口，
 * 供 ArkTS 侧通过 import 引用。
 *
 * 对应 design.md C1、tasks.md 任务 5.1
 * 与 napi_init.cpp 导出的函数一一对应
 */

/**
 * 初始化 Kuikly Native 运行时
 *
 * @returns 运行时句柄，>0 表示成功，<=0 表示失败
 *          -1: so 加载失败 (ASSET_MISSING)
 *          -2: 符号解析失败 (PAGE_INIT_ERROR)
 *          -3: initKuikly 函数指针为空 (PAGE_INIT_ERROR)
 */
export function initKuikly(): number;

/**
 * 加载 Kuikly 页面
 *
 * @param pageName 页面路由名（如 "SaUICatalogPage"）
 * @param params   页面参数 JSON 字符串（如 '{"appId":1,"debug":1}'）
 * @returns 加载结果，>0 表示成功，<=0 表示失败
 */
export function loadPage(pageName: string, params: string): number;