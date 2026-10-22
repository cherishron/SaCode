package com.sa.demo.core.di

import com.sa.demo.auth.AuthRepository
import com.sa.demo.env.SaaiEnv
import org.koin.dsl.module

val appModule = module {
    single { SaaiEnv.current }
    single { AuthRepository }
}
