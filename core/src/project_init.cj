package core

import std.fs.*
import stdx.encoding.json.*

// 固定模板、仅新建；不接受任意路径或正文，不把选择工作区变成隐式写操作。
public func projectInitSpec(): ToolSpec {
    return ToolSpec("project_init", "初始化当前项目配置（仅创建缺失模板，不覆盖已有文件，需一次性审批）。",
        "{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"directory\"],\"properties\":{\"directory\":{\"type\":\"string\"}}}",
        true)
}

func projectInitCheck(root: String, path: String, directory: Bool): Unit {
    if (!exists(path)) {
        return
    }
    let info = FileInfo(path)
    if (info.isSymbolicLink() || info.isDirectory() != directory ||
        !lspPathInsideWorkspace(canonicalize(path).toString(), root)) {
        throw Exception("project-init-unsafe-path")
    }
}

func projectInitDirectory(root: String, path: String): Unit {
    projectInitCheck(root, path, true)
    if (!exists(path)) {
        try {
            Directory.create(path, recursive: false)
        } catch (e: Exception) {
            if (!exists(path)) {
                throw e
            }
        }
    }
    projectInitCheck(root, path, true)
}

public func initializeProject(log: SessionLog, args: String): String {
    let request = JsonValue.fromStr(args).asObject()
    if (request.size() != 1) {
        throw Exception("project-init-bad-args")
    }
    let expected = request.get("directory").getOrThrow().asString().getValue()
    let workspace = SessionWorkspace(log)
    let directory = workspace.directory()
    if (directory.size == 0) {
        throw Exception("project-init-no-workspace")
    }
    if (expected != directory || !exists(directory) || !FileInfo(directory).isDirectory()) {
        throw Exception("project-init-workspace-changed")
    }
    let root = canonicalize(directory).toString()
    let configDir = Path(root).join(".sacode").toString()
    let rulesDir = Path(root).join(".ohmyagent").toString()
    let config = Path(configDir).join("settings.json").toString()
    let rules = Path(rulesDir).join("AGENTS.md").toString()
    // 在任何写入前校验所有已存在位置；拒绝链接/junction 把模板导出工作区。
    projectInitCheck(root, configDir, true)
    projectInitCheck(root, rulesDir, true)
    projectInitCheck(root, config, false)
    projectInitCheck(root, rules, false)
    var count: Int64 = 0
    let created = JsonArray()
    if (!exists(config) || !exists(rules)) {
        projectInitDirectory(root, configDir)
        projectInitDirectory(root, rulesDir)
        let paths = [config, rules]
        let names = [".sacode/settings.json", ".ohmyagent/AGENTS.md"]
        let templates = ["{}\n",
            "# 项目协作说明\n\n## 项目概况\n请补充项目用途与主要目录。\n\n## 开发与验证\n请补充构建、测试及运行命令。\n\n## 协作约定\n- 修改前阅读相关代码。\n- 保留已有配置，不提交密钥。\n- 修改后运行相关验证，并说明未执行项。\n"]
        for (i in 0..paths.size) {
            // 每一笔写入前重核父目录；发布原语自身保证不覆盖并发出现的文件。
            projectInitCheck(root, configDir, true)
            projectInitCheck(root, rulesDir, true)
            projectInitCheck(root, paths[i], false)
            if (exists(paths[i])) {
                continue
            }
            try {
                publishNewFile(paths[i], templates[i].toArray())
                count += 1
                created.add(JsonString(names[i]))
            } catch (e: Exception) {
                if (!exists(paths[i])) {
                    throw e
                }
                projectInitCheck(root, paths[i], false)
            }
        }
    }
    let result = JsonObject()
    result.put("status", JsonString(if (count == 0) {
        "already-initialized"
    } else {
        "initialized"
    }))
    result.put("createdCount", JsonInt(count))
    result.put("createdFiles", created)
    result.put("message", JsonString(if (count == 0) {
        "项目已初始化，无需重复操作"
    } else {
        "项目初始化完成：创建了 ${count} 个配置文件"
    }))
    return result.toString()
}
