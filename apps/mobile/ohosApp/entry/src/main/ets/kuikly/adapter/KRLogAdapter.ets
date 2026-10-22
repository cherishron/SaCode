/**
 * KRLogAdapter.ets - 鸿蒙端日志适配器
 *
 * 将 Kuikly 渲染层日志桥接至鸿蒙 hilog，使用固定 DOMAIN 和 TAG 便于过滤检索。
 *
 * 对标 Android 端 KRLogAdapter.kt：
 *   - Android: android.util.Log.i/d/e(tag, msg)
 *   - 鸿蒙: hilog.info/debug/error(domain, tag, '%{public}s', msg)
 *
 * 对应 design.md A5、tasks.md 任务 6.1
 * 对应 spec 5.4.1.2 日志适配器、4.4.1 日志可观测
 */

import { IKRLogAdapter } from '@kuikly-open/render';
import { hilog } from '@kit.PerformanceAnalysisKit';

const LOG_DOMAIN = 0x30;  // 固定 DOMAIN，便于 hilog 过滤
const LOG_TAG = 'KuiklyLog';

export class KRLogAdapter implements IKRLogAdapter {
    i(tag: string, msg: string): void {
        hilog.info(LOG_DOMAIN, tag, '%{public}s', msg);
    }

    d(tag: string, msg: string): void {
        hilog.debug(LOG_DOMAIN, tag, '%{public}s', msg);
    }

    e(tag: string, msg: string): void {
        hilog.error(LOG_DOMAIN, tag, '%{public}s', msg);
    }
}