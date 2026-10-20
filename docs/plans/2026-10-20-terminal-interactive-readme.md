# F09 实时交互终端 — 实现设计（2026-10-20）

本目录是 **纯设计**，不是产品代码，也不是对本仓启动 PTY 的执行授权。

| 文件 | 内容 |
| --- | --- |
| [DESIGN.md](./DESIGN.md) | 现状盘点、三车道分离、Host 分派、PTY/FFI、安全边界、与 execution 复用、待确认项 |

**一句话现状：** 工作台「终端」标签已开放，但只回放已落盘 `terminal/chunk`；没有 spawn、stdin、resize、中断。`execution/*` 是一次性 pipe 任务（stdin 丢弃），不能冒充交互 PTY。

**本设计不做：** 改 core/Host/桌面源码、提交、推送、引入 xterm/node-pty、对本机开 ConPTY。
