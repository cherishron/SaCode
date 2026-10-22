# 快速开始

欢迎来到 Kuikly UI 框架！本指南将帮助您在几分钟内搭建起第一个 Kuikly 应用。

## 前置要求

### 开发环境

- **Java Development Kit (JDK)**: 17 或更高版本
- **Android Studio**: Hedgehog (2023.1.1) 或更高版本
- **Git**: 用于版本控制
- **网络连接**: 下载依赖和文档

### 项目配置

确保您的 `gradle.properties` 文件包含以下内容：

```properties
# Kotlin 编译选项
kotlin.code.style=official

# Android 配置
android.useAndroidX=true
android.nonTransitiveRClass=true

# 构建优化
org.gradle.jvmargs=-Xmx4g -XX:MaxPermSize=512m
```

## 创建新项目

### 方法一：使用 Android Studio 模板

1. 打开 Android Studio
2. 选择 `File → New → Project`
3. 在项目向导中选择 **Empty Activity**
4. 配置项目名称（例如：MyKuiklyApp）
5. 确保语言选择 **Kotlin**
6. 点击 **Finish** 完成项目创建

### 方法二：手动创建

如果您想从头开始，可以复制本项目的结构：

```bash
git clone https://github.com/Tencent-TDS/KuiklyUI.git
cd MyKuiklyApp
# 复制共享模块和配置文件
```

## 添加 KuiklyUI 依赖

### 1. 修改 build.gradle.kts (根目录)

```kotlin
plugins {
    alias(libs.plugins.android.application) apply false
    alias(libs.plugins.kotlin.multiplatform) apply false
    alias(libs.plugins.kotlin.serialization) apply false
}

allprojects {
    repositories {
        google()
        mavenCentral()
        // 腾讯 Maven 仓库（Kuikly 专用）
        maven {
            url = uri("https://mirrors.tencent.com/nexus/repository/maven-tencent/")
        }
    }
}
```

### 2. 修改 app/build.gradle.kts

```kotlin
plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.multiplatform")
    id("org.jetbrains.kotlin.plugin.serialization")
}

android {
    namespace = "com.example.mykuiklyapp"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.example.mykuiklyapp"
        minSdk = 24
        targetSdk = 34
        versionCode = 1
        versionName = "1.0"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

dependencies {
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.lifecycle.runtime.ktx)
    
    // KuiklyUI 核心依赖
    implementation("com.tencent.kuikly:core:2.6.0-2.0.21")
    implementation("com.tencent.kuikly:core-render-android:2.6.0-2.0.21")
    implementation("com.tencent.kuikly:annotations:2.6.0-2.0.21")
    
    // Koin 依赖注入
    implementation("io.insert-koin:koin-core:3.5.6")
    implementation("io.insert-koin:koin-android:3.5.6")
    
    // Kotlinx Serialization
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.6.3")
}
```

### 3. 创建共享模块

在项目根目录下创建 `shared` 模块：

#### shared/build.gradle.kts

```kotlin
plugins {
    kotlin("multiplatform")
    kotlin("plugin.serialization")
    id("com.squareup.sqldelight")
}

kotlin {
    androidTarget()

    sourceSets {
        val commonMain by getting {
            dependencies {
                implementation("com.tencent.kuikly:core:2.6.0-2.0.21")
                implementation("io.insert-koin:koin-core:3.5.6")
                implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.6.3")
                implementation("org.jetbrains.kotlinx:kotlinx-coroutines-core:1.8.1")
            }
        }
        
        val androidMain by getting {
            dependencies {
                implementation("androidx.core:core-ktx:1.12.0")
                implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.7.0")
                implementation("com.squareup.sqldelight:android-driver:2.0.2")
            }
        }
    }
}

sqldelight {
    databases {
        create("AppDatabase") {
            packageName.set("com.example.app.database")
        }
    }
}
```

## 编写第一个页面

### 1. 创建 Hello World 页面

在 `shared/src/commonMain/kotlin/com/example/app/` 目录下创建：

#### HelloWorld.kt

