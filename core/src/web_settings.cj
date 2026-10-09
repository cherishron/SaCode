package core

import std.fs.*
import std.env.*
import std.sync.*
import stdx.encoding.json.*

let webSettingsMutex = Mutex()

public class WebProviderSettings {
    public let id: String
    public let enabled: Bool
    public let endpoint: String
    public let credentialRef: String
    public let model: String
    public let maxTokens: Int64
    public let maxUses: Int64
    public let searchType: String
    public let highlights: Int64
    public let recency: String
    public init(id: String, enabled!: Bool = true, endpoint!: String = "", credentialRef!: String = "",
        model!: String = "", maxTokens!: Int64 = 0, maxUses!: Int64 = 5,
        searchType!: String = "auto", highlights!: Int64 = 1, recency!: String = "") {
        this.id = id
        if (id != "exa" && id != "perplexity" && id != "deepseek-official" && id != "tavily" && id != "firecrawl" && id != "parallel" && id != "tinyfish") { throw Exception("web-provider-unknown") }
        this.enabled = enabled
        this.endpoint = if (endpoint.size > 0) { endpoint } else {
            if (id == "exa") { "https://api.exa.ai" }
            else if (id == "perplexity") { "https://api.perplexity.ai" }
            else if (id == "tavily") { "https://api.tavily.com" }
            else if (id == "firecrawl") { "https://api.firecrawl.dev" }
            else if (id == "parallel") { "https://search.parallel.ai" }
            else if (id == "tinyfish") { "https://api.search.tinyfish.ai" }
            else { "https://api.deepseek.com/anthropic/v1" }
        }
        this.credentialRef = if (credentialRef.size > 0) { credentialRef } else {
            if (id == "exa") { "EXA_API_KEY" }
            else if (id == "perplexity") { "PERPLEXITY_API_KEY" }
            else if (id == "tavily") { "TAVILY_API_KEY" }
            else if (id == "firecrawl") { "FIRECRAWL_API_KEY" }
            else if (id == "parallel") { "PARALLEL_API_KEY" }
            else if (id == "tinyfish") { "TINYFISH_API_KEY" }
            else { "DEEPSEEK_API_KEY" }
        }
        for (byte in this.credentialRef.toArray()) {
            if (!((byte >= 65 && byte <= 90) || (byte >= 97 && byte <= 122) ||
                (byte >= 48 && byte <= 57) || byte == 95)) { throw Exception("bad-credential-ref") }
        }
        let first = this.credentialRef.toArray()[0]
        if (first >= 48 && first <= 57) { throw Exception("bad-credential-ref") }
        if (!webUrlAllowed(this.endpoint)) { throw Exception("web-bad-endpoint") }
        let target = WebUrlTarget(this.endpoint)
        if (target.scheme != "https" || this.endpoint.contains("?") || this.endpoint.contains("#")) {
            throw Exception("web-bad-endpoint")
        }
        this.model = model
        this.maxTokens = if (maxTokens > 0) { maxTokens }
            else { if (id == "deepseek-official") { Int64(4096) } else { Int64(1024) } }
        this.maxUses = maxUses
        this.searchType = searchType
        this.highlights = highlights
        this.recency = recency
        if (maxTokens < 0 || this.maxTokens > 65536 || maxUses <= 0 || maxUses > 100 || highlights <= 0 || highlights > 100) {
            throw Exception("web-bad-provider-parameters")
        }
        if (searchType != "auto" && searchType != "keyword" && searchType != "neural") { throw Exception("web-bad-search-type") }
        if (recency.size > 0 && recency != "day" && recency != "week" && recency != "month" && recency != "year") {
            throw Exception("web-bad-recency")
        }
    }
    public func toJsonValue(): JsonObject {
        let object = JsonObject()
        object.put("id", JsonString(id)); object.put("enabled", JsonBool(enabled))
        object.put("endpoint", JsonString(endpoint)); object.put("credentialRef", JsonString(credentialRef))
        object.put("model", JsonString(model)); object.put("maxTokens", JsonInt(maxTokens))
        object.put("maxUses", JsonInt(maxUses)); object.put("searchType", JsonString(searchType))
        object.put("highlights", JsonInt(highlights)); object.put("recency", JsonString(recency))
        return object
    }
}

public class WebSettingsSnapshot {
    public let revision: Int64
    public let enabled: Bool
    public let selectedProvider: String
    public let providers: Array<WebProviderSettings>
    public init(revision: Int64, enabled: Bool, selectedProvider: String, providers: Array<WebProviderSettings>) {
        this.revision = revision; this.enabled = enabled; this.selectedProvider = selectedProvider; this.providers = providers
    }
    public func toJson(): String {
        let object = JsonObject()
        object.put("revision", JsonInt(revision)); object.put("enabled", JsonBool(enabled))
        object.put("selectedProvider", JsonString(selectedProvider))
        let rows = JsonArray()
        for (provider in providers) { rows.add(provider.toJsonValue()) }
        object.put("providers", rows)
        return object.toString()
    }
}

