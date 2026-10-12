package core

import std.unittest.*
import std.io.*

func ledgerUsageFromSse(json: String): LedgerUsage {
    let bytes = ByteBuffer()
    bytes.write("data: ${json}\n\ndata: {\"choices\":[{\"index\":0,\"delta\":{},\"finish_reason\":\"stop\"}]}\n\ndata: [DONE]\n\n".toArray())
    let provider = RealSseProvider(bytes, TurnToken())
    try {
        while (provider.next().isSome()) {}
        return provider.reportedUsage
    } finally { provider.close() }
}

@Test
func sseLedgerUsagePreservesMissingDimensions() {
    let missing = ledgerUsageFromSse("{\"choices\":[]}")
    @Expect(missing.hasReported(), false)
    @Expect(missing.meterSource, "unknown")
    let totalOnly = ledgerUsageFromSse("{\"usage\":{\"total_tokens\":12}}")
    @Expect(totalOnly.input, Int64(-1))
    @Expect(totalOnly.output, Int64(-1))
    @Expect(totalOnly.cacheRead, Int64(-1))
    @Expect(totalOnly.cacheWrite, Int64(-1))
}

@Test
func sseLedgerUsageSeparatesCachedInputFromUncachedInput() {
    let usage = ledgerUsageFromSse("{\"usage\":{\"prompt_tokens\":100,\"completion_tokens\":10,\"prompt_tokens_details\":{\"cached_tokens\":30,\"cache_creation_input_tokens\":20}}}")
    @Expect(usage.input, Int64(50))
    @Expect(usage.output, Int64(10))
    @Expect(usage.cacheRead, Int64(30))
    @Expect(usage.cacheWrite, Int64(20))
    @Expect(usage.meterSource, "vendor")
}

@Test
func sseLedgerUsageUsesVendorCacheMissAndHitDimensions() {
    let usage = ledgerUsageFromSse("{\"usage\":{\"prompt_tokens\":100,\"completion_tokens\":0,\"prompt_cache_hit_tokens\":40,\"prompt_cache_miss_tokens\":60}}")
    @Expect(usage.input, Int64(60))
    @Expect(usage.output, Int64(0))
    @Expect(usage.cacheRead, Int64(40))
    @Expect(usage.cacheWrite, Int64(-1))
}

@Test
func sseLedgerUsageRejectsCacheLargerThanPrompt() {
    @ExpectThrows[Exception](ledgerUsageFromSse("{\"usage\":{\"prompt_tokens\":10,\"completion_tokens\":1,\"prompt_tokens_details\":{\"cached_tokens\":11}}}"))
}
