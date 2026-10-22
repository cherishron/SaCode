pluginManagement {
    repositories {
        google()
        gradlePluginPortal()
        mavenCentral()
        maven("https://mirrors.tencent.com/nexus/repository/maven-tencent/")
    }
}

plugins {
    id("org.gradle.toolchains.foojay-resolver-convention") version "1.0.0"
}

dependencyResolutionManagement {
    repositories {
        google()
        mavenCentral()
        maven("https://mirrors.tencent.com/nexus/repository/maven-tencent/")
    }
}

rootProject.name = "sa-app"
include("framework")
include("shared")
include("androidApp")
