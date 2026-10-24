# 扩展接线临时目录复核（2026-10-12）

提交基线：`1bf46d80e81df166bec492e283074397e4fc44e4`；本次使用工作区测试实现，不能记为该提交原样通过。
现有 Host SHA256：`73131303def182f3f5728e09de9d15265aa95137dd97cd0a25bebf7a4b0519cc`。本次未重建 Host。

系统 Temp 原样复跑：8 条，5 通过、3 失败，退出码 1；三条失败均为 user-settings 目录递归创建 Permission denied。
独占仓库临时目录复跑：8/8，退出码 0。随后将夹具固定在忽略的 .tmp-test/plugin-wiring，每条使用 mkdtemp 唯一目录，并为 Host 设独占 TMP/TEMP。

合跑命令（cwd apps/desktop）：
`node --test test/plugin-manager-wiring.test.mjs test/plugin-manager-search.test.mjs test/plugin-manager-recovery.test.mjs test/plugin-manager-adapter.test.mjs`

结果：33 条、33 通过、0 失败、0 跳过，退出码 0。包括真实 Host 安装、启停、卸载、重启重读以及修订冲突拒绝；保留原有断言。本结果不等于安装包、当前 Host 源码重建或远程市场已通过。
