package com.sa.demo

import android.app.Application
import com.sa.demo.agent.AgentRegistry
import com.sa.demo.agent.PrefsAgentRegistryStore
import com.sa.demo.core.platform.AndroidPlatform
import com.sa.demo.core.platform.NapierInitializer
import com.sa.demo.core.platform.PlatformContext
import com.sa.demo.history.LocalHistoryRepository
import com.sa.demo.history.PrefsHistoryStore
import com.sa.demo.kuikly.KuiklyFramework
import com.sa.demo.storage.SecureStores
import com.sa.demo.storage.createSecureStore
import com.tencent.kuikly.core.IKuiklyCoreEntry
import com.tencent.kuikly.core.android.KuiklyCoreEntry

class AndroidApplication : Application() {

    override fun onCreate() {
        super.onCreate()

        NapierInitializer.init()
        AndroidPlatform.init(this)
        platformContext = PlatformContext(this)
        SecureStores.init(createSecureStore())
        val prefs = getSharedPreferences("sa_app_history", MODE_PRIVATE)
        LocalHistoryRepository.bindStore(
            PrefsHistoryStore(
                getString = { k -> prefs.getString(k, null) },
                putString = { k, v -> prefs.edit().putString(k, v).apply() },
            )
        )
        val agentPrefs = getSharedPreferences("sa_app_agents", MODE_PRIVATE)
        AgentRegistry.bindStore(
            PrefsAgentRegistryStore(
                getString = { k -> agentPrefs.getString(k, null) },
                putString = { k, v -> agentPrefs.edit().putString(k, v).apply() },
                getSecret = { k -> SecureStores.get().getString(k) },
                putSecret = { k, v -> SecureStores.get().putString(k, v) },
                removeSecret = { k -> SecureStores.get().remove(k) },
            )
        )

        try {
            initAndroidApp(this)
            android.util.Log.d("AndroidApplication", "Koin DI initialized")
        } catch (e: Exception) {
            android.util.Log.e("AndroidApplication", "Koin DI failed: ${e.message}", e)
        }

        KuiklyFramework.initAdapters()
        kuiklyCoreEntry = initCoreEntry()
    }

    private fun initCoreEntry(): KuiklyCoreEntry {
        return KuiklyCoreEntry().apply {
            delegate = object : IKuiklyCoreEntry.Delegate {
                override fun callNative(methodId: Int, arg0: Any?, arg1: Any?, arg2: Any?, arg3: Any?, arg4: Any?, arg5: Any?): Any? = null
            }
        }
    }

    companion object {
        lateinit var platformContext: PlatformContext
        lateinit var kuiklyCoreEntry: KuiklyCoreEntry
        const val KUIKLY_CONTEXT_CODE = "main"
    }
}
