package core

import std.unittest.*

// 本地插件包 manifest 的解析与校验。这是「一切皆插件」从 0 到 1 的第一步，
// 所以用例先钉「什么算一个合法插件包」，再钉「哪几类东西必须被拒」。
//
// 判据分两类，不能混：
//   * 结构非法（缺字段、版本不是三段、入口不是 .cjs）→ 一个通用码 plugin-rejected；
//   * 语义冲突（工具名撞核心内置）→ 独立码 plugin-tool-shadowing。
// 混成一个码，安装时就分不出「你写错了」和「你想冒充核心工具」，而这两件事
// 要的是不同的处置：前者改包，后者必须人工确认。

func baseManifest(): String {
    return "{\"name\":\"@local/sacode-tool-echo\",\"version\":\"0.1.0\",\"kind\":\"tool\",\"entry\":\"index.cjs\"}"
}

// 解析成功回空串，被拒回异常消息里的码。读一次 manifest 字段是为了让「解析结果
// 被使用」成立——不靠丢弃一个有值的表达式来忽略它，也不把捕获循环变量的 lambda
// 递出去（仓颉不允许间接调用捕获可变变量的 lambda，宿主侧已经踩过一次）。
func manifestCode(text: String): String {
    var parsed = false
    try {
        let m = parsePluginManifest(text)
        parsed = m.name.size >= 0
    } catch (e: Exception) {
        return e.message
    }
    return if (parsed) { "" } else { "plugin-rejected" }
}

@Test
func pluginManifestParsesMinimalToolPackage() {
    let manifest = parsePluginManifest(baseManifest())
    @Expect(manifest.name, "@local/sacode-tool-echo")
    @Expect(manifest.version, "0.1.0")
    @Expect(manifest.kind, "tool")
    @Expect(manifest.entry, "index.cjs")
    // title 缺省从包名派生：去掉 scope 前缀，与桌面 mapPackage 的同一条规则。
    @Expect(manifest.title, "sacode-tool-echo")
    @Expect(manifest.optional, false)
    @Expect(manifest.enabled, true)
    @Expect(manifest.order, Int64(0))
    @Expect(manifest.runtimeRange, ">=0.1.0")
    @Expect(manifest.tools.size, Int64(0))
    @Expect(manifest.dependencies.size, Int64(0))
}

@Test
func pluginManifestKeepsUnscopedNameAsTitle() {
    let manifest = parsePluginManifest("{\"name\":\"echo-tool\",\"version\":\"0.1.0\",\"entry\":\"index.cjs\"}")
    @Expect(manifest.title, "echo-tool")
    // kind 缺省取 tool：老包没有这个字段时必须能装，而不是整份作废。
    @Expect(manifest.kind, "tool")
}

@Test
func pluginManifestReadsDeclaredToolsAndOptionalFields() {
    let text = "{\"name\":\"@local/sacode-tool-echo\",\"version\":\"1.2.3\",\"title\":\"回声\","
        + "\"description\":\"原样返回\",\"descriptionZhCN\":\"原样返回入参\","
        + "\"kind\":\"tool\",\"entry\":\"lib/index.cjs\",\"optional\":true,\"enabled\":false,"
        + "\"order\":7,\"dependencies\":[\"@local/sacode-tool-base\"],"
        + "\"sacode\":{\"runtime\":\">=0.2.0\"},"
        + "\"tools\":[{\"name\":\"echo\",\"description\":\"原样返回 text\","
        + "\"params\":\"{\\\"type\\\":\\\"object\\\",\\\"properties\\\":{\\\"text\\\":{\\\"type\\\":\\\"string\\\"}}}\","
        + "\"needsApproval\":true}]}"
    let manifest = parsePluginManifest(text)
    @Expect(manifest.title, "回声")
    @Expect(manifest.descriptionZhCN, "原样返回入参")
    @Expect(manifest.entry, "lib/index.cjs")
    @Expect(manifest.optional, true)
    @Expect(manifest.enabled, false)
    @Expect(manifest.order, Int64(7))
    @Expect(manifest.dependencies.size, Int64(1))
    @Expect(manifest.dependencies[0], "@local/sacode-tool-base")
    @Expect(manifest.runtimeRange, ">=0.2.0")
    @Expect(manifest.tools.size, Int64(1))
    @Expect(manifest.tools[0].name, "echo")
    @Expect(manifest.tools[0].needsApproval, true)
    // params 原样保留：装配层要把它逐字交给模型，这里不做二次编码。
    @Expect(manifest.tools[0].params.contains("\"text\""), true)
}

