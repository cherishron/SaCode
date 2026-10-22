package com.sa.demo.kuikly.adapter

import com.tencent.kuikly.core.render.android.adapter.IKRColorParserAdapter

class KRColorParserAdapter : IKRColorParserAdapter {
    override fun toColor(colorStr: String): Int? = colorStr.toLongOrNull()?.toInt()
}