package com.sa.demo.kuikly.adapter

import com.tencent.kuikly.core.render.android.adapter.IKRThreadAdapter
import java.util.concurrent.Executors

class KRThreadAdapter : IKRThreadAdapter {
    private val subThreadPoolExecutor by lazy { Executors.newFixedThreadPool(2) }

    override fun executeOnSubThread(task: () -> Unit) {
        subThreadPoolExecutor.execute { task() }
    }

    override fun stackSize(): Long = 0
}