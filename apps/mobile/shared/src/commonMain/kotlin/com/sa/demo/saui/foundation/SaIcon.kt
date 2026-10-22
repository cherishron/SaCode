package com.sa.demo.saui.foundation

import com.sa.demo.saui.token.SaUIColors
import com.tencent.kuikly.core.base.Color
import com.tencent.kuikly.core.base.ViewBuilder
import com.tencent.kuikly.core.views.Image
import com.tencent.kuikly.core.views.Text

object SaIcon {

    enum class Size(val px: Float) {
        XS(16f),
        SM(20f),
        MD(24f),
        LG(32f),
        XL(48f)
    }

    fun buildChar(
        char: String,
        size: Size = Size.MD,
        tintColor: String = SaUIColors.TextPrimarySolid
    ): ViewBuilder = {
        Text {
            attr {
                text(char)
                fontSize(size.px)
                color(Color.parseString16ToLong(tintColor))
            }
        }
    }

    fun buildSrc(
        src: String,
        size: Size = Size.MD
    ): ViewBuilder = {
        Image {
            attr {
                this.src(src)
                size(size.px, size.px)
            }
        }
    }
}

object SaIcons {
    const val ARROW_RIGHT = "\u2192"
    const val ARROW_LEFT = "\u2190"
    const val ARROW_DOWN = "\u2193"
    const val ARROW_UP = "\u2191"
    const val CLOSE = "\u2715"
    const val CHECK = "\u2713"
    const val PLUS = "+"
    const val MINUS = "-"
    const val SEARCH = "\u2315"
    const val STAR = "\u2605"
    const val STAR_OUTLINE = "\u2606"
    const val HEART = "\u2665"
    const val HEART_OUTLINE = "\u2661"
    const val USER = "\u263A"
    const val SETTINGS = "\u2699"
    const val HOME = "\u2302"
    const val BELL = "\u266A"
    const val MENU = "\u2261"
    const val MORE = "\u22EF"
    const val EDIT = "\u270E"
    const val DELETE = "\u2717"
    const val INFO = "i"
    const val WARNING = "!"
    const val ERROR = "\u2715"
    const val SUCCESS = "\u2713"
    const val REFRESH = "\u27F3"
    const val FILTER = "\u2630"
    const val SORT = "\u2195"
    const val CAMERA = "\u2609"
    const val PHOTO = "\u25A3"
    const val LOCATION = "\u2316"
    const val PHONE = "\u260E"
    const val MAIL = "\u2709"
    const val LOCK = "\u26BF"
    const val UNLOCK = "\u26C0"
    const val EYE = "\u25C9"
    const val EYE_OFF = "\u25CB"
    const val CALENDAR = "\u25A0"
    const val CLOCK = "\u25F7"
    const val CHAT = "\u25D8"
    const val SHARE = "\u2934"
    const val DOWNLOAD = "\u29EB"
    const val UPLOAD = "\u29EA"
    const val PLAY = "\u25B6"
    const val PAUSE = "\u2759\u2759"
    const val STOP = "\u25A0"
    const val MICROPHONE = "\u25CB"
    const val VOLUME = "\u266C"
    const val VOLUME_OFF = "\u266C"
}
