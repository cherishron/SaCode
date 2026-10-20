package core

import std.collection.{ArrayList, HashMap}
import std.unittest.*
import std.unittest.testmacro.*

// 有界合成双向pipe：不调用PtySession.open，不启动shell/ConPTY设备。
class PtySyntheticPipe <: PtyPipeDriver {
    let output: Array<Byte>
    let received = ArrayList<Byte>()
    var offset: Int64 = 0
    var width: Int64 = 80
    var height: Int64 = 24
    var children: Int64 = 3
    var stops: Int64 = 0
    var releases: Int64 = 0
    var confirm = true
    var throwStop = false
    var failRead = false
    var failWrite = false
    var failResize = false
    var zeroWrite = false
    var invalidRead = false
    var done = false
    init(output: Array<Byte>) { this.output = output }
    public func read(buffer: Array<Byte>): Int64 {
        if (failRead) { throw Exception("synthetic-read-failure") }
        if (invalidRead) { return buffer.size + 1 }
        if (done || offset >= output.size) { return -1 }
        let size = min(buffer.size, output.size - offset)
        for (i in 0..size) { buffer[i] = output[offset + i] }
        offset += size
        return size
    }
    public func write(data: Array<Byte>): Int64 {
        if (failWrite) { throw Exception("synthetic-write-failure") }
        if (zeroWrite) { return 0 }
        let size = min(Int64(2), data.size)
        for (i in 0..size) { received.add(data[i]) }
        return size
    }
    public func resize(cols: Int64, rows: Int64): Unit {
        if (failResize) { throw Exception("synthetic-resize-failure") }
        width = cols; height = rows
    }
    public func stopTree(): Bool {
        stops += 1
        if (throwStop) { throw Exception("synthetic-stop-failed") }
        if (confirm) { children = 0 }
        return confirm
    }
    public func release(): Unit { releases += 1; done = true }
    public func exitCode(): ?Int64 { return if (done) { Some(Int64(0)) } else { None } }
}

func ptyTestError(action: () -> Unit): String {
    var message = ""
    try { action() } catch (e: Exception) { message = e.message }
    return message
}

@Test
func ptySyntheticBidirectionalAndPartialWrite() {
    let pipe = PtySyntheticPipe("reply".toArray())
    let session = PtySession(pipe, 32)
    try {
        @Expect(session.write("hello"), 5)
        @Expect(String.fromUtf8(pipe.received.toArray()), "hello")
        @Expect(session.pumpOnce(), 5)
        @Expect(String.fromUtf8(session.readOutput(3).data), "rep")
        @Expect(String.fromUtf8(session.readOutput(32).data), "ly")
        @Expect(session.pumpOnce(), -1)
        @Expect(session.readOutput(32).eof, true)
    } finally { session.close() }
}

@Test
func ptyRingDropsOldestAndKeepsStickyTruncation() {
    let pipe = PtySyntheticPipe("0123456789".toArray())
    let session = PtySession(pipe, 4)
    try {
        session.pumpOnce()
        let first = session.readOutput(2)
        @Expect(String.fromUtf8(first.data), "67")
        @Expect(first.truncated, true)
        @Expect(String.fromUtf8(session.readOutput(4).data), "89")
        @Expect(session.readOutput(4).truncated, true)
        @Expect(session.ring.bytes.size, 4)
        @Expect(session.ring.count, 0)
    } finally { session.close() }
}

@Test
func ptyOutputIsBinarySafeAndByteLimited() {
    let pipe = PtySyntheticPipe([UInt8(0), 255, 195, 169, 27])
    let session = PtySession(pipe, 16)
    try {
        session.pumpOnce()
        let a = session.readOutput(2)
        @Expect(a.data, [UInt8(0), 255])
        @Expect(a.truncated, false)
        @Expect(session.readOutput(16).data, [UInt8(195), 169, 27])
        // 返回原始字节，跨块UTF-8解码由VT消费者维护；不伪造完整String。
    } finally { session.close() }
}

@Test
func ptyResizeAndInterruptAreExplicitRequests() {
    let pipe = PtySyntheticPipe([])
    let session = PtySession(pipe, 16)
    try {
        session.resize(120, 40)
        @Expect(pipe.width, 120)
        @Expect(pipe.height, 40)
        session.interrupt()
        @Expect(pipe.received.toArray(), [UInt8(3)])
        @Expect(pipe.children, 3)
    } finally { session.close() }
}

