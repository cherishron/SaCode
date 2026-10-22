package com.sa.demo.kuikly

import android.content.Context
import android.util.Log
import com.sa.demo.kuikly.adapter.*
import com.tencent.kuikly.core.render.android.adapter.KuiklyRenderAdapterManager
import com.tencent.kuikly.core.render.android.adapter.HRImageLoadOption
import org.json.JSONObject

object KuiklyFramework {

    fun initAdapters() {
        KuiklyRenderAdapterManager.krLogAdapter = KRLogAdapter
        
        KuiklyRenderAdapterManager.krImageAdapter = object : com.tencent.kuikly.core.render.android.adapter.IKRImageAdapter {
            override fun fetchDrawable(option: HRImageLoadOption, params: JSONObject?, callback: (android.graphics.drawable.Drawable?) -> Unit) {
                Log.w(TAG, "Placeholder adapter - override in Activity")
                callback(null)
            }
            @Deprecated("Use 3-param version")
            override fun fetchDrawable(option: HRImageLoadOption, callback: (android.graphics.drawable.Drawable?) -> Unit) {
                callback(null)
            }
            override val shouldWaitViewDidLoad: Boolean = false
            override fun getDrawableWidth(ctx: com.tencent.kuikly.core.render.android.KuiklyRenderViewContext, d: android.graphics.drawable.Drawable): Float = d.intrinsicWidth.toFloat()
            override fun getDrawableHeight(ctx: com.tencent.kuikly.core.render.android.KuiklyRenderViewContext, d: android.graphics.drawable.Drawable): Float = d.intrinsicHeight.toFloat()
        }

        KuiklyRenderAdapterManager.krUncaughtExceptionHandlerAdapter = KRExceptionAdapter
        KuiklyRenderAdapterManager.krThreadAdapter = KRThreadAdapter()
        KuiklyRenderAdapterManager.krColorParseAdapter = KRColorParserAdapter()
        KuiklyRenderAdapterManager.krFontAdapter = KRFontAdapter()

        Log.d(TAG, "Kuikly adapters initialized (placeholder for Image)")
    }

    fun setImageAdapter(context: Context) {
        KuiklyRenderAdapterManager.krImageAdapter = KRImageAdapter(context)
        Log.d(TAG, "Image adapter set with Context")
    }

    fun setRouterCallbacks(onNavigate: (String) -> Unit, onClose: () -> Unit) {
        KRRouterAdapter.onNavigateToPage = onNavigate
        KRRouterAdapter.onClosePage = onClose
        KuiklyRenderAdapterManager.krRouterAdapter = KRRouterAdapter()
        Log.d(TAG, "Router adapter set with callbacks")
    }

    const val TAG = "KuiklyFramework"
}