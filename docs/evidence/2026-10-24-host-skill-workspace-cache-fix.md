# 2026-10-24 Host 技能发现空目录：工作区/日志缓存修复

## 结论与边界

用户同意先定位TUI技能发现阻塞。本轮根因已确认并定点修复：**技能RPC按activeId长期缓存，initialize时尚未绑定/回放的空工作区被固化；同会话绑定目录不更新缓存，冷启动时shared尚未回放也会装配空provider。** 当前源码与私有构建验证通过，不再称“根因未知”。

没有覆盖 `apps/desktop/dist/host`、成员原target或当前桌面交付包；旧入口仍保留缺陷。仅闭合本次技能浏览装配缺陷的源码/私有验证，不升级F12全域、不宣布产品交付。未执行真实模型任务、技能执行、安装、Git提交/推送或发布。

## 排除与同环境因果证据

1. 原开发Host `052917f9…`与成员Host `7967a3dc…`都复现合成技能未发现。
2. 使用仓颉技能批量查询Directory.readFrom/FileInfo.path/isSymbolicLink/trimStart/trimEnd契约；将**当前未修改的**skill_filesystem/types/provider模块直接cjc编译为小探针。同环境路径/链接/读取预算/frontmatter检查正常、provider发现成功，未据目录差异推断ACL根因。
3. 同一Host/同一项目：initialize→skill/list为空→绑定目录后仍为空→显式select当前会话立即发现并可读正文；冷启动先list仍空，select后恢复。这直接指向Host适配器持有过期空工作区/日志，而不是前端、权限或解析器。
4. 私有同源快照只换回**旧技能缓存逻辑**，构建rc=0，3条首次绑定/同会话换项目/冷启动回归 **0过3败**；恢复本轮修复，构建rc=0，3条 **3过0败**。不是混用旧Host/新UI拼通过。

## 定点修改

- `apps/host/src/main.cj`：删除缓存字段skillRpc及ensureAdapters中的技能装配；skill/list、skill/get在适配分派中独立处理。持租约时使用当前shared，未持租约时按workspace/get相同口径新建SessionLog(p)并load，再按当前sessionWorkingDirectory构造只读SkillRpc。
- 不改变SkillRpc协议、方法能力声明、provider文件边界/预算、权限、授权或文件解析；不改core文件系统模块，不借机修其他适配器。
- main.cj有其他会话既有未提交修改，本轮只编辑技能字段/生命周期/分派片段，没有回退其差异。未对巨型共享文件整文件格式化，避免覆盖无关工作；以编译/定点diff检查验证。
- `apps/host/test/skills/workspace-discovery.test.mjs`新增3条真实协议回归，检查目录式/平铺、非法/超预算拒绝、读前后事件数不变、项目切换无旧正文、冷启动与跨会话恢复。surface测试与dispatch-size另2条。
- TUI真实技能用例移除额外 `SACODE_TUI_SKILL_ACCEPTANCE` 门禁，缺Host仍统一跳过；指定旧Host会正常失败，不能藏在默认skip。用真实Host实际渲染 `/skills`→列表→选中正文，保留读前后事件数不变断言。空态文案不再笼统说当前技能链未验，而提示检查格式或更新旧Host。

## 构建与身份

- Windows，cjc/cjpm1.1.3、stdx1.1.3.1；读取已取得CangjieSkills README与当前加载技能，按脚本批量查契约；本机技能SKILL哈希 `0872d04e…`，已有参考副本为较旧不同版本，未宣称逐字一致。没有重装stdx或清理共享target。
- 私有根 `target/tmp/skill-discovery-fix-20261024-097d71db/`：core+Host生产源/清单/钩子复制，`.deps`只读复用原目录junction；未复制整个含密钥配置的工作区。首次快照漏core.launch_context子包导致缺依赖，补齐递归生产源后构建成功。初始manifest误含4个build-script-cache输出，最终明确剔除生成缓存，`source-input-manifest-final.json` **271输入0漂移**；不把输出日志漂移冒充源码变化。
- 正式私有构建使用成员 `cjpm build --target-dir <私有host-target>`，前置既有runtime/stdx DLL环境，源码主文件与私有快照最终SHA256同为 `8aafa7ea60da8d6c76b8ed94208546e49eead0a4b91a4540c5b0afa2ea5167c6`。基线和修复各构建成功，Host29条已有warning。
- 修复Host：`host-target/release/bin/main.exe` **16,097,280 B / 80 DLL**，SHA256 `71389261df9c29c91a9a219af2683293aea671f9745403b239b8d976fef00e6e`。该产物是诊断/回归Host，不自动晋级唯一桌面候选；未复制不明旧DLL混包。
- TUI重建仅更新空态文案：**529,688 B**，SHA256 `04a7932312c85dfa3190925651e9ae431e495b23bd333eaa2644beb35632b115`，自足与随包许可收集通过；新哈希未安装。

## 验证