@Test
func ptyCloseStopsTreeOnceAndRejectsReuse() {
    let pipe = PtySyntheticPipe([])
    let session = PtySession(pipe, 8)
    session.close()
    session.close()
    @Expect(pipe.children, 0)
    @Expect(pipe.stops, 1)
    @Expect(pipe.releases, 1)
    @Expect(ptyTestError({ => session.write("x"); () }), "pty-closed")
    @Expect(ptyTestError({ => session.resize(80, 24) }), "pty-closed")
    @Expect(ptyTestError({ => session.interrupt() }), "pty-closed")
    @Expect(session.readOutput(8).eof, true)
}

@Test
func ptyUnconfirmedStopIsNotReportedAsSuccess() {
    let pipe = PtySyntheticPipe([])
    pipe.confirm = false
    let session = PtySession(pipe, 8)
    @Expect(ptyTestError({ => session.close() }), "pty-tree-stop-unconfirmed")
    @Expect(pipe.releases, 1)
    @Expect(ptyTestError({ => session.close() }), "pty-tree-stop-unconfirmed")
    @Expect(pipe.stops, 1)
}

@Test
func ptyRejectsInvalidDimensionsLimitsAndInput() {
    let pipe = PtySyntheticPipe([])
    let session = PtySession(pipe, 8)
    try {
        @Expect(ptyTestError({ => session.resize(0, 24) }), "pty-invalid-size")
        @Expect(ptyTestError({ => session.resize(80, 32768) }), "pty-invalid-size")
        @Expect(ptyTestError({ => session.readOutput(0); () }), "pty-invalid-output-limit")
        @Expect(ptyTestError({ => session.readOutput(262145); () }), "pty-invalid-output-limit")
        @Expect(ptyTestError({ => session.write(Array<Byte>(4097, repeat: 0)); () }), "pty-input-too-large")
        @Expect(pipe.received.size, 0)
        @Expect(session.write(""), 0)
    } finally { session.close() }
}

@Test
func ptyWriteFailureDoesNotReplayInput() {
    let pipe = PtySyntheticPipe([])
    let session = PtySession(pipe, 8)
    try {
        pipe.failWrite = true
        @Expect(ptyTestError({ => session.write("danger"); () }), "synthetic-write-failure")
        pipe.failWrite = false
        session.write("ok")
        @Expect(String.fromUtf8(pipe.received.toArray()), "ok")
        pipe.zeroWrite = true
        @Expect(ptyTestError({ => session.write("x"); () }), "pty-input-io-error")
    } finally { session.close() }
}

@Test
func ptyReadFailureAndInvalidCountAreVisible() {
    let pipe = PtySyntheticPipe([])
    let session = PtySession(pipe, 8)
    try {
        pipe.failRead = true
        @Expect(ptyTestError({ => session.pumpOnce(); () }), "synthetic-read-failure")
        pipe.failRead = false
        pipe.invalidRead = true
        @Expect(ptyTestError({ => session.pumpOnce(); () }), "pty-invalid-read-count")
    } finally { session.close() }
}

@Test
func ptyEnvironmentIsExplicitSortedAndDoubleTerminated() {
    let env = HashMap<String, String>()
    @Expect(ptyEnvironment(env), [UInt16(0), 0])
    env.add("z", "2")
    env.add("A", "1")
    let block = ptyEnvironment(env)
    let expected = ptyWide("A=1").concat(ptyWide("z=2")).concat([UInt16(0)])
    @Expect(block, expected)
    env.add("a", "other")
    @Expect(ptyTestError({ => ptyEnvironment(env); () }), "pty-duplicate-environment")
}

@Test
func ptyEnvironmentRejectsNulEqualsAndOversize() {
    let env = HashMap<String, String>()
    env.add("A=B", "x")
    @Expect(ptyTestError({ => ptyEnvironment(env); () }), "pty-invalid-environment")
    let nul = HashMap<String, String>()
    nul.add("A", "x\u{0}y")
    @Expect(ptyTestError({ => ptyEnvironment(nul); () }), "pty-invalid-environment")
    @Expect(ptyWide("😀"), [UInt16(55357), 56832, 0])
}

@Test
func ptyStopExceptionStillReleasesAndDoesNotSucceed() {
    let pipe = PtySyntheticPipe([])
    pipe.throwStop = true
    let session = PtySession(pipe, 8)
    @Expect(ptyTestError({ => session.close() }), "synthetic-stop-failed")
    @Expect(pipe.releases, 1)
    @Expect(ptyTestError({ => session.close() }), "pty-tree-stop-unconfirmed")
}

