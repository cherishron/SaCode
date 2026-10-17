package core

// 直接调用原生文件提供方：没有 shell、环境变量路径或 4096 字节发布上限。
func appendDurablePrefix(path: String, prefix: Array<Byte>, pending: Array<Byte>): Bool {
    return nativeAppendDurable(path, prefix, pending, prefix.size)
}
