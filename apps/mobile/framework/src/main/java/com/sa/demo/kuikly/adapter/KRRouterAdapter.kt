package com.sa.demo.kuikly.adapter

import android.content.Context
import com.tencent.kuikly.core.render.android.adapter.IKRRouterAdapter
import org.json.JSONObject

class KRRouterAdapter : IKRRouterAdapter {
    companion object {
        var onNavigateToPage: ((String) -> Unit)? = null
        var onClosePage: (() -> Unit)? = null
    }

    override fun openPage(context: Context, pageName: String, pageData: JSONObject) {
        android.util.Log.d("KuiklyRouter", "openPage: $pageName")
        onNavigateToPage?.invoke(pageName)
    }

    override fun closePage(context: Context) {
        android.util.Log.d("KuiklyRouter", "closePage")
        onClosePage?.invoke()
    }
}