# LSP L1 专项再次复核（2026-10-08）

## 本次简报对账与位置参数纠偏

本批从 HEAD `78f79e0727d5d6481e61dfbda438fdc5099442e6` 的工作区取独立源码副本，位置为 `apps/desktop/.tmp-test/lsp-position-20261008/`。七个 verb 的既有实现沿用，本批补齐六个位置动作的必填 `line`、`character`，调用层次另需 `direction`，rename 另需 `newName`；diagnostics 只需 path。列采用 LSP 的 `character` 字段，0 起始 UTF-16 代码单元。Schema、运行时解析及 Electron 守卫均拒绝缺参，不再默认查询 0:0。

新增测试逐项验证缺行、缺列、完整合法请求与 Schema 必填表；修订旧模型夹具为显式位置。桌面测试验证缺字段不会转发，并增加真实 Host 的六类动作缺行、缺列反证。保留文本回退、免审批、诊断不推进 GoalEvidence、rename 预览不落盘及核心不启动服务器的边界。

实测：`cjpm test --no-run` rc=0；`cjpm test --skip-build --filter '*lsp*,*legacyLsp*' --parallel 1 --timeout-each=30s --no-color --no-progress` rc=0，TOTAL 73 / PASS 44 / SKIP 29 / ERROR 0 / FAILED 0。29 条由过滤排除，不能算通过。包含既有 lspSymbols 两条文本回归。日志分别为副本根下 `core-build.log`、`cjpm-focused.log`。这是专项测试集，不是全量核心通过。

新 Host 独立源码构建 `cjpm build` rc=0，日志 `host-build.log`；经 `pack-host.mjs` 打入本副本 `packed/bin/`，未覆盖共享 dist。宿主 SHA256：`F42F7912AEA8D7CED614FA3DF71B5DA06D5DB2EB6C0628C77ED4FC6B41FD4FAE`。设置 `SACODE_HOST` 指向该新产物、私有 TMP/TEMP 后执行 `node --test --test-name-pattern='LSP|lsp' apps/desktop/test/bridge.test.mjs`：4/4，rc=0，日志 `ipc-run.log`。含 preload、逐字段守卫、版本身份以及七个真实 Host 无插件请求；六个位置 verb 分别缺行、缺列均被核心拒绝为 `bad-lsp-params`，未进入文本扫描。

副本 134 个生产与选定测试文件逐文件 SHA256 与读取时工作区相同，清单 `source-manifest.json`。首次编译因测试的 JsonArray 遍历写法及副本缺共享测试夹具失败；首次运行一条旧 lookup 夹具缺位置而红。两处已修正，结算以最终 `cjpm-focused.log` 为准。

本批未提交、推送、安装或启用真实 language server；L2 协议通信及 F08 应用 rename 的审查执行链仍未验收。

产品仓库 `D:/Project/sa/saai/sa-code`，分支 `refactor/dsh-learning`，固定 HEAD `35a69ca9e0f8b7b6ac51271ec76eff3515eaa820`；实现仍为未提交工作区增量。本次未提交、推送、安装或启用语言服务器。

## 结果

- `lsp_contract.cj` 的七个 verb、`LspServer`、扩展名路由，与 Agent 七个步骤、模型免审批 Schema、Host/有限 IPC 已存在。无服务器仍为 `lsp-no-server`，文本回退标记「非语义结果」。旧文本工具保留。
- rename 仅返回预览；诊断与 rename 不增加模型工具成功进展计数。核心没有语言服务器进程启动代码；真实协议通信、文档同步及插件激活属于 L2。
- 当前七个相关源码文件与专项副本逐文件 SHA256 相同：`lsp_contract.cj`、`lsp_contract_test.cj`、`agent.cj`、`model_tool_runtime.cj`、`model_agent.cj`、`lsp.cj`、`lsp_test.cj`。`fs_tools.cj` 整文件不同；逐段 diff 显示是并发线更新 glob 算法，LSP 文本提取段未改。本次不是全部当前核心源码的重新编译验收。
- 专项二进制命令：`core.exe --no-color --parallel=false --timeout-each=30s --no-progress --filter=*lsp*,*legacyLsp*`。实际 **43 通过、0 ERROR、0 FAILED，rc=0**；37 条契约测试与 6 条既有回归。Summary 分母 82，另 39 条是筛选排除，不能算通过。日志：`apps/desktop/.tmp-test/lsp-current-focused.log`。
- 当前桌面源码 `node --test --test-name-pattern='LSP|lsp' apps/desktop/test/bridge.test.mjs`：**4/4，rc=0**，包括七个真实 Host 无服务器请求。SACODE_HOST 使用已有 L1 私有打包产物 `apps/desktop/.tmp-test/lsp-l1-packed/bin/sacode-host.exe`；本次未重建此二进制，不将此结论扩展为整个当前 Host 的验收。日志：`apps/desktop/.tmp-test/lsp-current-ipc.log`。

## 运行边界与未完成项

最初无筛选命令进入既有 glob 非返回用例，未拿到 Summary；确认父子进程身份后只停止本次启动的两进程。随后筛选表达式第一版未匹配任何用例（82 全排除），不作为通过证据。采用修正筛选后才取得上面的 43 条实际执行结果。

先前全量核心失败已登记在 `lsp-l1-reclose-2026-10-08.md`；并发线此后更新了 glob，不能把旧红集合当作当前实测，本次未重新跑全量。没有真实语言服务器、安装包或全产品通过结论。L2 和 F08 的 rename 审查落盘链仍需另行实现与验收。
