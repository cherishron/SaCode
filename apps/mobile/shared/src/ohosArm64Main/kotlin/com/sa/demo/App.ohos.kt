package com.sa.demo

import org.koin.core.module.Module
import org.koin.dsl.module

/**
 * HarmonyOS (ohosArm64) platformModule 实现
 * 返回空 Koin Module，不引用 koin-android
 *鸿蒙侧 DI 初始化保持可用（koin-core ohosArm64 变体）
 */
actual fun platformModule(application: Any?): Module = module {
    // 空模块：鸿蒙侧无 androidContext/androidLogger 等平台绑定
}