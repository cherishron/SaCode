/*
 * shared 模块鸿蒙专用构建脚本
 * 与 shared/build.gradle.kts 物理隔离，Android 构建文件零 diff
 * ohos 版本常量收敛在此脚本内，不改 libs.versions.toml
 */

// ── ohos 版本常量（局部声明，不改动 libs.versions.toml） ──
val kuiklyOhosVersion = "2.6.0-2.0.21-ohos"
val kspOhosVersion = "2.0.21-1.0.27"
val kotlinKbaVersion = "2.0.21-KBA-010"

plugins {
    id("org.jetbrains.kotlin.multiplatform") version kotlinKbaVersion
    id("com.google.devtools.ksp") version kspOhosVersion
}

kotlin {
    // ── ohosArm64 Kotlin/Native 编译目标 ──
    ohosArm64 {
        binaries {
            sharedLib {
                baseName = "shared"
            }
        }
    }

    sourceSets {
        val commonMain by getting {
            dependencies {
                // Kuikly 系：三端 ohos 变体
                implementation("com.tencent.kuikly-open:core:$kuiklyOhosVersion")
                implementation("com.tencent.kuikly-open:core-annotations:$kuiklyOhosVersion")
                // KuiklyX 协程：ohos 变体
                implementation("com.tencent.kuiklyx-open:coroutines:1.5.0-2.0.21-ohos")
                // koin-core：ohos 变体（按可得性保留，R3 验证项）
                implementation("io.insert-koin:koin-core:3.5.6")
                // coroutines-core：ohos 变体
                implementation("org.jetbrains.kotlinx:kotlinx-coroutines-core:1.8.1")
                // napier 裁剪：无 ohosArm64 变体，commonMain 已核实无直接 import
                // serialization-json 裁剪：全库零引用
            }
        }

        val ohosArm64Main by getting {
            // ohosArm64Main 不引入额外第三方依赖
            // actual 实现仅依赖 commonMain expect 声明 + Kuikly -ohos 传递依赖
        }
    }
}

// ── KSP @Page 路由注册：ohosArm64 链路 ──
dependencies {
    "kspOhosArm64"("com.tencent.kuikly-open:core-ksp:$kuiklyOhosVersion")
}

// 产物输出路径：
// shared/build/bin/ohosArm64/debugShared/libshared.so
// shared/build/bin/ohosArm64/releaseShared/libshared.so
// shared/build/bin/ohosArm64/debugShared/libshared_api.h