func webSettingsCheckKeys(object: JsonObject, allowed: Array<String>): Unit {
    for ((key, _) in object.getFields()) {
        var found = false
        for (name in allowed) { if (name == key) { found = true } }
        if (!found) { throw Exception("web-unknown-setting:${key}") }
    }
}

public class WebSettings {
    let file: String
    public init(file: String) { this.file = file }
    public static func forUser(): WebSettings {
        let home = getVariable("USERPROFILE") ?? (getVariable("HOME") ?? "")
        if (home.size == 0) { throw Exception("web-settings-home-missing") }
        return WebSettings(Path(home).join(".sacode").join("web.json").toString())
    }
    public func snapshot(): WebSettingsSnapshot {
        if (!exists(file)) {
            return WebSettingsSnapshot(0, false, "", [WebProviderSettings("exa"), WebProviderSettings("perplexity"), WebProviderSettings("deepseek-official"), WebProviderSettings("tavily"), WebProviderSettings("firecrawl"), WebProviderSettings("parallel")])
        }
        let object = JsonValue.fromStr(String.fromUtf8(File.readFrom(file))).asObject()
        return parse(object, None)
    }
    public func snapshotJson(): String { return snapshot().toJson() }
    private func parse(object: JsonObject, previous: Option<WebSettingsSnapshot>): WebSettingsSnapshot {
        webSettingsCheckKeys(object, ["revision", "enabled", "selectedProvider", "providers"])
        let revision = object["revision"].asInt().getValue()
        if (revision < 0) { throw Exception("web-bad-revision") }
        let fallback = previous ?? WebSettingsSnapshot(0, false, "", [WebProviderSettings("exa"), WebProviderSettings("perplexity"), WebProviderSettings("deepseek-official"), WebProviderSettings("tavily"), WebProviderSettings("firecrawl"), WebProviderSettings("parallel"), WebProviderSettings("tinyfish")])
        let enabled = if (let Some(value) <- object.get("enabled")) { value.asBool().getValue() } else { fallback.enabled }
        let selected = if (let Some(value) <- object.get("selectedProvider")) { value.asString().getValue() } else { fallback.selectedProvider }
        if (selected.size > 0 && selected != "exa" && selected != "perplexity" && selected != "deepseek-official" &&
            selected != "tavily" && selected != "firecrawl" && selected != "parallel" && selected != "tinyfish" && selected != "random") {
            throw Exception("web-provider-unknown")
        }
        var providers = fallback.providers
        if (let Some(rows) <- object.get("providers")) {
            let array = rows.asArray()
            for (index in 0..array.size()) {
                let row = array[index].asObject()
                webSettingsCheckKeys(row, ["id", "enabled", "endpoint", "credentialRef", "model", "maxTokens", "maxUses", "searchType", "highlights", "recency"])
                let id = row["id"].asString().getValue()
                var slot: Int64 = -1
                for (position in 0..providers.size) { if (providers[position].id == id) { slot = position } }
                if (slot < 0) { throw Exception("web-provider-unknown") }
                for (earlier in 0..index) {
                    if (array[earlier].asObject()["id"].asString().getValue() == id) { throw Exception("web-duplicate-provider") }
                }
                let merged = providers[slot].toJsonValue()
                for ((key, value) in row.getFields()) { merged.put(key, value) }
                providers[slot] = WebProviderSettings(id,
                    enabled: merged["enabled"].asBool().getValue(), endpoint: merged["endpoint"].asString().getValue(),
                    credentialRef: merged["credentialRef"].asString().getValue(), model: merged["model"].asString().getValue(),
                    maxTokens: merged["maxTokens"].asInt().getValue(), maxUses: merged["maxUses"].asInt().getValue(),
                    searchType: merged["searchType"].asString().getValue(), highlights: merged["highlights"].asInt().getValue(),
                    recency: merged["recency"].asString().getValue())
            }
        }
        return WebSettingsSnapshot(revision, enabled, selected, providers)
    }
    public func updateJson(input: String): String {
        synchronized(webSettingsMutex) {
            let previous = snapshot()
            let next = parse(JsonValue.fromStr(input).asObject(), Some(previous))
            if (next.revision != previous.revision) { throw Exception("web-settings-revision-conflict") }
            let committed = WebSettingsSnapshot(previous.revision + 1, next.enabled, next.selectedProvider, next.providers)
            let parent = Path(file).parent
            if (!exists(parent)) { Directory.create(parent, recursive: true) }
            File.writeTo(file, committed.toJson().toArray())
            return committed.toJson()
        }
    }
}
