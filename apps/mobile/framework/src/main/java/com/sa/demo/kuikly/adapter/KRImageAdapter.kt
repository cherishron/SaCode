package com.sa.demo.kuikly.adapter

import android.content.Context
import android.graphics.BitmapFactory
import android.graphics.drawable.BitmapDrawable
import android.graphics.drawable.Drawable
import android.util.Log
import com.tencent.kuikly.core.render.android.KuiklyRenderViewContext
import com.tencent.kuikly.core.render.android.adapter.HRImageLoadOption
import com.tencent.kuikly.core.render.android.adapter.IKRImageAdapter
import org.json.JSONObject
import java.io.File
import java.net.URL
import java.util.concurrent.Executors

class KRImageAdapter(private val context: Context) : IKRImageAdapter {
    private val executor = Executors.newFixedThreadPool(3)

    companion object { private const val TAG = "KRImageAdapter" }

    override fun fetchDrawable(
        imageLoadOption: HRImageLoadOption,
        imageParams: JSONObject?,
        callback: (Drawable?) -> Unit
    ) {
        val src = imageLoadOption.src
        executor.submit {
            try {
                val drawable = when {
                    imageLoadOption.isAssets() -> loadAssetsImage(src)
                    imageLoadOption.isFile() -> loadFileImage(src)
                    imageLoadOption.isWebUrl() -> loadNetworkImage(src)
                    else -> null
                }
                android.os.Handler(android.os.Looper.getMainLooper()).post { callback(drawable) }
            } catch (e: Exception) {
                Log.e(TAG, "Failed to load: $src", e)
                android.os.Handler(android.os.Looper.getMainLooper()).post { callback(null) }
            }
        }
    }

    @Deprecated("使用 3 参数版本")
    override fun fetchDrawable(imageLoadOption: HRImageLoadOption, callback: (Drawable?) -> Unit) {
        fetchDrawable(imageLoadOption, null, callback)
    }

    private fun loadAssetsImage(src: String): Drawable? {
        val assetPath = src.removePrefix(HRImageLoadOption.SCHEME_ASSETS)
        return try {
            val inputStream = context.assets.open(assetPath)
            val bitmap = BitmapFactory.decodeStream(inputStream)
            inputStream.close()
            bitmap?.let { BitmapDrawable(context.resources, it) }
        } catch (e: Exception) { null }
    }

    private fun loadFileImage(src: String): Drawable? {
        val filePath = src.removePrefix(HRImageLoadOption.SCHEME_FILE)
        return try {
            val file = File(filePath)
            if (file.exists()) {
                BitmapFactory.decodeFile(file.absolutePath)?.let { BitmapDrawable(context.resources, it) }
            } else null
        } catch (e: Exception) { null }
    }

    private fun loadNetworkImage(url: String): Drawable? {
        return try {
            val connection = URL(url).openConnection()
            connection.connectTimeout = 15_000
            connection.readTimeout = 30_000
            connection.connect()
            val bytes = connection.getInputStream().readBytes()
            BitmapFactory.decodeByteArray(bytes, 0, bytes.size)?.let { BitmapDrawable(context.resources, it) }
        } catch (e: Exception) { null }
    }

    override fun getDrawableWidth(ctx: KuiklyRenderViewContext, drawable: Drawable): Float = drawable.intrinsicWidth.toFloat()
    override fun getDrawableHeight(ctx: KuiklyRenderViewContext, drawable: Drawable): Float = drawable.intrinsicHeight.toFloat()
    override val shouldWaitViewDidLoad: Boolean = false
}