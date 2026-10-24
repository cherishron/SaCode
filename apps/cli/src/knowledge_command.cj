package cli

import core.*
import std.convert.*
import std.env.getStdErr

// 显式指定项目目录；用户知识不隐式混入项目查询。
func runKnowledgeCommand(args: Array<String>): Int64 {
    try {
        if (args.size < 4) {
            // 用法是诊断面：与其它入口一样走 stderr + 64，stdout 只留查询/写入结果。
            getStdErr().writeln(
                "usage: sacode knowledge <list|save|remove|import|reference> <user|project> <workspace-or-empty> [query | id title content revision | id revision]");
            return 64
        }
        let store = KnowledgeStore.forScope(args[2], args[3])
        if (args[1] == "list" && args.size <= 5) {
            println(store.query(if (args.size == 5) {
                args[4]
            } else {
                ""
            }));
            return 0
        }
        if (args[1] == "save" && args.size == 8) {
            println(store.save(args[4], args[5], args[6], Int64.parse(args[7]), false));
            return 0
        }
        if (args[1] == "remove" && args.size == 6) {
            println(store.save(args[4], "", "", Int64.parse(args[5]), true));
            return 0
        }
        if (args[1] == "reference" && args.size == 6) {
            println(store.reference(args[4], Int64.parse(args[5])));
            return 0
        }
        if (args[1] == "import" && args.size == 8) {
            println(store.importFile(args[4], args[5], args[6], Int64.parse(args[7])));
            return 0
        }
        println("knowledge-bad-args");
        return 2
    } catch (e: Exception) {
        println(if (e.message.startsWith("knowledge-")) {
            e.message
        } else {
            "knowledge-storage-unavailable"
        });
        return 1
    }
}