- 同快照旧逻辑：`same-snapshot-baseline-tests.log` 3项全失败，保留原断言。
- 修复Host：`host-final-tests.log` **5/5**（3运行+1surface+1dispatch-size），0跳过，约0.41秒。
- TUI指定修复Host全量：`tui-full-tests-final.log` **73/73、0失败/0跳过**，约12.97秒。真实 `/skills` 列表及正文UI用例通过；没有模型收费或技能实际执行。
- 剥离SDK/stdx PATH，仅Windows/System32并以Node绝对路径驱动：真实TUI技能列表/正文用例 **1/1**，`tui-clean-path-skills.log`；私有bin的DLL本地闭包可用，不需降低防护或调整系统PATH。
- 固定源provider探针正常；修复Host诊断 `after-bind=1`、`after-restart=[discovery-probe]`，无需额外select；正文正确。
- 39个TUI/技能测试/构建 `.mjs`语法检查与定点diff检查通过；无TUI lint/typecheck脚本，不冒充这两项。TUI打包及npm pack dry-run rc=0；不据此宣称安装态或真实TTY已验。
- 原始材料：上述私有根中的 `host-build-r2.log`、`host-build-baseline.log`、`host-build-fixed-final.log`、`same-snapshot-baseline-tests.log`、`host-final-tests.log`、`tui-full-tests-final.log`、`tui-real-skills-ui.log`、`fixed-host-diagnostic.log`、`source-input-manifest-final.json`、`npm-pack.json`；FS探针在 `target/tmp/skill-discovery-diagnostic-20261024/`。

## 后续验收

默认开发/桌面Host仍 `052917f9…`，不得声称双击原包即生效。刷新开发载荷或统一候选需按协调流程同源构建、更新身份并重验；本轮不覆盖或并入其他会话候选。可用SACODE_HOST显式选择该私有Host做内部复验，不能当多个对外发布版本。完整技能调用/安装、外部MCP、真实模型任务、真终端及安装态依旧待验。

## 同日续批：默认开发载荷刷新（用户“继续”授权）

以上“默认开发Host仍旧”是前轮时点，现由本节覆盖；历史失败与私有构建记录保留。

### 载荷准备和替换

- 刷新前只读查询未发现使用默认载荷的 `sacode-host.exe/main.exe` 进程，未杀其他进程。核修复Host仍为 `71389261…`，Host主源码与已验证快照哈希一致。
- 比较271个快照输入与当前工作区，仅 `apps/host/cjpm.lock` 不同（构建生成记录）；生产源和清单/钩子未漂移。复用已验证的固定产物，未声称从后来漂移工作区重构新包。
- 旧默认bin混有测试/编译态DLL，不能只复制新exe、保留全部旧DLL。使用现有 `scripts/pack-host.mjs` 从私有修复exe及其**同次构建的80 DLL**组装新暂存载荷，并重新准备仓内固定hash的tzdata2026.5；不从旧载荷借未知DLL。
- 暂存载荷先跑技能与分派回归5/5，随后再次核进程占用，保留旧完整目录，整体移动替换默认 `apps/desktop/dist/host`，未递归删除旧载荷。旧目录备份 `target/tmp/tui-dev-host-refresh-20261024-e36f2d79/previous-host/`，不是第二个对外测试入口。
- 新默认Host **16,097,280 B** / SHA256 `71389261df9c29c91a9a219af2683293aea671f9745403b239b8d976fef00e6e`；根bin为exe+80DLL+zoneinfo目录，总载荷 **709文件**，替换后逐文件SHA256 **709/709一致、0 mismatch**。`previous-manifest.json`、`staged-manifest.json` 保留替换前后身份。此次只重组Host开发载荷，没有重构CLI/daemon/Electron/安装器或npm平台包。

### 默认入口实跑

- 指定新的默认路径运行Host技能/分派/审批模式定向：**7/7，0跳过**；TUI全量 **73/73，0跳过**。日志 `default-host-tests.log` / `default-tui-tests.log`。
- 本轮伪TTY驱动直接运行主包源码 `npm/sacode-cli/bin/cli.js`，显式删除 `SACODE_HOST`/TUI bundle覆盖；使用隔离设置与合成项目，绑定目录→`/skills`→选中正文→`/about`核宿主路径→退出。
- 显式 `tui` 与无参数两分支均 **PASS/rc0**，确实显示 `DEFAULT_ENTRY_SKILL_BODY`，宿主路径为默认 `apps/desktop/dist/host/bin/sacode-host.exe`，不是私有构建目录。驱动只给loopback未监听端点和未调用模型的合成配置，未触发task/start或收费请求，未接触真实Key。
- 剥离SDK/stdx PATH仅保留Windows/System32，以Node绝对路径运行显式入口，仍 **PASS/rc0**，DLL靠exe同目录自足；不改系统PATH/ACL/沙箱。
- 驱动与日志在本轮临时根：`default-entry-smoke.mjs`、`default-entry-{explicit,noargs,clean-path}.log`、`pack-host.log`、两份manifest和回归日志。伪TTY不替代真实键盘、宽字符字形或用户亲手验收。

### 交付边界不变

TUI bundle未改仍 **529,688 B / `04a79323…`**；主包无参/显式tui可在开发目录默认找到修复Host。当前唯一桌面交付候选 `D:/tmp/sacode-final-20261023` 内Host只读复算仍 `e9099849…`，没有覆盖该候选、app.asar、SDK或用户配置，没有安装/发布/提交/推送。开发桌面若从工作区启动会同样使用新默认Host，**本轮未跑完整桌面GUI**。D26的默认开发技能浏览已解阻，正式候选同源刷新及安装态仍未完成，F12全域/真实模型任务不升级。
