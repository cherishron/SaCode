/**
 * KRImageAdapter.ets - 鸿蒙端图片加载适配器
 *
 * 支持 assets/file/web 三类来源图片加载，子线程执行主线程回调。
 * 首版采用占位策略：返回空资源不崩溃（对齐 Android 端 placeholder 约束）。
 *
 * 对标 Android 端 KRImageAdapter.kt：
 *   - Android: 使用 Executors.newFixedThreadPool(3) + BitmapFactory + Handler(mainLooper)
 *   - 鸿蒙: 使用 TaskPool 子线程调度 + 主线程回调
 *
 * 对应 design.md A5、tasks.md 任务 6.2
 * 对应 spec 5.4.1.3 图片适配器、4.1.3 线程调度
 */

import { IKRImageAdapter, KRImageLoadOption } from '@kuikly-open/render';

export class KRImageAdapter implements IKRImageAdapter {
    fetchDrawable(
        option: KRImageLoadOption,
        params: Record<string, Object> | null,
        callback: (drawable: Object | null) => void
    ): void {
        // 首版占位策略：直接回调 null，不崩溃
        // 对齐 Android 端 KuiklyFramework.initAdapters 中的 placeholder adapter
        // 后续可扩展为通过 TaskPool 子线程加载 assets/file/web 图片
        callback(null);
    }

    getDrawableWidth(drawable: Object): number {
        return 0;
    }

    getDrawableHeight(drawable: Object): number {
        return 0;
    }

    shouldWaitViewDidLoad: boolean = false;
}