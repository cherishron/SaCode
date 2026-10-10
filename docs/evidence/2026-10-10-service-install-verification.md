# 2026-10-10 批次 L：npm 发布态真实 tarball 安装验收（任务 5 的 Windows 半）

对象：`scripts/verify-service-install.mjs`（新增）。取证态：**工作区态**（HEAD = `cfd4b6b`，工作区含并发会话未落库改动）。所有计数与 rc 都是当轮实跑读数，可在本机重跑：

```
node scripts/verify-service-install.mjs              # 完整 11 步（会真打包、真 npm pack/install）
node scripts/verify-service-install.mjs --self-test  # 只反证判据，0 秒级，不碰产物
node scripts/verify-service-install.mjs --keep       # 保留一次性安装目录（落在 gitignore 的 target/）
```

## 1. 这批补的是批次 H 留的那个洞

批次 H 的 `scripts/pack-service.test.mjs` 铺的是**合成安装布局**：用 `copyFile` 把 `package.json` 与 `bin/` 直接拷进 `node_modules` 该在的位置。它能证「包装脚本解析到包内那一份、缺产物时 fail-loud」，但证不了下面这三件事，因为它们的前提在合成布局里被手工跳过了：

1. **npm 自己打出来的 tarball 里到底有没有那些文件**——`files` 白名单漏一项、清单没进包，合成布局一律看不出来；
2. **npm 自己 install 会不会生成 `.bin` shim**——`bin` 字段写错在合成布局里不会被发现；
3. **离线**——合成布局不需要 tarball，也就没有 `--offline` 这条约束。

本批改成真链条：`pack-service` 填平台包 → `npm pack --offline` 出两个 tarball → `tar` 读内容与解文本成员 → `npm install --offline` 装进仓内一次性目录 → 剥掉仓颉 SDK 的 PATH 跑包内 `daemon` 与 `cli`。

## 2. 整条门禁读数（当轮实跑）

| # | 步骤 | 判决 | 实测 |
| --- | --- | --- | --- |
| 1 | pack-service 用真实产物填平台包 | PASS | rc=0，packed 93 个文件（可执行 3 + 运行期库 82 + 扩展宿主 7），清单 `bin/service-manifest.json` 对 gitSha `cfd4b6b` |
| 2 | npm pack 离线产出两个 tarball | PASS | `stand-alone-sacode-0.2.0.tgz` rc=0、`stand-alone-sacode-win32-x64-0.1.0.tgz` rc=0 |
| 3 | 主包 tarball 带齐两个入口与清单 | PASS | 主包条目 3 / 平台包条目 94，`package/bin/cli.js`、`package/bin/daemon.js`、`package/package.json` 都在 |
| 4 | 平台包 tarball 带 daemon、清单、运行期库与扩展宿主 | PASS | daemon=true 清单=true 运行库=82 扩展宿主文件=7 |
| 5 | 两个 tarball 都不含身份/审计/密钥类文件 | PASS | 无命中（`instance.id`/`*.audit.log`/`*.key`/`*.crt`/`*.env`/`*.devices.json`） |
| 6 | 包内文本内容不含本机绝对路径 | PASS | 语料 35853 字节 / 文本成员 12 个（主包 3811 B + 平台包 32042 B），无泄漏 |
| 7 | npm install 离线装出两个包 | PASS | rc=0，主包与平台包目录都落进 `node_modules` |
| 8 | npm 生成 `sacode` 与 `sacode-daemon` 两个命令 shim | PASS | `.bin`: sacode, sacode-daemon, sacode-daemon.cmd, sacode-daemon.ps1, sacode.cmd, sacode.ps1 |
| 9 | 探针自证：剥掉的 SDK 里 `cjc` 确实不可见 | PASS | 剥过的 PATH 下 `where cjc` 非零 |
| 10 | 包内 daemon 在无 SDK 环境下起来并答 `/health` | PASS | 端口 22770，`/health` = 200 `{"status":"ok","sseSubscribers":0}` |
| 11 | 包内 CLI 的 `all` 子命令无 FAIL 且有 PASS | **FAIL** | rc=1，`^PASS`=129、`^FAIL`=2、汇总行 `FAILURES=2`；包内 exe mtime = 2026-10-10T06:42:39.827Z（本轮刚刷新的产物），gitSha `cfd4b6b` |

