/**
 * KRThreadAdapter.ets - 鸿蒙端线程调度适配器
 *
 * 提供子线程调度能力，禁止阻塞 UI 主线程。
 * 使用 TaskPool 进行子线程任务调度。
 *
 * 对标 Android 端 KRThreadAdapter.kt：
 *   - Android: Executors.newFixedThreadPool(2) + execute(task)
 *   - 鸿蒙: TaskPool 子线程调度
 *
 * 对应 design.md A5、tasks.md 任务 6.3
 * 对应 spec 5.4.1.4 线程适配器、4.1.3 线程调度
 */

import { IKRThreadAdapter } from '@kuikly-open/render';
import { taskpool } from '@kit.ArkTS';

export class KRThreadAdapter implements IKRThreadAdapter {
    executeOnSubThread(task: () => void): void {
        // 使用 TaskPool 调度子线程任务
        // TaskPool 是鸿蒙推荐的轻量级并发机制，适合短耗时任务
        taskpool.execute(task);
    }

    stackSize(): number {
        return 0;
    }
}