@Test
func pluginManifestRejectsMissingRequiredField() {
    // 缺 entry：结构位一个默认值都不给，给了就等于让一个装不起来的包通过校验。
    @Expect(manifestCode("{\"name\":\"@local/x\",\"version\":\"0.1.0\",\"kind\":\"tool\"}"), "plugin-rejected")
    @Expect(manifestCode("{\"name\":\"@local/x\",\"entry\":\"index.cjs\"}"), "plugin-rejected")
    @Expect(manifestCode("{\"version\":\"0.1.0\",\"entry\":\"index.cjs\"}"), "plugin-rejected")
    @Expect(manifestCode(""), "plugin-rejected")
    @Expect(manifestCode("   \n\t "), "plugin-rejected")
    @Expect(manifestCode("[1,2,3]"), "plugin-rejected")
    // 反证：同一份 JSON 只补上 entry 就过，说明转红归因于缺字段而不是别的东西。
    @Expect(manifestCode("{\"name\":\"@local/x\",\"version\":\"0.1.0\",\"entry\":\"index.cjs\"}"), "")
}

@Test
func pluginManifestRejectsEscapingEntry() {
    // 入口能逃出插件目录，等于插件可以指到宿主自己的代码上。
    @Expect(manifestCode("{\"name\":\"@local/x\",\"version\":\"0.1.0\",\"entry\":\"../host.cjs\"}"), "plugin-rejected")
    @Expect(manifestCode("{\"name\":\"@local/x\",\"version\":\"0.1.0\",\"entry\":\"lib/../../host.cjs\"}"), "plugin-rejected")
    @Expect(manifestCode("{\"name\":\"@local/x\",\"version\":\"0.1.0\",\"entry\":\"/etc/host.cjs\"}"), "plugin-rejected")
    // 反斜杠（Windows 形态的穿越）
    @Expect(manifestCode("{\"name\":\"@local/x\",\"version\":\"0.1.0\",\"entry\":\"..\\\\host.cjs\"}"), "plugin-rejected")
    @Expect(manifestCode("{\"name\":\"@local/x\",\"version\":\"0.1.0\",\"entry\":\"index.js\"}"), "plugin-rejected")
    @Expect(manifestCode("{\"name\":\"@local/x\",\"version\":\"0.1.0\",\"entry\":\"index.mjs\"}"), "plugin-rejected")
    // 子目录下的 .cjs 是合法形态：本地包不要求平铺。
    @Expect(manifestCode("{\"name\":\"@local/x\",\"version\":\"0.1.0\",\"entry\":\"lib/index.cjs\"}"), "")
}

@Test
func pluginManifestRejectsMalformedVersion() {
    for (bad in ["1.0", "1.0.0.0", "v1.0.0", "1..0", "1.0.x", "1.0.", ".1.0", "1.0.0-alpha", ""]) {
        @Expect(manifestCode("{\"name\":\"@local/x\",\"version\":\"${bad}\",\"entry\":\"index.cjs\"}"), "plugin-rejected")
    }
    @Expect(manifestCode("{\"name\":\"@local/x\",\"version\":\"0.1.0\",\"entry\":\"index.cjs\"}"), "")
}

@Test
func pluginManifestRejectsToolShadowingCoreName() {
    // 独占码：与「字段写错了」分开。插件声明 todo_write/read/write 会被静默接管
    // 核心工具语义，模型看到的两份描述会打架，而日志里只会留下一次普通的调用。
    for (builtin in ["todo_write", "read", "write"]) {
        @Expect(manifestCode("{\"name\":\"@local/x\",\"version\":\"0.1.0\",\"entry\":\"index.cjs\","
            + "\"tools\":[{\"name\":\"${builtin}\",\"description\":\"d\"}]}"), "plugin-tool-shadowing")
    }
    // 反证：不撞名的工具照过，说明转红归因于撞名而不是 tools 段本身。
    @Expect(manifestCode("{\"name\":\"@local/x\",\"version\":\"0.1.0\",\"entry\":\"index.cjs\","
        + "\"tools\":[{\"name\":\"echo\",\"description\":\"d\"}]}"), "")
}

