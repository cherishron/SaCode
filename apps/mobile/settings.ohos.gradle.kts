/*
 * HarmonyOS 独立编译链 settings
 * 与 settings.gradle.kts 平行，互不可见对方任务图
 * 使用 KBA 定制 Kotlin 工具链 2.0.21-KBA-010
 */

pluginManagement {
    repositories {
        maven("https://mirrors.tencent.com/nexus/repository/maven-tencent/")
        mavenCentral()
        gradlePluginPortal()
    }
    plugins {
        // KBA 定制 Kotlin Multiplatform 插件
        id("org.jetbrains.kotlin.multiplatform") version "2.0.21-KBA-010"
        // KSP 官方鸿蒙链路指定版本
        id("com.google.devtools.ksp") version "2.0.21-1.0.27"
    }
}

dependencyResolutionManagement {
    repositories {
        maven("https://mirrors.tencent.com/nexus/repository/maven-tencent/")
        mavenCentral()
    }
}

rootProject.name = "sa-app-ohos"
include("framework")
include("shared")