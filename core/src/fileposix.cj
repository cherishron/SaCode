package core

@When[os != "Windows"]
foreign func sacode_append_durable(path: CString, prefix: CPointer<Byte>, prefixSize: Int64,
    pending: CPointer<Byte>, pendingSize: Int64, retained: Int64): Int32

@When[os != "Windows"]
foreign func sacode_replace_durable(staging: CString, target: CString): Int32

@When[os != "Windows"]
foreign func sacode_publish_new(staging: CString, target: CString): Int32

// 平台错误与 errno 在 C 薄层内结算，不能跨 CFFI 猜线程错误码。
@When[os != "Windows"]
func nativeAppendDurableStatus(path: String, prefix: Array<Byte>, pending: Array<Byte>, retained: Int64): String {
    if (path.size == 0 || path.contains("\u{0}") || retained < 0 || retained > prefix.size) { return "failed" }
    let name = unsafe { LibC.mallocCString(path) }
    try {
        let before = unsafe { acquireArrayRawData(if (prefix.size == 0) { [UInt8(0)] } else { prefix }) }
        try {
            let after = unsafe { acquireArrayRawData(if (pending.size == 0) { [UInt8(0)] } else { pending }) }
            try {
                let result = unsafe { sacode_append_durable(name, before.pointer, prefix.size,
                    after.pointer, pending.size, retained) }
                return if (result == 0) { "ok" } else if (result == 1) { "not-opened" } else { "failed" }
            } finally { unsafe { releaseArrayRawData(after) } }
        } finally { unsafe { releaseArrayRawData(before) } }
    } finally { unsafe { LibC.free(name) } }
}

@When[os != "Windows"]
func nativeReplaceFile(staging: String, path: String): Unit {
    posixPublish(staging, path, false)
}

@When[os != "Windows"]
func nativePublishNewFile(staging: String, path: String): Unit {
    posixPublish(staging, path, true)
}

@When[os != "Windows"]
func posixPublish(staging: String, path: String, creating: Bool): Unit {
    if (staging.size == 0 || path.size == 0 || staging.contains("\u{0}") || path.contains("\u{0}")) {
        throw Exception("invalid-file-path")
    }
    let source = unsafe { LibC.mallocCString(staging) }
    try {
        let target = unsafe { LibC.mallocCString(path) }
        try {
            let result = unsafe {
                if (creating) { sacode_publish_new(source, target) } else { sacode_replace_durable(source, target) }
            }
            if (result != 0) { throw Exception("file-publish-failed") }
        } finally { unsafe { LibC.free(target) } }
    } finally { unsafe { LibC.free(source) } }
}
