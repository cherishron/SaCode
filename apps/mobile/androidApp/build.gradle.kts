plugins {
    alias(libs.plugins.android.application)
    kotlin("android")
}

android {
    namespace = "com.sa.demo"
    compileSdk = 34

    // 签名材料不入库：release 签名只从环境变量注入，未配置时不创建 release 签名配置。
    // 迁移自 sa-app 的同名文件；原文件的硬编码默认口令已移除（该口令曾以源码字面量存在，
    // 须另行评估轮换，不在本仓库记录其值）。debug 构建不依赖这些变量。
    val releaseStorePath = System.getenv("SACODE_ANDROID_KEYSTORE")
    val releaseStorePassword = System.getenv("KEYSTORE_PASSWORD")
    val releaseKeyAlias = System.getenv("KEY_ALIAS") ?: "sioc"
    val releaseKeyPassword = System.getenv("KEY_PASSWORD")
    val hasReleaseSigning = !releaseStorePath.isNullOrBlank() &&
        !releaseStorePassword.isNullOrBlank() &&
        !releaseKeyPassword.isNullOrBlank()

    signingConfigs {
        if (hasReleaseSigning) {
            create("release") {
                storeFile = file(releaseStorePath!!)
                storePassword = releaseStorePassword
                keyAlias = releaseKeyAlias
                keyPassword = releaseKeyPassword
                enableV1Signing = true
                enableV2Signing = true
            }
        }
    }

    defaultConfig {
        applicationId = "com.sa.demo"
        minSdk = 24
        targetSdk = 34
        versionCode = 1
        versionName = "1.0.0"
    }

    buildTypes {
        debug {
            isDebuggable = true
            signingConfig = signingConfigs.getByName("debug")
        }

        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
            // 缺签名配置时不静默降级为 debug 签名：release 产物须显式提供签名材料。
            if (hasReleaseSigning) {
                signingConfig = signingConfigs.getByName("release")
            }
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    buildFeatures {
        viewBinding = true
    }
}

dependencies {
    implementation(project(":framework"))
    implementation(project(":shared"))

    implementation(libs.kuikly.core)
    implementation(libs.kuikly.render.android)
    implementation(libs.koin.core)
    implementation("io.insert-koin:koin-android:3.5.6")
    implementation(libs.kotlinx.coroutines.android)

    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("com.google.android.material:material:1.12.0")
    implementation("androidx.constraintlayout:constraintlayout:2.1.4")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.8.4")
    implementation("androidx.activity:activity-ktx:1.9.1")
}