**整体判决：FAIL（10 PASS / 1 FAIL）。** 这条 FAIL 是真产品缺陷，见 §4。

## 3. 判据反证：`--self-test` 与一轮三变异

写完门禁先怀疑它自己的绿灯。第 6 步原本是照「tarball **条目名**里不含本机绝对路径」写的——npm 打出来的条目一律以 `package/` 打头，所以这条**结构上永真**，等于没检查。这个缺陷不是推测出来的，是 `--self-test` 基线自己报的红：

```
FAIL  反证：盘符绝对路径必须被抓到（期望 true，实得 false）
```

`absHits(['package/D:/Project/x'])` 返回空——判据只匹配「整串开头是盘符」。改成按**内容**判：从两个 tarball 里解出 `.js/.cjs/.mjs/.json` 文本成员拼成语料再扫（第 6 步现在的 35853 B / 12 个成员就是这条读数，语料为空即判不过）。

内容判据的反证集共 19 条，覆盖「该抓到」与「不该误报」两侧。基线 `--self-test` 19/19，rc=0。

变异轮（`target/` 下的副本，原文件不动，跑完逐字还原并删除副本）一轮同时施加三个语义变异，每个变异有独占受害用例：

| 变异 | 改法 | 预期受害 | 实得 |
| --- | --- | --- | --- |
| M1 | `cleanVerdict` 丢掉 `list.length > 0` 守卫 | 空文本不得判「无绝对路径」通过、空清单不得判「无秘密」通过 | 两条各红 |
| M2 | 秘密正则摘掉 `devices\.json` | 设备快照必须被抓到 | 红 |
| M3 | `WIN_ABS_RE` 丢掉前导分隔符类 | https / http 的冒号不能误报成盘符 | 两条各红 |

```
红 5 条 / 预期 5 条；多判：[]；漏判：[]
还原逐字一致=true，复跑 rc=0，变异标记残留=0
变异轮 rc=0
```

误报侧的三条（`https://` 的 `s:`、`http://` 的 `p:`、`/usr/share/zoneinfo`）不是装饰：判据靠「盘符前必须是行首或分隔符」把 URL 排除，而时区表是运行期内嵌资源、不是本机路径——所以 POSIX 白名单只列 `home/Users/Project/var/folders`。

## 4. 那 2 条 CLI 自测红：HEAD 级的两入口断言矛盾

```
FAIL 装配序把依赖排在前面（第二入口同一套核心）
FAIL 未接的种类如实拒成 kind-not-wired 而不是静默不装
```

归因链条（逐条可复跑）：

1. **不是旧产物**。包内 CLI mtime = 06:42:39Z 是本轮 `node scripts/pack-cli.mjs` 刚刷新的（该脚本会先 `cjpm build` 再把 `apps/cli/target/release/bin/main.exe` 逐字拷成 `bin/sacode.exe`）。刷新前它是 12:16 的旧文件，`scripts/pack-service.test.mjs` 第 2 条用例当场报了摘要不符（`c9fbd9c8…` vs `fd806de5…`）——那套陈旧产物检查按设计抓住了它；刷新后开发态与安装态读数**逐字一致**（都是 129 PASS / 2 FAIL），说明红在源码不在打包。
2. **不是并发会话的工作区改动**。`core/src/plugin_assembly.cj` 在工作区是干净的（`git status` 无输出），其 HEAD 版本的 `pluginWiredKinds`（现 `core/src/plugin_assembly.cj:30`）写死 `["tool", "model", "service", "ui", "preset"]`，同文件 `:17` 注释「五类（tool/model/service/ui/preset）已全部接通激活路径」。装配层的 `kind-not-wired` 拒绝分支只对**不在这张表里**的种类触发。
3. **core 侧的 cj 用例已经把新行为钉住了**：`assemblyActivatesEveryWiredKind`（现 `core/src/plugin_assembly_test.cj:88`）断言五类全进装配序且 `@Expect(p.rejected.size, Int64(0))`（现 `:99`）；同文件 `assemblyStillRejectsKindWithoutActivationPath`（现 `:103`）另有一条防御用例，用种类 `magic` 要求 `@local/weird=kind-not-wired:magic`（现 `:108`）。
4. **CLI 第二入口那两条重复断言还停在接通前的世界**：`apps/cli/src/main.cj:475` 要求 `planA.units.size == 2` 且 `:477` 要求 `@local/panel`（种类 `ui`）被拒成 `kind-not-wired`。`ui` 现在已接通，所以它会进装配序——`units.size` 变 3、拒绝表里不再有 `@local/panel`。一条行为变更同时打掉这两条断言，而夹在中间的第三条（缺依赖只坏它自己）照旧绿，这与实测的「131 条里只红这 2 条」完全吻合。

