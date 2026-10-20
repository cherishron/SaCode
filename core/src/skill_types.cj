package core

// 技能类型定义（第 2 段：独立核心发现与解析模块）。
// 对齐 docs/plans/skill-integration-design-2026-10-20.md §3.1。
// SkillSummary = 目录项（list 返回，不含 content）；SkillDefinition = 完整定义（get 返回，含 content）。
// 不用 DSH 的 invocation/rank 数值字段：调用策略用 modelInvocable/userInvocable 两布尔位，
// 跨层同名覆盖按 §3.2 优先级表（provider 注册顺序），不靠 rank。

// 技能资源指引：只给 directory/url/opaque hint，不枚举不抓取。
// 模型要读资源目录下文件须走现有 read 工具受审批（§3.5 资源契约）。
public class SkillResourceBase {
    public let kind: String       // "directory" | "url" | "opaque"
    public let path: String       // directory 路径 / url / 空(opaque)
    public init(kind: String, path!: String = "") {
        this.kind = kind
        this.path = path
    }
}

// 技能摘要：list 返回项，不含 content。
public class SkillSummary {
    public let name: String                       // ^[a-z0-9]+(-[a-z0-9]+)*$ kebab-case
    public let description: String
    public let whenToUse: String                  // 可选，默认空
    public let modelInvocable: Bool               // 默认 true；false 时 skill 工具不暴露
    public let userInvocable: Bool                // 默认 true；false 时 /name 手势不触发（首版不实现该反例）
    public let source: String                     // project-native | project-agents | user | bundled
    public let provider: String                   // provider 实例名
    public let path: String                       // SKILL.md 源文件路径；bundled/opaque 可为 ""
    public let resourceBase: ?SkillResourceBase
    public init(name: String, description: String, whenToUse!: String = "",
                modelInvocable!: Bool = true, userInvocable!: Bool = true,
                source!: String = "", provider!: String = "",
                path!: String = "", resourceBase!: ?SkillResourceBase = None) {
        this.name = name
        this.description = description
        this.whenToUse = whenToUse
        this.modelInvocable = modelInvocable
        this.userInvocable = userInvocable
        this.source = source
        this.provider = provider
        this.path = path
        this.resourceBase = resourceBase
    }
}

// 完整技能定义：get 返回，含 content。组合 SkillSummary（不继承，避免 仓颉 类继承复杂度）。
public class SkillDefinition {
    public let summary: SkillSummary
    public let content: String                    // frontmatter 之后的 markdown 正文
    public init(summary: SkillSummary, content: String) {
        this.summary = summary
        this.content = content
    }
    public func name(): String { return summary.name }
    public func description(): String { return summary.description }
}