@Test
func pluginManifestRejectsSecretBearingField() {
    // 这份文档面上根本没有能承载明文的槽位；出现了就是整份拒，而不是「存了但读的时候删掉」。
    for (forbidden in ["apiKey", "api_key", "token", "secret", "password", "authorization"]) {
        @Expect(manifestCode("{\"name\":\"@local/x\",\"version\":\"0.1.0\",\"entry\":\"index.cjs\","
            + "\"${forbidden}\":\"sk-live-should-never-land-here\"}"), "plugin-rejected")
    }
    // 显式 null 不算携带：老包里留着这个键但没值是合法形态。
    @Expect(manifestCode("{\"name\":\"@local/x\",\"version\":\"0.1.0\",\"entry\":\"index.cjs\",\"apiKey\":null}"), "")
}

@Test
func pluginManifestRejectsNonObjectToolParams() {
    // 参数 schema 必须是 JSON 对象：把旧的空格参数声明塞进请求体，提供方会直接 400。
    @Expect(manifestCode("{\"name\":\"@local/x\",\"version\":\"0.1.0\",\"entry\":\"index.cjs\","
        + "\"tools\":[{\"name\":\"echo\",\"description\":\"d\",\"params\":\"path content\"}]}"), "plugin-rejected")
    @Expect(manifestCode("{\"name\":\"@local/x\",\"version\":\"0.1.0\",\"entry\":\"index.cjs\","
        + "\"tools\":[{\"name\":\"echo\",\"description\":\"d\",\"params\":\"[1,2]\"}]}"), "plugin-rejected")
}

@Test
func pluginManifestRejectsUnsupportedRuntimeRange() {
    // 只支持 >=x.y.z：别的运算符没有解析入口，认不出就是认不出，
    // 绝不把「看不懂」当成「一定兼容」——那正是让不兼容的包在运行期才炸的唯一路径。
    for (bad in ["^0.1.0", "~0.1.0", "*", "0.1.0", ">=1.0", ">=x.y.z", ">=0.1.0-beta"]) {
        @Expect(manifestCode("{\"name\":\"@local/x\",\"version\":\"0.1.0\",\"entry\":\"index.cjs\","
            + "\"sacode\":{\"runtime\":\"${bad}\"}}"), "plugin-rejected")
    }
}

@Test
func pluginManifestRejectsDuplicateDependency() {
    // 重复依赖必须拒：静默去重会让「依赖被激活几次」取决于去重算法而不是用户的声明。
    @Expect(manifestCode("{\"name\":\"@local/x\",\"version\":\"0.1.0\",\"entry\":\"index.cjs\","
        + "\"dependencies\":[\"@local/a\",\"@local/a\"]}"), "plugin-rejected")
    // 空串依赖同样拒：它会变成一个永远匹配不上的占位。
    @Expect(manifestCode("{\"name\":\"@local/x\",\"version\":\"0.1.0\",\"entry\":\"index.cjs\","
        + "\"dependencies\":[\"\"]}"), "plugin-rejected")
}

@Test
func pluginManifestRejectsMalformedScopedName() {
    // `/` 是包名分隔符，只在作用域形态里成立。这里曾把 `/` 无条件禁掉，
    // 结果一切 `@scope/name` 都在最前面被通用码拒掉，后面更具体的规则
    // （撞名、禁字段）一条都测不出来。所以斜杠判据单独一条用例，三条变异各自只杀它：
    //   * 「恰好一个 /」改成「允许两个 /」→ `@a/b/c` 与 `@local//x` 两条转红；
    //   * 去掉「`@` 开头才允许 /」这个前提 → `x/y` 转红；
    //   * 反斜杠从禁则里删掉 → 见 pluginManifestRejectsBackslashAndBlankInName。
    for (bad in ["@/x", "@local/", "@a/b/c", "@local//x", "/x", "x/", "x//y"]) {
        @Expect(manifestCode("{\"name\":\"${bad}\",\"version\":\"0.1.0\",\"entry\":\"index.cjs\"}"), "plugin-rejected")
    }
    // 反证：合法的作用域形态与无作用域形态都照过——说明转红归因于斜杠形态，
    // 不是「名字里带斜杠就全拒」，也不是「把无 scope 形态弄坏了」。
    @Expect(manifestCode("{\"name\":\"@local/x\",\"version\":\"0.1.0\",\"entry\":\"index.cjs\"}"), "")
    @Expect(manifestCode("{\"name\":\"echo-tool\",\"version\":\"0.1.0\",\"entry\":\"index.cjs\"}"), "")
    @Expect(manifestCode("{\"name\":\"@local/sacode-tool-echo\",\"version\":\"0.1.0\",\"entry\":\"index.cjs\"}"), "")
    let scoped = parsePluginManifest("{\"name\":\"@local/sacode-tool-echo\",\"version\":\"0.1.0\",\"entry\":\"index.cjs\"}")
    @Expect(scoped.title, "sacode-tool-echo")
}

