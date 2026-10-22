plugins {
    alias(libs.plugins.android.library)
    kotlin("android")
}

android {
    namespace = "com.sa.demo.kuikly.framework"
    compileSdk = 34
    defaultConfig {
        minSdk = 24
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

dependencies {
    implementation(libs.kuikly.core)
    implementation(libs.kuikly.render.android)
    implementation(libs.kotlinx.coroutines.core)
}