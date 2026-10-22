/**
 * KRColorParserAdapter.ets - 鸿蒙端颜色解析适配器
 *
 * 将颜色字符串解析为鸿蒙端可用颜色值。
 * 对齐 Android 端 toLongOrNull().toInt() 实现，保证渲染颜色一致。
 *
 * 对标 Android 端 KRColorParserAdapter.kt：
 *   - Android: toColor(colorStr) = colorStr.toLongOrNull()?.toInt()
 *   - 鸿蒙: toColor(colorStr) = parseInt(colorStr, 16) 或 Number(colorStr)
 *
 * 对应 design.md A5、tasks.md 任务 6.6
 * 对应 spec 5.4.1.7 颜色解析适配器
 */

import { IKRColorParserAdapter } from '@kuikly-open/render';

export class KRColorParserAdapter implements IKRColorParserAdapter {
    toColor(colorStr: string): number | null {
        // 对齐 Android 端 colorStr.toLongOrNull()?.toInt()
        // Android 端接收的是十六进制颜色字符串（如 "0xFF0052D9"）或十进制字符串
        // toLongOrNull() 解析为 Long，toInt() 截断为 Int
        // 鸿蒙端需要返回对应的数值
        const parsed = Number(colorStr);
        if (isNaN(parsed)) {
            return null;
        }
        // 截断为 32 位整数，对齐 Android 端 toInt() 语义
        return parsed & 0xFFFFFFFF;
    }
}