@Test
func ptyRingWrapAndFloodStayBounded() {
    let ring = PtyByteRing(4)
    ring.append("abcd".toArray(), 4)
    @Expect(String.fromUtf8(ring.take(3)), "abc")
    ring.append("efg".toArray(), 3)
    @Expect(String.fromUtf8(ring.take(4)), "defg")
    @Expect(ring.lost, false)
    let chunk = Array<Byte>(8192, repeat: 120)
    for (_ in 0..100) { ring.append(chunk, chunk.size) }
    @Expect(ring.count, 4)
    @Expect(ring.bytes.size, 4)
    @Expect(ring.lost, true)
}

@Test
func ptyBackgroundReaderSurfacesFailureAndJoinsOnClose() {
    let pipe = PtySyntheticPipe([])
    pipe.failRead = true
    let session = PtySession(pipe, 8)
    session.startReader()
    session.reader.getOrThrow().get(2 * Duration.second)
    @Expect(session.readOutput(8).failure, "pty-output-io-error")
    session.close()
    @Expect(pipe.releases, 1)
}

@When[os == "Windows"]
@Test
func ptyNativeInputPipeRoundTripAndCancellationWithoutConPty() {
    let pipe = PtyWindowsPipe()
    let client = ptyCreateInputPipe(pipe)
    try {
        @Expect(pipe.write("fixture".toArray()), 7)
        let data = Array<Byte>(7, repeat: 0)
        let raw = unsafe { acquireArrayRawData(data) }
        let read = CFunc<(CPointer<Unit>, CPointer<Byte>, UInt32, CPointer<UInt32>, CPointer<Unit>) -> Int32>(pipe.api.address("ReadFile"))
        var count: UInt32 = 0
        try { @Expect(unsafe { read(client, raw.pointer, 7, inout count, CPointer<Unit>()) }, 1) }
        finally { unsafe { releaseArrayRawData(raw) } }
        @Expect(count, 7u32)
        @Expect(String.fromUtf8(data), "fixture")
        // 不消费下一批输入，直到4KiB pipe满；超时必须收割OVERLAPPED，不能挂死。
        var cancelled = false
        for (_ in 0..16) {
            if (ptyTestError({ => pipe.write(Array<Byte>(4096, repeat: 120)); () }).size > 0) {
                cancelled = true
                break
            }
        }
        @Expect(cancelled, true)
    } finally { pipe.api.close(client); pipe.release() }
}

@When[os == "Windows"]
@Test
func ptyNativeOutputPipeWithoutConPty() {
    let pipe = PtyWindowsPipe()
    let api = pipe.api
    let create = CFunc<(CPointer<CPointer<Unit>>, CPointer<CPointer<Unit>>, CPointer<Unit>, UInt32) -> Int32>(api.address("CreatePipe"))
    var input = CPointer<Unit>()
    var output = CPointer<Unit>()
    @Expect(unsafe { create(inout input, inout output, CPointer<Unit>(), 4096) }, 1)
    pipe.output = input
    try {
        let payload = unsafe { acquireArrayRawData("raw-output".toArray()) }
        let write = CFunc<(CPointer<Unit>, CPointer<Byte>, UInt32, CPointer<UInt32>, CPointer<Unit>) -> Int32>(api.address("WriteFile"))
        var written: UInt32 = 0
        try { @Expect(unsafe { write(output, payload.pointer, 10, inout written, CPointer<Unit>()) }, 1) }
        finally { unsafe { releaseArrayRawData(payload) } }
        let buffer = Array<Byte>(32, repeat: 0)
        @Expect(pipe.read(buffer), 10)
        @Expect(String.fromUtf8(buffer[0..10]), "raw-output")
        @Expect(pipe.read(buffer), 0)
        api.close(output)
        output = CPointer<Unit>()
        @Expect(pipe.read(buffer), -1)
    } finally { api.close(output); pipe.release() }
}

@When[os == "Windows"]
@Test
func ptyNativeAbiMatchesWindowsX64() {
    @Expect(sizeOf<PtyCoord>(), 4)
    @Expect(sizeOf<PtyStartup>(), 104)
    @Expect(sizeOf<PtyStartupEx>(), 112)
    @Expect(sizeOf<PtyProcessInfo>(), 24)
    @Expect(sizeOf<PtyJobLimits>(), 144)
    @Expect(sizeOf<PtyJobAccounting>(), 48)
    @Expect(sizeOf<PtyOverlapped>(), 32)
    @Expect(sizeOf<PtySecurityAttributes>(), 24)
}
