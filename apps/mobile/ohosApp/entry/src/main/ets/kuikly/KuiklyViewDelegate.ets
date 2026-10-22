/**
 * KuiklyViewDelegate.ets - Kuikly 视图委托实现
 *
 * 管理 Kuikly 页面加载、生命周期联动。
 * 继承 IKuiklyViewDelegate，实现自定义 View/Module 注册、性能监控、生命周期回调。
 * 在构造时通过 KuiklyAdapterManager 一次性注册 7 个平台适配器。
 *
 * 对应 design.md A2、tasks.md 任务 5.3/6.8/7.2
 * 对标 Android 端 ContextCodeHandler.kt 的委托回调职责
 */

import { IKuiklyViewDelegate, KRMonitorType, IKuiklyRenderViewLifecycleCallback } from '@kuikly-open/render';
import { hilog } from '@kit.PerformanceAnalysisKit';
import { KuiklyAdapterManager } from './KuiklyAdapterManager';

const LOG_DOMAIN = 0x0001;
const LOG_TAG = 'KuiklyViewDelegate';

export class KuiklyViewDelegate extends IKuiklyViewDelegate {
    constructor() {
        super();
        // 在 KuiklyViewDelegate 构造时一次性注册 7 个平台适配器
        // 对应 tasks.md 6.8：在 initKuikly 调用前完成适配器构造并注册
        // KuiklyAdapterManager 单例确保只注册一次，禁止重复注册（官方约束）
        KuiklyAdapterManager.getInstance().initIfNeed();
    }

    /**
     * 自定义 Render View 注册表（首版空 Map）
     *
     * 对应 design.md A2：getCustomRenderViewCreatorRegisterMap() 返回空 Map
     * 后续可在此注册自定义 View（如 KRMyDemoCustomView）
     */
    getCustomRenderViewCreatorRegisterMap(): Map<string, KRRenderViewExportCreator> {
        const map: Map<string, KRRenderViewExportCreator> = new Map();
        // 首版无自定义 View，预留注册点
        return map;
    }

    /**
     * 自定义 Render Module 注册表（首版空 Map）
     *
     * 对应 design.md A2：getCustomRenderModuleCreatorRegisterMap() 返回空 Map
     * 后续可在此注册自定义 Module
     */
    getCustomRenderModuleCreatorRegisterMap(): Map<string, KRRenderModuleExportCreator> {
        const map: Map<string, KRRenderModuleExportCreator> = new Map();
        // 首版无自定义 Module，预留注册点
        return map;
    }

    /**
     * 性能监控类型
     *
     * 对标 Android 端 ContextCodeHandler.kt:28：performanceMonitorTypes() = listOf(KRMonitorType.LAUNCH)
     * 对应 spec 4.1 性能：页面加载性能数据输出
     */
    performanceMonitorTypes(): Array<KRMonitorType> {
        return [KRMonitorType.LAUNCH];
    }

    /**
     * 启动性能数据回调
     *
     * 对标 Android 端 ContextCodeHandler.kt:24-26：onGetLaunchData(data: KRLaunchData)
     * 对应 spec 4.1 性能：KRLaunchData 启动数据输出至 hilog
     */
    onGetLaunchData(data: Record<string, number>): void {
        hilog.info(LOG_DOMAIN, LOG_TAG, '[onGetLaunchData] %{public}s', JSON.stringify(data));
    }

    /**
     * 性能数据回调
     *
     * 对标 Android 端 ContextCodeHandler.kt:21-23：onGetPerformanceData(data: KRPerformanceData)
     */
    onGetPerformanceData(data: Record<string, number>): void {
        hilog.info(LOG_DOMAIN, LOG_TAG, '[onGetPerformanceData] %{public}s', JSON.stringify(data));
    }

    /**
     * Kuikly 渲染视图生命周期回调
     *
     * 对标 Android 端 ContextCodeHandler.kt:29-37：
     *   onKuiklyRenderViewCreated / onKuiklyRenderContentViewCreated
     *
     * 对应 spec 4.2.4 生命周期一致性：
     *   ArkUI 组件树生命周期与 UIAbility 天然联动，
     *   此回调用于日志记录，不重复实现 onPause/onResume 语义
     */
    getKuiklyRenderViewLifecycleCallback(): IKuiklyRenderViewLifecycleCallback | null {
        return {
            onKuiklyRenderViewCreated(): void {
                hilog.info(LOG_DOMAIN, LOG_TAG, 'KuiklyRenderView created');
            },
            onKuiklyRenderViewDestroyed(): void {
                hilog.info(LOG_DOMAIN, LOG_TAG, 'KuiklyRenderView destroyed');
            }
        };
    }
}
