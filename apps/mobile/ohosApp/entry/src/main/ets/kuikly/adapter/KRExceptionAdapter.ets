/**
 * KRExceptionAdapter.ets - 鸿蒙端异常处理适配器
 *
 * 将未捕获异常堆栈输出至 hilog，不静默。
 *
 * 对标 Android 端 KRExceptionAdapter.kt：
 *   - Android: uncaughtException(throwable) → Log.e("KuiklyException", stackTrace)
 *   - 鸿蒙: uncaughtException(throwable) → hilog.error(domain, tag, stackTrace)
 *
 * 对应 design.md A5、tasks.md 任务 6.7
 * 对应 spec 5.4.1.8 异常适配器、4.2.3 未捕获异常处理
 */

import { IKRUncaughtExceptionHandlerAdapter } from '@kuikly-open/render';
import { hilog } from '@kit.PerformanceAnalysisKit';

const LOG_DOMAIN = 0x30;
const LOG_TAG = 'KuiklyException';

export class KRExceptionAdapter implements IKRUncaughtExceptionHandlerAdapter {
    uncaughtException(throwable: Error): void {
        // 输出异常堆栈至 hilog，不静默
        const stackTrace = throwable.stack || '';
        const message = `${throwable.name}: ${throwable.message}\n${stackTrace}`;
        hilog.error(LOG_DOMAIN, LOG_TAG, '%{public}s', message);
    }
}