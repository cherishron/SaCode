package daemon

import core.*
import stdx.encoding.json.*

// canonicalDigest 是幂等账的「规范化内容」那一半：同键同内容必须同摘要，
// 否则客户端只是换了字段顺序就被判成「同键不同内容」而拒绝（§5）。
// 反向也要成立：摘要不能靠拼串边界伪造出同一份内容。

func digestOf(text: String): String {
    return canonicalDigest(JsonValue.fromStr(text))
}

@Test
func topLevelKeyOrderDoesNotChangeTheDigest() {
    @Expect(digestOf("{\"a\":1,\"b\":\"x\"}") == digestOf("{\"b\":\"x\",\"a\":1}"), true)
}

@Test
func nestedKeyOrderDoesNotChangeTheDigest() {
    // 递归：嵌套层的顺序同样不参与内容标识，否则只有顶层被规范化。
    @Expect(digestOf("{\"a\":{\"x\":1,\"y\":2}}") == digestOf("{\"a\":{\"y\":2,\"x\":1}}"), true)
    @Expect(digestOf("{\"a\":[{\"x\":1,\"y\":2}]}") == digestOf("{\"a\":[{\"y\":2,\"x\":1}]}"), true)
}

@Test
func valueAndArrayOrderParticipateInContent() {
    @Expect(digestOf("{\"a\":1}") == digestOf("{\"a\":2}"), false)
    // 数组是有序的：换序就是不同内容。
    @Expect(digestOf("{\"a\":[1,2]}") == digestOf("{\"a\":[2,1]}"), false)
    @Expect(digestOf("{\"a\":1}") == digestOf("{\"a\":1,\"b\":null}"), false)
}

@Test
func digestCannotBeForgedByStringBoundaries() {
    // 长度前缀分帧：类型/键/正文的边界写不出同一个摘要输入。
    @Expect(digestOf("{\"a\":\"b|c\"}") == digestOf("{\"ab\":\"c\"}"), false)
    @Expect(digestOf("{\"a\":{\"b\":1}}") == digestOf("{\"a\":\"{\\\"b\\\":1}\"}"), false)
    @Expect(digestOf("{}") == digestOf("[]"), false)
    @Expect(digestOf("{\"a\":true}") == digestOf("{\"a\":\"true\"}"), false)
    @Expect(digestOf("{\"a\":null}") == digestOf("{\"a\":\"null\"}"), false)
}

@Test
func integralFloatAndIntAreTheSameContent() {
    // 1 与 1.0 是同一个数：客户端重新序列化就换个摘要会造出假冲突。
    @Expect(digestOf("{\"a\":1}") == digestOf("{\"a\":1.0}"), true)
    @Expect(digestOf("{\"a\":1}") == digestOf("{\"a\":1.5}"), false)
    @Expect(digestOf("{\"a\":-3}") == digestOf("{\"a\":-3.0}"), true)
}
