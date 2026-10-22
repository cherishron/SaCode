# Add project specific ProGuard rules here.
# You can control the set of applied configuration files using the
# proguardFiles setting in build.gradle.

# SLF4J - 忽略缺失的 StaticLoggerBinder 警告
# SLF4J 在 Android 上通常使用 SLF4J-Android 或 Logback，但如果没有绑定实现，R8 会报错
-dontwarn org.slf4j.impl.StaticLoggerBinder
-dontwarn org.slf4j.impl.StaticMDCBinder
-dontwarn org.slf4j.impl.StaticMarkerBinder

# 保留 SLF4J 相关类
-keep class org.slf4j.** { *; }
-keep interface org.slf4j.** { *; }

# Java Management Extensions (JMX) - Android 不支持
-dontwarn java.lang.management.**

# Ktor 相关
-dontwarn io.ktor.util.debug.**
-keep class io.ktor.** { *; }
-keep interface io.ktor.** { *; }

# Kotlinx Serialization
-keepattributes *Annotation*, InnerClasses
-dontnote kotlinx.serialization.AnnotationsKt
-keepclassmembers class kotlinx.serialization.json.** {
    *** Companion;
}
-keepclasseswithmembers class kotlinx.serialization.json.** {
    kotlinx.serialization.KSerializer serializer(...);
}
-keep class * extends kotlinx.serialization.internal.GeneratedSerializer { *; }

# Kuikly 框架
-keep class com.tencent.kuikly.** { *; }
-keep interface com.tencent.kuikly.** { *; }

# 保留所有序列化数据类
-keep class com.siline.sioc.data.service.** { *; }
-keep class com.siline.sioc.domain.model.** { *; }

# Kotlin Coroutines
-keepclassmembers class kotlinx.coroutines.** {
    volatile <fields>;
}
-keepclassmembers class ** {
    *** invoke(...);
}
