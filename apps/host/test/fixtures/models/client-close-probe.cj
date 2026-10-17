// 匹配SDK/DLL的关闭唤醒探针，不包含业务核心或真实提供方配置。
import std.env.*
import std.sync.*
import stdx.net.http.*
main() {
    let url = getVariable("SACODE_CLOSE_PROBE_URL") ?? ""
    if (!url.startsWith("http://127.0.0.1:")) { return 64 }
    println("before-client")
    let client = ClientBuilder().build()
    println("before-send")
    let response = client.get(url)
    println("headers-received")
    let entered = AtomicBool(false)
    let reader = spawn {
        let buf = Array<UInt8>(8192, repeat: 0)
        response.body.read(buf)
        entered.store(true)
        try { response.body.read(buf) } catch (_: Exception) { 0 }
    }
    while (!entered.load()) { sleep(10 * Duration.millisecond) }
    sleep(200 * Duration.millisecond)
    println("before-close")
    client.close()
    println("after-close")
    reader.get(Duration.second * 2)
    println("reader-joined")
    return 0
}
