package core
import std.collection.*
import std.convert.*

public class CronSpec {
    let minutes = HashSet<Int64>()
    let hours = HashSet<Int64>()
    let doms = HashSet<Int64>()
    let months = HashSet<Int64>()
    let dows = HashSet<Int64>()
    var domIsStar = true
    var dowIsStar = true

    init() {}

    public static func parse(spec: String): CronSpec {
        let raw = spec.split(" ")
        var fields = ArrayList<String>()
        for (s in raw) {
            if (s.size > 0) { fields.add(s) }
        }
        if (fields.size < 5) {
            throw Exception("cron-parse-too-few-fields")
        }
        let c = CronSpec()
        c.domIsStar = (fields[2] == "*")
        c.dowIsStar = (fields[4] == "*")
        c.parseField(fields[0], 0, 59, c.minutes)
        c.parseField(fields[1], 0, 23, c.hours)
        c.parseField(fields[2], 1, 31, c.doms)
        c.parseField(fields[3], 1, 12, c.months)
        c.parseField(fields[4], 0, 7, c.dows)
        if (c.dows.contains(7)) {
            c.dows.add(0)
        }
        return c
    }

    public func matchesMinute(v: Int64): Bool { return minutes.contains(v) }
    public func matchesHour(v: Int64): Bool { return hours.contains(v) }
    public func matchesDom(v: Int64): Bool { return doms.contains(v) }
    public func matchesMonth(v: Int64): Bool { return months.contains(v) }
    public func matchesDow(v: Int64): Bool {
        if (dows.contains(v)) { return true }
        if (v == 7 && dows.contains(0)) { return true }
        if (v == 0 && dows.contains(7)) { return true }
        return false
    }

    public func matches(minute: Int64, hour: Int64, dom: Int64, month: Int64, dow: Int64): Bool {
        if (!matchesMinute(minute)) { return false }
        if (!matchesHour(hour)) { return false }
        if (!matchesMonth(month)) { return false }
        let domMatch = matchesDom(dom)
        let dowMatch = matchesDow(dow)
        if (domIsStar && dowIsStar) {
            return true
        } else if (!domIsStar && !dowIsStar) {
            return domMatch || dowMatch
        } else {
            return domMatch && dowMatch
        }
    }

    func parseField(field: String, min: Int64, max: Int64, set: HashSet<Int64>): Unit {
        let items = field.split(",")
        for (i in 0..items.size) {
            parseItem(items[i], min, max, set)
        }
    }

    func parseItem(item: String, min: Int64, max: Int64, set: HashSet<Int64>): Unit {
        if (item == "*") {
            var i = min
            while (i <= max) { set.add(i); i += 1 }
            return
        }
        let slashIdx = item.indexOf("/")
        if (let Some(idx) <- slashIdx) {
            let base = item[0..idx]
            let stepStr = item[(idx + 1)..item.size]
            var step: Int64 = 1
            try { step = Int64.parse(stepStr) }
            catch (_: Exception) { throw Exception("cron-parse-bad-step") }
            if (step <= 0) { throw Exception("cron-parse-bad-step") }
            if (base == "*") {
                var i = min
                while (i <= max) { set.add(i); i += step }
            } else {
                let dashIdx = base.indexOf("-")
                if (let Some(d) <- dashIdx) {
                    var lo: Int64 = min
                    var hi: Int64 = max
                    try { lo = Int64.parse(base[0..d]) }
                    catch (_: Exception) { throw Exception("cron-parse-bad-range") }
                    try { hi = Int64.parse(base[(d + 1)..base.size]) }
                    catch (_: Exception) { throw Exception("cron-parse-bad-range") }
                    var i = lo
                    while (i <= hi) { set.add(i); i += step }
                }
            }
            return
        }
        let dashIdx = item.indexOf("-")
        if (let Some(d) <- dashIdx) {
            var lo: Int64 = min
            var hi: Int64 = max
            try { lo = Int64.parse(item[0..d]) }
            catch (_: Exception) { throw Exception("cron-parse-bad-range") }
            try { hi = Int64.parse(item[(d + 1)..item.size]) }
            catch (_: Exception) { throw Exception("cron-parse-bad-range") }
            var i = lo
            while (i <= hi) { set.add(i); i += 1 }
            return
        }
        var v: Int64 = 0
        try { v = Int64.parse(item) }
        catch (_: Exception) { throw Exception("cron-parse-bad-number: ${item}") }
        set.add(v)
    }
}