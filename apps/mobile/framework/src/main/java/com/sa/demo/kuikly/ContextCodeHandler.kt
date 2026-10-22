package com.sa.demo.kuikly

import android.content.Context
import android.util.Log
import android.view.ViewGroup
import com.tencent.kuikly.core.render.android.IKuiklyRenderExport
import com.tencent.kuikly.core.render.android.context.KuiklyRenderCoreExecuteModeBase
import com.tencent.kuikly.core.render.android.exception.ErrorReason
import com.tencent.kuikly.core.render.android.expand.KuiklyRenderViewBaseDelegator
import com.tencent.kuikly.core.render.android.expand.KuiklyRenderViewBaseDelegatorDelegate
import com.tencent.kuikly.core.render.android.performace.KRMonitorType
import com.tencent.kuikly.core.render.android.performace.KRPerformanceData
import com.tencent.kuikly.core.render.android.performace.launch.KRLaunchData

class ContextCodeHandler(private val context: Context, val pageName: String) {
    private var beginTime: Long = 0
    lateinit var kuiklyRenderViewDelegator: KuiklyRenderViewBaseDelegator
    var onError: ((String) -> Unit)? = null

    fun initContextHandler(): KuiklyRenderViewBaseDelegator {
        val delegate = object : KuiklyRenderViewBaseDelegatorDelegate {
            override fun onGetPerformanceData(data: KRPerformanceData) {
                Log.d(TAG, "[PerformanceData] $data")
            }
            override fun onGetLaunchData(data: KRLaunchData) {
                Log.d(TAG, "[onGetLaunchData] $data")
            }
            override fun coreExecuteModeX(): KuiklyRenderCoreExecuteModeBase = KuiklyRenderCoreExecuteModeBase.JVM
            override fun performanceMonitorTypes(): List<KRMonitorType> = listOf(KRMonitorType.LAUNCH)
            override fun onKuiklyRenderViewCreated() {
                super.onKuiklyRenderViewCreated()
                beginTime = System.currentTimeMillis()
                Log.d(TAG, "KuiklyRenderView created")
            }
            override fun onKuiklyRenderContentViewCreated() {
                super.onKuiklyRenderContentViewCreated()
                Log.d(TAG, "Content view created, cost: ${System.currentTimeMillis() - beginTime}ms")
            }
            override fun onUnhandledException(throwable: Throwable, errorReason: ErrorReason, executeMode: KuiklyRenderCoreExecuteModeBase) {
                val msg = "Kuikly 未捕获异常: $errorReason - ${throwable.message}"
                Log.e(TAG, "Exception: $errorReason, ${throwable.stackTraceToString()}")
                onError?.invoke(msg)
            }
            override fun onPageLoadComplete(isSucceed: Boolean, errorReason: ErrorReason?, executeMode: KuiklyRenderCoreExecuteModeBase) {
                if (isSucceed) Log.d(TAG, "Page loaded: $pageName")
                else {
                    val msg = "页面加载失败: $errorReason"
                    Log.e(TAG, msg)
                    onError?.invoke(msg)
                }
            }
        }
        kuiklyRenderViewDelegator = KuiklyRenderViewBaseDelegator(delegate)
        return kuiklyRenderViewDelegator
    }

    fun openPage(container: ViewGroup, pageName: String, pageData: Map<String, Any>) {
        kuiklyRenderViewDelegator.onAttach(container, KUIKLY_CONTEXT_CODE, pageName, pageData)
    }

    companion object {
        private const val TAG = "ContextCodeHandler"
        const val KUIKLY_CONTEXT_CODE = "main"
    }
}
