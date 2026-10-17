package cli

import core.*
import std.env.*

// CLI 面的使用提醒。stdout 的制表符行和 JSON 是给程序读的，所以提示一律走 stderr。
//
// 「有没有真人坐在终端前」只用真实可观察的信号，不假装探测：
//   --json            → 机器输出，闭嘴
//   call 读不到应答   → 应答者不存在（EOF/重定向），闭嘴
//   SACODE_TIPS=0     → 显式关掉（把 stderr 并进来的管道用这条）
// 另外 Cangjie 1.1.3 的 std 没有 stdout 重定向探测（getStdOut() 是 ConsoleWriter，
// 无 isTTY 成员，本机实测报错），所以不自称做了 TTY 判定。

func cliTipsMachineOutput(args: Array<String>): Bool {
    return hasFlag(args, "--json")
}

func cliTipsPiped(): Bool {
    return (getVariable("SACODE_TIPS") ?? "") == "0"
}

// 无障碍只在用户显式声明时生效：CLI 无法可靠判读屏器在不在，宁可不出也不误判。
func cliTipsAccessibility(): Bool {
    return (getVariable("SACODE_ACCESSIBILITY") ?? "") == "1"
}

func printCliStartupTip(mode: String, args: Array<String>, hasAnswerer: Bool): Unit {
    if (!TipsService.cliEligible(mode, hasAnswerer, cliTipsMachineOutput(args), cliTipsPiped())) {
        return
    }
    try {
        let id = TipsService.forUser().startup(cliTipsAccessibility())
        if (id.size > 0) {
            getStdErr().writeln("tip\t${TipsService.textFor(id)}")
        }
    } catch (_: Exception) {
        // 提示面失败不影响命令本身：命令的结果比小提示重要。
    }
}

// sacode tips            取下一条启动提示（并推进跨会话轮换）
// sacode tips hide|show  改两个入口共用的「隐藏使用提醒」开关
func runTipsCommand(args: Array<String>): Int64 {
    var wantHide = false
    var wantShow = false
    if (args.size > 1) {
        if (args[1] == "hide") { wantHide = true } else if (args[1] == "show") { wantShow = true } else {
            getStdErr().writeln("usage: sacode tips [hide|show]")
            return 64
        }
    }
    try {
        let tips = TipsService.forUser()
        if (wantHide || wantShow) {
            let changed = tips.setHidden(wantHide)
            let hiddenText = if (tips.hidden()) { "true" } else { "false" }
            let changedText = if (changed) { "true" } else { "false" }
            getStdErr().writeln("tips\thidden=${hiddenText}\tchanged=${changedText}")
            return 0
        }
        // 取提示这一步也听 SACODE_TIPS=0：hide/show 是用户在明确改设置，必须回话；
        // 而「给一条提示」在把 stderr 并走的管道里就该闭嘴。
        if (cliTipsPiped()) {
            getStdErr().writeln("tips\toff")
            return 0
        }
        let id = tips.startup(cliTipsAccessibility())
        if (id.size == 0) {
            getStdErr().writeln("tips\tnone")
            return 0
        }
        getStdErr().writeln("tip\t${TipsService.textFor(id)}")
        return 0
    } catch (e: Exception) {
        getStdErr().writeln("tips-error\t${e.message}")
        return 8
    }
}
