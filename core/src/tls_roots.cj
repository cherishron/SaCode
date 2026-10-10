package core

import std.collection.ArrayList
import std.env.*
import std.fs.*
import stdx.crypto.common.*
import stdx.crypto.x509.*
import stdx.net.tls.*
import stdx.net.tls.common.*

// 客户端 TLS 信任锚的统一出口。
//
// 为什么需要这一层：stdx 的 `TlsClientConfig()` 默认走 OpenSSL 自己的默认证书库，而那份库
// 的位置取决于「运行时实际加载的是哪一颗 libssl」——本机随包 DLL 与 PATH 上的其它 OpenSSL
// 发行版会给出不同结果。产品不能把「能不能验通证书」寄托在装载顺序上，所以这里提供一个
// 显式、可覆盖、可测试的锚来源；没配置时保持 Default 不动，任何情况下都不退到 TrustAll。
//
// 三条路由实测过，只留最后一条（2026-10-11，本机）：
//   * crypt32 系统存储（CertOpenSystemStoreA("ROOT") / CertOpenSystemStoreW /
//     CertOpenStore(SYSTEM_W, 分别试 LOCAL_MACHINE 0x20000 与 CURRENT_USER|INCLUDE_LOCAL_ROOT
//     0x10000）：全部返回 NULL 且 lastErr=0。同一进程里 CertOpenStore(MEMORY) 能给非空句柄、
//     CryptStringToBinaryA("TWFu") 回 ok=1 needed=3、CryptAcquireContextA 回 ok=1，
//     而同机 .NET 的 P/Invoke 用同一个 CertOpenSystemStoreA 能枚举 53 张根——
//     坏的不是 Cangjie 绑定层，是 crypt32 的「系统存储提供者」在我们的进程里开不起来，原因未证，
//     不能把产品链路建在一条自己解释不了的入口上。
//   * 注册表直读（HKLM\...\SystemCertificates\ROOT\Certificates\<指纹>\Blob）：advapi32 通道
//     正常，枚举到 12 个子键（AuthRoot 另有 41），但 Blob 是未公开的存储头 + 属性表复合结构
//     （首 16 字节实测 92 00 00 00 | 01 00 00 00 | 04 00 00 00 | …，DER 起点不固定），
//     按未文档布局切片会在 Windows 改版时静默取错锚，放弃。
//   * PEM 锚（本文件）：整批解析实测可用（系统根导出的 306KB bundle 解出 200 张，
//     CustomCA(200) 对真实供应商握手成功）。
//
// 红线：取不到锚就留在 Default——那是「连不通并如实报错」，不是「不校验」。
//
// 一条必须记住的实测（2026-10-11，本机 stdx 1.1.3）：`CustomCA` **不把信任库收紧到给定列表**。
// 只喂 1 张与链路无关的自签根（CN=Microsoft Root Certificate Authority）时，百度与 longcat
// 照样分别拿到 200/404。所以这一层的用途是「给默认证书库为空的那颗随包 libssl 补上锚」，
// 不是证书锁定；想拿它当 pinning 用的人会拿到一个假的安全感。

// PEM 文本里的全部证书。整批成功或整批为空：信任锚不能半份生效，
// 半份锚会把本来验得通的链验挂，用户看到的是随机失败，比明确失败更坏。
public func tlsRootsFromPem(text: String): Array<Certificate> {
    if (text.size == 0) {
        return []
    }
    let found = ArrayList<Certificate>()
    try {
        for (cert in X509Certificate.decodeFromPem(text)) {
            found.add(cert)
        }
    } catch (_: Exception) {
        // 正文不是 PEM（或被截断）：按「这批锚不可用」处理，交给调用方退回 Default。
        return []
    }
    return found.toArray()
}

// 从磁盘上的 bundle 取锚。文件不存在/不可读/不是普通文件都算「没有锚」，不抛——
// 锚来源是可选配置，缺它属于正常状态。
public func tlsRootsFromBundle(path: String): Array<Certificate> {
    if (!exists(path) || !FileInfo(path).isRegular()) {
        return []
    }
    var bytes: Array<Byte> = []
    try {
        bytes = File.readFrom(path)
    } catch (_: Exception) {
        return []
    }
    return tlsRootsFromPem(String.fromUtf8(bytes))
}

// 锚文件候选，按「显式覆盖优先」排：自家变量、OpenSSL 约定变量、用户目录下的固定文件名。
// 自家变量排第一，是为了在 SSL_CERT_FILE 被别的软件设成坏路径时仍有一条能走通的路。
public func tlsBundleCandidates(): Array<String> {
    let out = ArrayList<String>()
    let own = getVariable("SACODE_CA_BUNDLE") ?? ""
    if (own.size > 0) {
        out.add(own)
    }
    let openssl = getVariable("SSL_CERT_FILE") ?? ""
    if (openssl.size > 0) {
        out.add(openssl)
    }
    let home = getVariable("USERPROFILE") ?? (getVariable("HOME") ?? "")
    if (home.size > 0) {
        out.add("${home}/.sacode/ca-bundle.pem")
    }
    return out.toArray()
}

// 第一个能解出锚的候选；全都没有就回空数组（不等于失败，见文件头红线）。
public func tlsDefaultRoots(): Array<Certificate> {
    for (path in tlsBundleCandidates()) {
        let roots = tlsRootsFromBundle(path)
        if (roots.size > 0) {
            return roots
        }
    }
    return []
}

public func clientTlsConfigWithRoots(roots: Array<Certificate>): TlsClientConfig {
    var config = TlsClientConfig()
    if (roots.size > 0) {
        config.verifyMode = CertificateVerifyMode.CustomCA(roots)
    }
    return config
}

// 全部 https 出口该用的那一份配置。
public func defaultTlsClientConfig(): TlsClientConfig {
    return clientTlsConfigWithRoots(tlsDefaultRoots())
}
