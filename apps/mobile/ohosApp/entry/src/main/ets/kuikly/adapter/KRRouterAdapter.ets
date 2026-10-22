/**
 * KRRouterAdapter.ets - 鸿蒙端路由适配器
 *
 * 实现 openPage/closePage 路由事件，触发鸿蒙端导航回调。
 * 首版 SaUICatalogPage 单页场景，预留 ArkTS 原生页分支。
 *
 * 对标 Android 端 KRRouterAdapter.kt：
 *   - Android: openPage(context, pageName, pageData) / closePage(context)
 *   - 鸿蒙: openPage(context, pageName, pageData) / closePage(context)
 *
 * 对应 design.md A5、tasks.md 任务 6.4
 * 对应 spec 5.4.1.5 路由适配器
 */

import { IKRRouterAdapter, KRRecord } from '@kuikly-open/render';
import { common } from '@kit.AbilityKit';
import { hilog } from '@kit.PerformanceAnalysisKit';

const LOG_DOMAIN = 0x30;
const LOG_TAG = 'KuiklyRouter';

export class KRRouterAdapter implements IKRRouterAdapter {
    openPage(context: common.UIAbilityContext, pageName: string, pageData: KRRecord): void {
        hilog.info(LOG_DOMAIN, LOG_TAG, 'openPage: %{public}s', pageName);
        // 首版 SaUICatalogPage 单页场景，无需导航至其他页面
        // 后续多页面场景可通过 router.pushUrl 实现原生页跳转
    }

    closePage(context: common.UIAbilityContext): void {
        hilog.info(LOG_DOMAIN, LOG_TAG, 'closePage');
        // 首版无需关闭页面操作
    }
}