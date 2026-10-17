package core

import std.collection.*

// 拉取与手动添加上游模型的合并规则：纯函数，不碰网络、不碰盘。
// 两条纪律从这里出：
//   1. 拉取是「补候选」，不是「覆盖人工确认」——已在册条目原样保留；
//   2. 新条目一律 unknown 且带来源标记（provider-listed / user-entered），
//      不许从模型名猜能力，也不许自动启用。
// 结构化富记录拉取（模态/上下文/计价单位/来源证据随响应落盘）是并列的
// 未闭修订点：没有逐家发现合同与凭据联调之前，这里只合并没有字段的 ID。

func specsOf(arr: Array<ModelSpec>): ArrayList<ModelSpec> {
    let out = ArrayList<ModelSpec>()
    for (s in arr) { out.add(s) }
    return out
}

func knownId(list: ArrayList<ModelSpec>, id: String): Bool {
    for (s in list) {
        if (s.id == id) { return true }
    }
    return false
}

// trim 后为空、或在册的一律跳过：拉取是「补候选」，不是「覆盖人工确认」。
func appendIds(list: ArrayList<ModelSpec>, ids: Array<String>, provenance: String): Unit {
    for (raw in ids) {
        let id = raw.trimAscii()
        if (id.size == 0 || id.size > 200 || knownId(list, id)) { continue }
        list.add(ModelSpec(id, id, "", "", false, provenance: provenance))
    }
}

public func mergePulledIds(existing: Array<ModelSpec>, ids: Array<String>): Array<ModelSpec> {
    let list = specsOf(existing)
    appendIds(list, ids, "provider-listed")
    return list.toArray()
}

public func mergeManualIds(existing: Array<ModelSpec>, ids: Array<String>): Array<ModelSpec> {
    let list = specsOf(existing)
    appendIds(list, ids, "user-entered")
    return list.toArray()
}
