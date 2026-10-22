/**
 * KRFontAdapter.ets - 鸿蒙端字体加载适配器
 *
 * 首版返回默认 null（对齐 Android 端返回 null），不抛异常。
 *
 * 对标 Android 端 KRFontAdapter.kt：
 *   - Android: getTypeface(fontFamily, result) → result(null)
 *   - 鸿蒙: getTypeface(fontFamily, result) → result(null)
 *
 * 对应 design.md A5、tasks.md 任务 6.5
 * 对应 spec 5.4.1.6 字体适配器
 */

import { IKRFontAdapter } from '@kuikly-open/render';

export class KRFontAdapter implements IKRFontAdapter {
    getTypeface(fontFamily: string, result: (typeface: Object | null) => void): void {
        // 首版返回 null，对齐 Android 端行为
        // 后续可扩展为通过 FontRegistry 加载自定义字体
        result(null);
    }
}