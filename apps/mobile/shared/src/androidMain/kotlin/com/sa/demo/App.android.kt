package com.sa.demo

import android.app.Application
import com.sa.demo.core.di.appModule
import com.sa.demo.core.platform.PlatformContext
import org.koin.android.ext.koin.androidContext
import org.koin.android.ext.koin.androidLogger
import org.koin.core.context.startKoin
import org.koin.core.logger.Level
import org.koin.core.module.Module
import org.koin.dsl.module

actual fun platformModule(application: Any?): Module = module {
    single<PlatformContext> { PlatformContext(application as Application) }
}

fun initAndroidApp(application: Application) {
    startKoin {
        androidLogger(Level.DEBUG)
        androidContext(application)

        modules(
            appModule,
            platformModule(application)
        )
    }
}
