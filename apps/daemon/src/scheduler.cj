package daemon

import core.*
import std.sync.*
import std.time.*

// daemon 调度循环：每分钟 tick，查询 due tasks，调用 Host task/start 执行
public class DaemonScheduler {
    let log: SessionLog
    let store: ScheduleStore
    let host: HostBridge  // 持有 Host 连接

    let running = AtomicBool(false)
    let tickMutex = Mutex()

    init(log: SessionLog, host: HostBridge) {
        this.log = log
        this.store = ScheduleStore(log)
        this.host = host
    }

    public func start(): Unit {
        if (running.load()) { return }
        running.store(true)
        spawn { => this.loop() }
    }

    public func stop(): Unit {
        running.store(false)
    }

    func loop(): Unit {
        while (running.load()) {
            tick()
            sleep(60 * Duration.second)
        }
    }

    func tick(): Unit {
        synchronized(tickMutex) {
            let now = DateTime.now()
            let due = store.dueTasks(now.minute, now.hour, now.dayOfMonth, now.month.ordinal + 1, now.dayOfWeek.ordinal)
            for (taskId in due) {
                executeTask(taskId)
            }
        }
    }

    func executeTask(taskId: String): Unit {
        let tasks = store.listTasks()
        var task: TaskDefinition? = None
        for (t in tasks) {
            if (t.id == taskId) { task = Some(t); break }
        }
        if (let Some(t) <- task) {
            let fireId = store.recordFire(taskId, DateTime.now().toUnixTimeStamp().toSeconds())
            // 调用 Host task/start
            let params = "{\"text\":\"${t.prompt}\",\"workspace\":\"${t.workspaceDir}\",\"sessionLog\":\"${t.sessionLogPath}\"}"
            try {
                host.request("task/start", params)
                // 轮询直到完成
                pollUntilDone(fireId, taskId)
            } catch (e: Exception) {
                store.updateFireResult(fireId, "error", e.message)
            }
        }
    }

    func pollUntilDone(fireId: String, taskId: String): Unit {
        // 简化：实际应轮询 Host task/poll 直到完成
        // 成功则 store.updateFireResult(fireId, "done", ...)
        // 失败/取消则 store.updateFireResult(fireId, "error"/"cancelled", ...)
    }
}
