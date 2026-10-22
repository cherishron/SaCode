/**
 * KuiklyAdapterManager.ets - Kuikly 适配器注册管理器
 *
 * 单例管理器，确保 7 个平台适配器只注册一次。
 * 通过 KuiklyRenderAdapterManager 注入适配器，对齐 Android 端 KuiklyFramework.initAdapters 机制。
 *
 * 对标 Android 端 KuiklyFramework.kt：
 *   - Android: KuiklyRenderAdapterManager.krLogAdapter = KRLogAdapter 等
 *   - 鸿蒙: KuiklyRenderAdapterManager.krLogAdapter = new KRLogAdapter() 等
 *
 * 对应 design.md A5、tasks.md 任务 6.8
 * 对应 spec 5.4.1 适配器集合对齐
 * 参考官方实现：KuiklyUI/ohosApp/entry/src/main/ets/kuikly/adapters/AppKRRenderManager.ets
 */

import { KuiklyRenderAdapterManager } from '@kuikly-open/render';
import { KRLogAdapter } from './adapter/KRLogAdapter';
import { KRImageAdapter } from './adapter/KRImageAdapter';
import { KRThreadAdapter } from './adapter/KRThreadAdapter';
import { KRRouterAdapter } from './adapter/KRRouterAdapter';
import { KRFontAdapter } from './adapter/KRFontAdapter';
import { KRColorParserAdapter } from './adapter/KRColorParserAdapter';
import { KRExceptionAdapter } from './adapter/KRExceptionAdapter';
import { hilog } from '@kit.PerformanceAnalysisKit';

const LOG_DOMAIN = 0x30;
const LOG_TAG = 'KuiklyAdapterManager';

export class KuiklyAdapterManager {
    private static instance: KuiklyAdapterManager;
    private didInit: boolean = false;

    private constructor() {}

    public static getInstance(): KuiklyAdapterManager {
        if (!KuiklyAdapterManager.instance) {
            KuiklyAdapterManager.instance = new KuiklyAdapterManager();
        }
        return KuiklyAdapterManager.instance;
    }

    /**
     * 初始化并注册所有 7 个平台适配器
     * 确保只注册一次，禁止重复注册（官方约束）
     */
    public initIfNeed(): void {
        if (this.didInit) {
            return;
        }
        this.didInit = true;
        this.registerAdapters();
    }

    private registerAdapters(): void {
        // 1. KRLogAdapter → hilog 日志桥接
        KuiklyRenderAdapterManager.krLogAdapter = new KRLogAdapter();

        // 2. KRImageAdapter → 鸿蒙图片加载（首版占位策略）
        KuiklyRenderAdapterManager.krImageAdapter = new KRImageAdapter();

        // 3. KRThreadAdapter → 鸿蒙线程调度（TaskPool）
        KuiklyRenderAdapterManager.krThreadAdapter = new KRThreadAdapter();

        // 4. KRRouterAdapter → 鸿蒙路由
        KuiklyRenderAdapterManager.krRouterAdapter = new KRRouterAdapter();

        // 5. KRFontAdapter → 鸿蒙字体（首版返回 null）
        KuiklyRenderAdapterManager.krFontAdapter = new KRFontAdapter();

        // 6. KRColorParserAdapter → 鸿蒙颜色解析
        KuiklyRenderAdapterManager.krColorParseAdapter = new KRColorParserAdapter();

        // 7. KRExceptionAdapter → 鸿蒙异常处理（hilog 输出堆栈）
        KuiklyRenderAdapterManager.krUncaughtExceptionHandlerAdapter = new KRExceptionAdapter();

        hilog.info(LOG_DOMAIN, LOG_TAG, 'All 7 adapters registered successfully');
    }
}