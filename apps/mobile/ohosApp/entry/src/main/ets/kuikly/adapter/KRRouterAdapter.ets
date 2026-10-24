/**
 * KRRouterAdapter.ets - 鸿蒙端路由适配器
 *
 * 实现 openPage/closePage 路由事件，触发鸿蒙端导航回调。
 * 当前仅记录路由事件；产品多页导航尚未接通，不能视为已支持。
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
        // 产品多页面导航待实现；这里尚未触发页面切换。
    }

    closePage(context: common.UIAbilityContext): void {
        hilog.info(LOG_DOMAIN, LOG_TAG, 'closePage');
        // 首版无需关闭页面操作
    }
}