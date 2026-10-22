package com.sa.demo

import com.sa.demo.core.di.appModule
import org.koin.core.context.startKoin

fun initApp(application: Any? = null) {
    startKoin {
        modules(
            appModule,
            platformModule(application)
        )
    }
}

expect fun platformModule(application: Any?): org.koin.core.module.Module