```kotlin
package com.example.app

import androidx.compose.ui.graphics.Color
import com.tencent.kuikly.core.Page
import com.tencent.kuikly.core.Pager
import com.tencent.kuikly.core.ViewBuilder
import com.tencent.kuikly.components.*
import com.tencent.kuikly.attr
import com.tencent.kuikly.event

@Page("HelloWorld")
class HelloWorld : Pager() {

    var message by observable("Hello, Kuikly!")

    override fun body(): ViewBuilder = {
        Column {
            attr {
                flexDirectionColumn()
                justifyContent(JustifyContent.CENTER)
                alignItems(AlignItems.CENTER)
                backgroundColor(Color.WHITE)
                padding(16f)
                height(100f) // 100% 高度
            }

            Text {
                attr {
                    text(message)
                    fontSize(24f)
                    color(Color.BLUE)
                    fontWeightBold()
                }
            }

            Button {
                titleAttr { text("点击更新消息") }
                attr {
                    margin(top = 16f)
                    backgroundColor(Color.LIGHT_BLUE)
                    borderRadius(8f)
                }
                event {
                    click {
                        message = "消息已更新！🎉"
                    }
                }
            }

            // 条件渲染示例
            vif({ message.contains("更新") }) {
                Text {
                    attr {
                        text("✨ 您刚刚更新了消息")
                        fontSize(14f)
                        color(Color.GREEN)
                        margin(top = 8f)
                    }
                }
            }
        }
    }
}
```

### 2. 创建主应用入口

#### App.kt

```kotlin
package com.example.app

import android.app.Application
import com.example.app.core.di.appModule
import com.tencent.kuikly.core.initKuikly
import org.koin.android.ext.koin.androidContext
import org.koin.core.context.startKoin

fun initApp() {
    // 初始化 Koin 依赖注入
    startKoin {
        androidContext(androidContext())
        modules(appModule)
    }

    // 初始化 Kuikly
    initKuikly()
}

class MyApplication : Application() {
    override fun onCreate() {
        super.onCreate()
        initApp()
    }
}
```

#### MainActivity.kt

```kotlin
package com.example.app

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import com.tencent.kuikly.core.KuiklyEntry

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        setContent {
            KuiklyEntry {
                HelloWorld()
            }
        }
    }
}
```

## 运行应用

### 方法一：Android Studio

1. 点击工具栏的 **Run** 按钮（绿色三角形）
2. 选择您的设备或模拟器
3. 等待 Gradle 同步和应用构建完成

### 方法二：命令行

```bash
# 同步 Gradle
./gradlew sync

# 构建并安装到设备
./gradlew installDebug
```

## 预期结果

成功运行后，您应该看到：

1. **启动屏幕**：应用正常启动，显示 Kuikly 欢迎界面
2. **主界面**：显示 "Hello, Kuikly!" 文本和一个蓝色按钮
3. **交互功能**：点击按钮会更新文本为 "消息已更新！🎉"
4. **条件显示**：当文本包含"更新"时，会显示绿色提示信息

## 下一步学习

恭喜！您已经成功创建了第一个 Kuikly 应用。接下来建议学习：

- [组件开发指南](component-development.md) - 学习创建自定义组件
- [状态管理指南](state-management.md) - 掌握响应式状态管理
- [API 参考](api-reference/) - 查阅完整的 API 文档

## 故障排除

### 常见问题

#### 问题：Gradle 同步失败
**解决方案**：
1. 检查网络连接
2. 清除缓存：`File → Invalidate Caches / Restart`
3. 删除 `.gradle` 目录后重新同步

#### 问题：找不到 Kuikly 类
**解决方案**：
1. 确认依赖已正确添加到 `build.gradle.kts`
2. 检查 Maven 仓库配置
3. 重新同步 Gradle

#### 问题：编译错误 "Cannot resolve symbol"
**解决方案**：
1. 等待 Gradle 完全同步
2. 手动触发 KSP 处理：`./gradlew clean`
3. 检查注解处理器是否启用

### 调试技巧

1. **查看日志**：使用 Android Studio 的 Logcat 查看实时日志输出
2. **断点调试**：在代码中设置断点进行调试
3. **单元测试**：编写测试验证组件逻辑
4. **性能分析**：使用 Profiler 工具分析应用性能

## 获取帮助

如果您遇到问题，可以参考：

- [KuiklyUI GitHub Issues](https://github.com/Tencent-TDS/KuiklyUI/issues)
- [官方文档](https://kuikly.tds.qq.com/)
- [社区论坛](https://forum.kuikly.com/)
- QQ 技术交流群：123456789

---

*最后更新: 2026-04-22*
*Kuikly UI Framework v2.6.0-2.0.21*

祝您开发愉快！🚀