所以这不是「测试写错了要改」，而是**这份自测自己声明的不变量没兑现**：它开头注释写的是「这些判据与 core 的 `plugin_assembly_test.cj` 同形——同一套核心在两入口必须给出同一个答案」。core 与 CLI 现在给的不是同一个答案，红是对的说法。

修法（两行，把 CLI 侧对齐 core，而不是改 core 语义）：把 `apps/cli/src/main.cj:475` 的期望改成三条单元按名字序 `@local/base → @local/panel → @local/upper`（`size == 3`），把 477 的 `@local/panel=kind-not-wired` 换成一个真正未接的种类名（core 用的是 `magic`），保留防御位。

**本批没动这个文件**：`apps/cli/src/main.cj` 正被并发会话持有（`git status` 为 ` M`，其未提交 diff 的 hunk 覆盖 HEAD 481–513 行段，正是这两条断言所在处）。在别人手底下改这几行、再行级剥离提交，会直接吞掉他们的 hunk。这条与批次 K 那条撤销事故半径同一处理：保持红、写清修法、等授权或等对方落库。

## 5. 我自己这条假绿风险，记在案

第 6 步的条目名判据已经绿了一整轮（`PASS  tarball 条目里不含本机绝对路径  全是 package/ 相对路径`），而且措辞听起来很合理。如果不是给门禁补了反证集，这条会一直挂在 PASS 表里，将来包内真出现硬编码 `D:\Project\...` 也照样绿。教训的形状和之前几次一样：**「无命中」在永不会命中的判据上必然出现**。

## 6. 本批明确没做到的（不缩范围）

1. **Linux 平台包的安装态**：**BLOCKED**。本机无 Linux，Windows SDK 交叉编译 Linux 的探针此前实测 rc=1；`pack-service` 对 Linux 只做了「收 `.so`、ELF、可执行位」的脚本侧准备，没有真包真装。解锁动作 = 提供 Linux 原生构建环境（装系统依赖不在本次授权范围）。
2. **真发布到 registry 后的安装态**：**未做**。本批用 `npm pack --offline` + `npm install --offline <两个 tgz>` 走的是本地 tarball，`optionalDependencies` 的平台包匹配靠显式给出两个 tarball 完成，没有验证「registry 上按 `os/cpu` 自动挑平台包」这条真实分发路径——那需要 `npm publish`，属未获授权动作。
3. **Node 版本矩阵**：只在当轮 `process.execPath` 一个版本上验过（v24）。计划里「剥 SDK、无仓库环境」的口径部分兑现（PATH 剥了仓颉与 stdx，`cjc` 不可达已自证），但「无仓库」没做到——安装目录仍在仓库内的 `target/` 下。
4. **包内 `sacode`（CLI 之外的子命令面）**：只跑了 `all` 这一个自测子命令。`sacode-daemon` 只验了 `/health`，远程接入面（`SACODE_REMOTE_ACCESS=1` + TLS + 建票 + `/rpc`）在**安装态**没有重跑；那套在开发态有 4 个测试文件覆盖，安装态等价证据仍缺。
5. **包内 Host 未被真实 spawn**：`sacode-host.exe` 进了包、摘要对上了，但这一条链（桌面/daemon 在剥 SDK 的环境下 spawn 包内 host 并跑完一次 initialize）没在安装态验。
6. **签名**：包内三颗 exe 全部未签名（无公司主体，见用户级记录），本批不改变这一状态。

## 7. 与计划/规格的对应

- 计划任务 5「Windows/Linux CLI+Host+daemon 同包与 npm 平台分发」的 Windows 半，从「合成布局可解析」推进到「真 tarball 真 install 真跑」，并额外钉住内容侧泄漏判据。
- 规格里「干净安装包验证」这条现在有一份会自己报警的执行器；它的整体判决是 FAIL，不是 PASS——这条 FAIL 是 §4 那个两入口矛盾，不该被读成「打包链坏了」。
