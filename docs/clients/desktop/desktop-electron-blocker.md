# Electron 二进制下载在本环境不可达（BLOCKED）

时间 2026-10-02。位置 `apps/desktop`。

| 尝试 | 结果 |
|---|---|
| `npm i electron@33`（默认源，二进制取自 GitHub releases） | 安装脚本报 `Electron failed to install correctly`；`node_modules/electron/dist` 不存在 |
| `ELECTRON_MIRROR=https://registry.npmmirror.com/-/binary/electron/` 重试 | npm 仍失败，`dist/electron.exe` 不存在 |
| 同环境早前对 `github.com` 与 `raw.githubusercontent.com` 的抓取 | 均为连接层失败（`fetch failed` / `curl HTTP 000`），与上面一致 |

结论：**这是环境网络前提，不是桌面壳代码缺陷**。`apps/desktop` 的通信层已在纯 Node 下 5/5 通过（`node --test test/bridge.test.mjs`），自包含宿主（exe + 89 个 DLL）也已被 `od -c` 与协议用例双重验证。缺的只是 Electron 运行时本身，因此"安装包"这一验收项保持 BLOCKED，不得记为通过。

解锁后可直接执行的验证（已写进 `main.cjs` 的 `--smoke`）：
`npx electron . --smoke` → 期望打印 `SMOKE PASS` 且退出码 0（握手 + 投影 + 未知方法必须报错）；
`npx electron .` → 打开窗口，点击按钮应追加事件并刷新投影；关闭后 `tasklist | grep -i dsh-host` 应为空（无孤儿进程）。
