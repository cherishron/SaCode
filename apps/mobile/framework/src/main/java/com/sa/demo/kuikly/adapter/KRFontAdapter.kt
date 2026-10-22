package com.sa.demo.kuikly.adapter

import android.graphics.Typeface
import com.tencent.kuikly.core.render.android.adapter.IKRFontAdapter

class KRFontAdapter : IKRFontAdapter {
    override fun getTypeface(fontFamily: String, result: (Typeface?) -> Unit) {
        result(null)
    }
}