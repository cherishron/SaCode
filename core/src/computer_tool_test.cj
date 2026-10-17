package core

import std.unittest.*
import stdx.encoding.json.*

func computerSpec(name: String): ToolSpec {
    for (s in computerToolSpecs()) { if (s.name == name) { return s } }
    throw Exception("computer-spec-missing: ${name}")
}

@Test
func computerToolsDeclareExactlyThirteenAndApprovalPolicy() {
    let names = ["windows.list", "windows.get", "window.observe", "click", "double_click", "right_click", "drag", "scroll", "type", "press_key", "hotkey", "set_value", "verify_state"]
    @Expect(computerToolSpecs().size, 13)
    for (i in 0..names.size) {
        let s = computerSpec("computer.${names[i]}")
        @Expect(s.needsApproval, i >= 3 && i < 12)
        let schema = JsonValue.fromStr(s.params).asObject()
        @Expect(schema["additionalProperties"].asBool().getValue(), false)
        @Expect(schema["type"].asString().getValue(), "object")
        let p = schema["properties"].asObject()
        @Expect(p["pid"].asObject()["minimum"].asInt().getValue(), Int64(1))
        @Expect(p["pid"].asObject()["type"].asString().getValue(), "integer")
    }
}

@Test
func computerActionsRequireObservationUuidAndPositiveWindowIds() {
    for (s in computerToolSpecs()) {
        let schema = JsonValue.fromStr(s.params).asObject()
        let p = schema["properties"].asObject()
        if (s.name != "computer.windows.list") {
            @Expect(p["windowId"].asObject()["minimum"].asInt().getValue(), Int64(1))
        }
        if (s.needsApproval) {
            @Expect(p["observationId"].asObject()["format"].asString().getValue(), "uuid")
            var found = false
            let required = schema["required"].asArray()
            for (i in 0..required.size()) {
                if (required[i].asString().getValue() == "observationId") { found = true }
            }
            @Expect(found, true)
        }
    }
}

@Test
func computerPointSchemasExcludeMixedAndPartialCoordinates() {
    for (name in ["click", "double_click", "right_click", "scroll"]) {
        let schema = JsonValue.fromStr(computerSpec("computer.${name}").params).asObject()
        let alternatives = schema["oneOf"].asArray()
        @Expect(alternatives.size(), Int64(2))
        @Expect(alternatives[0].asObject()["required"].asArray().toString(), "[\"windowId\",\"x\",\"y\"]")
        @Expect(alternatives[0].asObject()["not"].asObject()["required"].asArray().toString(), "[\"elementToken\"]")
        @Expect(alternatives[1].asObject()["required"].asArray().toString(), "[\"elementToken\"]")
        @Expect(alternatives[1].asObject()["not"].asObject()["anyOf"].asArray().size(), Int64(2))
        @Expect(schema["properties"].asObject()["x"].asObject()["type"].asString().getValue(), "number")
    }
}

@Test
func computerSchemasMatchProviderBoundsAndClosedPaths() {
    let drag = JsonValue.fromStr(computerSpec("computer.drag").params).asObject()["properties"].asObject()
    for (key in ["fromX", "fromY", "toX", "toY"]) {
        @Expect(drag[key].asObject()["type"].asString().getValue(), "number")
    }
    @Expect(drag["durationMs"].asObject()["type"].asString().getValue(), "integer")
    @Expect(drag["durationMs"].asObject()["maximum"].asInt().getValue(), Int64(10000))
    @Expect(drag["steps"].asObject()["maximum"].asInt().getValue(), Int64(200))
    let observe = JsonValue.fromStr(computerSpec("computer.window.observe").params).asObject()["properties"].asObject()
    @Expect(observe["maxTextChars"].asObject()["minimum"].asInt().getValue(), Int64(512))
    @Expect(observe["includeScreenshot"].asObject()["type"].asString().getValue(), "boolean")
    let verify = JsonValue.fromStr(computerSpec("computer.verify_state").params).asObject()["properties"].asObject()
    @Expect(verify["expect"].asObject()["items"].asObject()["type"].asString().getValue(), "object")
    for ((name, field) in [("type", "text"), ("press_key", "key"), ("set_value", "value")]) {
        let p = JsonValue.fromStr(computerSpec("computer.${name}").params).asObject()["properties"].asObject()
        @Expect(p[field].asObject()["type"].asString().getValue(), "string")
    }
    let hotkey = JsonValue.fromStr(computerSpec("computer.hotkey").params).asObject()["properties"].asObject()
    @Expect(hotkey["keys"].asObject()["items"].asObject()["type"].asString().getValue(), "string")
}
