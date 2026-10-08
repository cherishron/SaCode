package core

import std.collection.*
import std.net.*
import std.sync.*
import std.time.*
import stdx.net.http.*
import stdx.net.tls.*

public class WebHttpResponse {
    public let status: Int64
    public let contentType: String
    public let location: String
    public let bytes: Array<Byte>
    public let truncated: Bool
    public init(status: Int64, contentType: String, location: String, bytes: Array<Byte>, truncated: Bool) {
        this.status = status; this.contentType = contentType; this.location = location
        this.bytes = bytes; this.truncated = truncated
    }
}

class WebConnectionState {
    let mutex = Mutex()
    let done = AtomicBool(false)
    var socket: Option<TcpSocket> = None
    func attach(value: TcpSocket): Unit {
        synchronized(mutex) {
            if (done.load()) { value.close(); throw Exception("web-cancelled") }
            socket = Some(value)
        }
    }
    func close(): Unit {
        synchronized(mutex) {
            if (let Some(value) <- socket) { try { value.close() } catch (_: Exception) {} }
        }
    }
}

public class WebHttpTransport {
    public init() {}
    public func request(url: String, method: String, body: String, apiKey: String, token: TurnToken,
        timeoutMs!: Int64 = 30000, maxBytes!: Int64 = 5000000, deepseek!: Bool = false): WebHttpResponse {
        if (token.cancelled()) { throw Exception("web-cancelled") }
        if (timeoutMs <= 0 || maxBytes <= 0 || (method != "GET" && method != "POST")) { throw Exception("web-bad-request") }
        if (!webUrlAllowed(url)) { throw Exception("web-url-not-allowed") }
        for (byte in apiKey.toArray()) {
            if (byte <= 32 || byte == 127) { throw Exception("web-bad-credential") }
        }
        let target = WebUrlTarget(url)
        if (apiKey.size > 0 && target.scheme != "https") { throw Exception("web-credential-requires-tls") }
        let state = WebConnectionState()
        let expired = AtomicBool(false)
        let started = MonoTime.now()
        let watchdog = spawn {
            while (!state.done.load()) {
                if (token.cancelled() || MonoTime.now() - started >= Duration.millisecond * timeoutMs) {
                    if (!token.cancelled()) { expired.store(true) }
                    state.done.store(true)
                    state.close()
                    break
                }
                sleep(Duration.millisecond * 10)
            }
        }
        var client: Option<Client> = None
        var response: Option<HttpResponse> = None
        try {
            let addresses = IPAddress.resolve(target.host)
            webCheckResolvedAddresses(Array<String>(addresses.size, { index => addresses[index].toString() }))
            if (state.done.load()) { throw Exception("web-cancelled") }
            let pinned = addresses[0]
            let connector: (SocketAddress) -> StreamingSocket = { _ =>
                let socket = TcpSocket(IPSocketAddress(pinned, target.port))
                state.attach(socket)
                socket.connect(timeout: Duration.millisecond * timeoutMs)
                return socket
            }
            let connection = ClientBuilder().noProxy().cookieJar(None).autoRedirect(false)
                .connector(connector).tlsConfig(TlsClientConfig())
                .readTimeout(Duration.millisecond * timeoutMs).writeTimeout(Duration.millisecond * timeoutMs).build()
            client = Some(connection)
            let builder = HttpRequestBuilder().url(url).method(method)
                .header("accept", "application/json, text/*;q=0.9, */*;q=0.1")
                .header("user-agent", "SaCode/0.2")
            if (method == "POST") { builder.header("content-type", "application/json").body(body) }
            if (apiKey.size > 0) { builder.header("authorization", "Bearer ${apiKey}") }
            if (deepseek) {
                builder.header("x-api-key", apiKey).header("anthropic-version", "2023-06-01")
            }
            let received = connection.send(builder.build())
            response = Some(received)
            if (let Some(length) <- received.bodySize) {
                if (length > maxBytes) { throw Exception("web-body-too-large") }
            }
            let bytes = ArrayList<Byte>()
            let buffer = Array<Byte>(8192, repeat: 0)
            var truncated = false
            while (true) {
                if (token.cancelled() || expired.load()) { throw Exception("web-cancelled") }
                let count = received.body.read(buffer)
                if (count == 0) { break }
                let take = min(count, maxBytes - bytes.size)
                for (index in 0..take) { bytes.add(buffer[index]) }
                if (count > take) { truncated = true; break }
            }
            return WebHttpResponse(Int64(received.status), received.headers.getFirst("content-type") ?? "",
                received.headers.getFirst("location") ?? "", bytes.toArray(), truncated)
        } catch (error: Exception) {
            if (token.cancelled()) { throw Exception("web-cancelled") }
            if (expired.load()) { throw Exception("web-timeout") }
            throw error
        } finally {
            state.done.store(true)
            state.close()
            if (let Some(value) <- response) { try { value.close() } catch (_: Exception) {} }
            if (let Some(value) <- client) { try { value.close() } catch (_: Exception) {} }
            watchdog.get()
        }
    }
}
