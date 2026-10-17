package core

import std.fs.*

@When[os == "Windows"]
func reviewUtf16String(values: Array<UInt16>, count: Int64): String {
    var result = "";
    var index: Int64 = 0
    while (index < count) {
        var code = UInt32(values[index]);
        index += 1
        if (code >= 55296 && code <= 56319) {
            if (index >= count || values[index] < 56320 || values[index] > 57343) {
                throw Exception("review-module-path-invalid")
            }
            code = 65536 + (code - 55296) * 1024 + UInt32(values[index]) - 56320
            index += 1
        } else if (code >= 56320 && code <= 57343) {
            throw Exception("review-module-path-invalid")
        }
        result += Rune(code).toString()
    }
    return result
}

// 不从RPC、PATH、当前工作区或环境变量寻找写入DLL，只使用当前可执行文件旁的固定载荷。
@When[os == "Windows"]
func reviewNativeLibraryPath(): String {
    let system = acSystemModule("kernel32.dll")
    if (system.isNull()) {
        throw Exception("review-platform-unavailable")
    }
    let free = CFunc<(CPointer<Unit>) -> Int32>(windowsRequiredExport(system, "FreeLibrary"))
    try {
        let get = CFunc<(CPointer<Unit>, CPointer<UInt16>, UInt32) -> UInt32>(
            windowsRequiredExport(system, "GetModuleFileNameW"))
        let buffer = Array<UInt16>(32768, repeat: 0)
        let memory = unsafe { acquireArrayRawData(buffer) }
        let count = try {
            unsafe { get(CPointer<Unit>(), memory.pointer, UInt32(buffer.size)) }
        } finally {
            unsafe { releaseArrayRawData(memory) }
        }
        if (count == 0 || Int64(count) >= buffer.size) {
            throw Exception("review-module-path-invalid")
        }
        let executable = reviewUtf16String(buffer, Int64(count))
        if (!Path(executable).isAbsolute()) {
            throw Exception("review-module-path-invalid")
        }
        return Path(executable).parent.join("sacode-windows-process.dll").toString()
    } finally {
        unsafe { free(system) }
    }
}

@When[os == "Windows"]
func platformReviewDirectoryIdentity(directory: String): String {
    let library = WindowsProcessLibrary(reviewNativeLibraryPath())
    try {
        let tree = WindowsWorkspaceTree(library, directory, false)
        try {
            return tree.identity
        } finally {
            tree.close()
        }
    } finally {
        library.close()
    }
}

@When[os != "Windows"]
func platformReviewDirectoryIdentity(directory: String): String {
    throw Exception("review-platform-unavailable")
}

@When[os == "Windows"]
func platformReviewExchange(directory: String, identity: String, path: String, before: ?Array<Byte>, after: ?Array<Byte>): ReviewWriteResult {
    let library = WindowsProcessLibrary(reviewNativeLibraryPath())
    try {
        let tree = WindowsWorkspaceTree(library, directory, true)
        try {
            if (tree.identity != identity) {
                return ReviewWriteResult(UInt32(1306), false)
            }
            let result = tree.compareExchange(path, before, after)
            return ReviewWriteResult(result.error, result.mayHaveChanged)
        } finally {
            tree.close()
        }
    } finally {
        library.close()
    }
}

@When[os != "Windows"]
func platformReviewExchange(directory: String, identity: String, path: String, before: ?Array<Byte>, after: ?Array<Byte>): ReviewWriteResult {
    throw Exception("review-platform-unavailable")
}
