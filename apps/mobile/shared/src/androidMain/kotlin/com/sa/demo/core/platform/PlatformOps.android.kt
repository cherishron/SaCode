package  com.sa.demo.core.platform

import android.content.Context
import android.widget.Toast

actual class PlatformContext(val context: Context)

actual fun getPlatformContext(): PlatformContext {
    TODO("Must be initialized from AndroidApplication before use")
}

actual fun PlatformContext.showToast(message: String) {
    Toast.makeText(context, message, Toast.LENGTH_SHORT).show()
}
