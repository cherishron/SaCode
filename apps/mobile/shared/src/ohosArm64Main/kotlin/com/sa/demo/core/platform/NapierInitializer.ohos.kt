package com.sa.demo.core.platform

/**
 * HarmonyOS (ohosArm64) Napier 初始化器
 * 空实现：Napier 无 ohosArm64 变体，不进入 ohos 依赖集
 * 鸿蒙日志可观测性由 KRLogAdapter → hilog 承担，能力不缺失
 */
actual object NapierInitializer {
    actual fun init() {
        // 空实现：Napier 库不进入 ohos 编译链
        // 日志经 KRLogAdapter → hilog 输出
    }
}