@Test
func pluginManifestRejectsBackslashAndBlankInName() {
    // 反斜杠是 Windows 路径分隔符，会真被当成目录用，与作不作用域无关。
    // 把 `\` 从禁则里删掉，这两条必须转红。
    @Expect(manifestCode("{\"name\":\"@local/x\\\\y\",\"version\":\"0.1.0\",\"entry\":\"index.cjs\"}"), "plugin-rejected")
    @Expect(manifestCode("{\"name\":\"x\\\\y\",\"version\":\"0.1.0\",\"entry\":\"index.cjs\"}"), "plugin-rejected")
    // 空白让包名在日志里对不齐，同样永远禁。
    // 注意转义层数：源码里写 `\\t`，Cangjie 解出 `\t`（反斜杠+t），JSON 再解出一个
    // 真正的制表符——这样断言才落在「名字里有空白」上。写成 `\t` 会让 JSON 直接解析
    // 失败，虽然同样回 plugin-rejected，但测到的是「JSON 坏了」而不是本条规则。
    @Expect(manifestCode("{\"name\":\"@local/x y\",\"version\":\"0.1.0\",\"entry\":\"index.cjs\"}"), "plugin-rejected")
    @Expect(manifestCode("{\"name\":\"@local/x\\ty\",\"version\":\"0.1.0\",\"entry\":\"index.cjs\"}"), "plugin-rejected")
    @Expect(manifestCode("{\"name\":\"@local/x\\ny\",\"version\":\"0.1.0\",\"entry\":\"index.cjs\"}"), "plugin-rejected")
    @Expect(manifestCode("{\"name\":\"@local/x\\ry\",\"version\":\"0.1.0\",\"entry\":\"index.cjs\"}"), "plugin-rejected")
}

@Test
func pluginManifestRejectsUnknownKindAndBadName() {
    // kind 闭集：五类之外的名字不猜。
    @Expect(manifestCode("{\"name\":\"@local/x\",\"version\":\"0.1.0\",\"entry\":\"index.cjs\",\"kind\":\"magic\"}"), "plugin-rejected")
    // 以点开头：隐藏文件不该被当成插件包。
    @Expect(manifestCode("{\"name\":\".hidden\",\"version\":\"0.1.0\",\"entry\":\"index.cjs\"}"), "plugin-rejected")
    // 同名工具在同一个包里声明两次
    @Expect(manifestCode("{\"name\":\"@local/x\",\"version\":\"0.1.0\",\"entry\":\"index.cjs\","
        + "\"tools\":[{\"name\":\"echo\",\"description\":\"d\"},{\"name\":\"echo\",\"description\":\"d\"}]}"), "plugin-rejected")
}

@Test
func pluginManifestAcceptsEveryDeclaredKind() {
    // 用户要求「一切皆插件」涵盖工具、模型、业务能力、前端贡献及预设装配，
    // 所以解析层把五类全部收下；哪些能真正装配由装配层按阶段接，不在这里提前否决。
    for (kind in ["tool", "model", "service", "ui", "preset"]) {
        let manifest = parsePluginManifest("{\"name\":\"@local/x\",\"version\":\"0.1.0\",\"entry\":\"index.cjs\",\"kind\":\"${kind}\"}")
        @Expect(manifest.kind, kind)
    }
}
