# 2026-10-11 · Windows 信任锚与真实供应商链路体检（批次 A）

只记录**实测**。每条结论都带可复跑的命令与当轮读数；对文档里已有的旧归因，改动写在「更正」一节里，不覆盖原文。

## 1. 结论一句话

宿主（以及任何走随包 libssl 的入口）在不带 `SSL_CERT_FILE` 时，对公网 https 供应商的请求**全部塌在 transport 层**（标签 `http-request-error`）；把系统信任根导出成 PEM 交给同一条链路，同一请求立刻变成真实 HTTP 状态码（`http-status:401`）。锚缺失就是这一类「界面一切正常、一次也调不通」的根因。修法不是关掉校验，而是显式提供锚（新增 `core/src/tls_roots.cj`）。

## 2. 因果对（同一宿主、同一请求形状，只差锚）

夹具：`apps/desktop/.tmp-test/real-longcat-e2e.cjs`（临时，不入库），打 `https://api.longcat.chat/openai/v1`。

| 条件 | 读数 |
| --- | --- |
| 不带 `SSL_CERT_FILE` | `finish=error:http-request-error`，`interrupted=true`，正文 0 字符，usage 0，流帧 0 |
| `SSL_CERT_FILE=<系统根导出的 PEM>` | `finish=error:http-status:401`（对端真实应答；正文与状态都进到了失败对象里） |

两条读数相差一次环境变量，其余完全相同——这排除了「供应商挂了」「网络不通」「载荷形状不对」这三种解释。

复跑：
```bash
cd apps/desktop/.tmp-test
node real-longcat-e2e.cjs "" LongCat-2.5-Preview                       # 期望 http-request-error
KEEP_CA=1 SSL_CERT_FILE="$PWD/live-system-ca.pem" \
  node real-longcat-e2e.cjs "" LongCat-2.5-Preview                      # 期望 http-status:401
```

## 3. CFFI 取 Windows 系统根：路由已证伪，原因未证

A1 原计划用 crypt32 的存储入口。实测（探针 `apps/desktop/.tmp-test/tlsprobe/`，逐轮 `cjpm build` rc=0）：

| 入口 | 读数 |
| --- | --- |
| `CertOpenStore(CERT_STORE_PROV_MEMORY=2, X509, 0, 0, NULL)` | 非空句柄，枚举 0（新存储符合预期） |
| `CryptStringToBinaryA(mallocCString("TWFu"), 0, BASE64, NULL, &needed=…)` | `ok=1 needed=3` |
| `CryptAcquireContextA(&h, NULL, NULL, PROV_RSA_FULL, CRYPT_VERIFYCONTEXT)` | `ok=1 h=2315768569312` |
| `CertOpenSystemStoreA(0, "ROOT")` / `(h, "ROOT")` / `CertOpenSystemStoreW(0, L"ROOT")` | **全部 NULL，lastErr=0** |
| `CertOpenStore(CERT_STORE_PROV_SYSTEM_W=10, …, 0x20000 LOCAL_MACHINE, L"Root")` | NULL |
| `CertOpenStore(CERT_STORE_PROV_SYSTEM_W=10, …, 0x10000 CU\|INCLUDE_LOCAL_ROOT, L"Root")` | NULL |
| 同机对照：.NET P/Invoke `CertOpenSystemStoreA(UIntPtr.Zero,"ROOT")` + `CertEnumCertificatesInStore` | **句柄有效，枚举 53 张根** |

判读：Cangjie 侧的调用编组与 crypt32 符号可达性都没问题（前三行是正证），坏的是「系统存储提供者」在本进程内开不起来。**原因未证**，因此不把产品链路建在这条入口上。

> **本节两条读数已被 §14 推翻**（2026-10-11 06:13 复测）：① 「lastErr=0」没有证据力——仓颉侧 `GetLastError` 读到的是死槽（打开必然失败的文件也回 0）；② 第 38/39 行的 `CERT_STORE_PROV_SYSTEM_W` 传的是 10，正确值是 `10+0x8000=32778`（provider 名是 `MAKEINTRESOURCE` 序号，不是字符串）。结论方向不变：§14.2 用正确的 ANSI 序号 9 加同进程正对照重做过，系统存储提供者仍开不起来。原文照留，判据以 §14 为准。

注册表直读也试过（advapi32 通道正常）：`HKLM\SOFTWARE\Microsoft\SystemCertificates\ROOT\Certificates` 枚举到 12 张、`AuthRoot` 另有 41 张（合计正是 .NET 看到的 53），但 `Blob` 值是未公开的「存储头 + 属性表」复合结构（首 16 字节实测 `92 00 00 00 | 01 00 00 00 | 04 00 00 00 | …`，DER 起点不固定）。按未文档布局切片会在 Windows 改版时静默取错锚，放弃。

## 4. PEM 锚路由：可用

同一探针里 `X509Certificate.decodeFromPem` 读 `live-system-ca.pem`（306 825 字节，200 张证书，实测解出 200 张）后：

| 配置 | `https://www.baidu.com` | `https://api.longcat.chat/openai/v1/models` |
| --- | --- | --- |
| `TlsClientConfig()`（Default） | `status=200`（连打两次一致） | `status=401` |
| `CustomCA(PEM 200 张)` | `status=200` | `status=401` |

注意这与第 2 节不矛盾：探针进程与宿主进程**加载的不是同一颗 libssl**——stdx 通过 `libcangjie-dynamicLoader-opensslFFI.dll` 动态装载，探针的 PATH 里有仓颉/stdx 目录，宿主用自己 `bin/` 里随包的 `libssl-3-x64.dll`/`libcrypto-3-x64.dll`。两颗 OpenSSL 的编译期默认证书库位置不同，所以「Default 到底有没有锚」取决于装载的是哪一颗。这正是不能把证书校验交给装载顺序的理由。

另一家供应商 `https://freeapi.dgbmc.top/v1/models` 在 `Default`、`CustomCA(200)`、`TrustAll` 三种配置下都回 `tlsv1 alert internal error (1080)`，`openssl s_client` 却能拿到完整链（叶 ← `Let's Encrypt YE1` ← `ISRG Root YE`）。**它与信任锚无关**，是对端在 stdx 的 ClientHello 下自己报 internal error，属另一类问题。

## 5. 落地的改动

- 新增 `core/src/tls_roots.cj`：`tlsRootsFromPem` / `tlsRootsFromBundle` / `tlsBundleCandidates`（`SACODE_CA_BUNDLE` → `SSL_CERT_FILE` → `~/.sacode/ca-bundle.pem`）/ `tlsDefaultRoots` / `clientTlsConfigWithRoots` / `defaultTlsClientConfig`。取不到锚时**保持 `Default`**，绝不退 `TrustAll`。
- 五个 https 出口改走同一份配置：`core/src/sse.cj`、`core/src/hook_executor.cj`、`core/src/model_catalog.cj`、`core/src/web_exec.cj`、`core/src/web_http.cj`。
- 新增 `core/src/tls_roots_test.cj`（5 条）：PEM 逐张解析、坏正文回空、有锚必须 `CustomCA`、无锚必须留在 `Default`（这条就是「不许悄悄关校验」的钉子）、bundle 文件缺失回空。
- 新增 `scripts/gen-ca-bundle.mjs`（PowerShell 枚举 `LocalMachine\Root` + `AuthRoot` → 去重 → PEM；0 张或非 base64 一律拒绝产出文件）与 `apps/desktop/test/gen-ca-bundle.test.mjs`（5 条）。
- 桌面壳接线：`apps/desktop/paths.cjs` 的 `caBundleSidecar` + `hostEnvWithCaBundle`，`main.cjs` 在把环境交给 `HostBridge` 之前套上它；`apps/desktop/test/paths.test.mjs` 8 条。

## 6. 更正

本批次计划里「未设 `SSL_CERT_FILE` 时任何 https 供应商整批失败，因为 stdx 不读 Windows 证书存储」这句**只对随包 libssl 的进程成立**，不能当成通用结论：探针进程在同一条未设变量的链路上拿到了 200/401。仓库更早的记录（`docs/evidence/https-sse-spike-2026-10-03.md` T4，2026-10-03 实测）也已写明「Default 模式系统 CA 验证直连公网 PASS」，与本次读数一致。原文保留，不覆盖。

第 8 节的负控又更正了本节上面这句话的适用范围一次：连「`CustomCA` 会把信任库收紧到给定列表」也不成立，所以「有锚/无锚」的差别不能靠切片上的握手结果来判，只能在默认证书库确实为空的随包宿主上证。

## 7. 切片读数与变异反证

整仓 `core cjpm test` 本批拿不到（见 §9），改用只含依赖闭包的独立切片模块取证（临时工程 `apps/desktop/.tmp-test/tlsslice/`，不入库，内容逐字节等于 `core/src/tls_roots.cj` + `tls_roots_test.cj`）：

- 基线：`Summary: TOTAL: 5, PASSED: 5, SKIPPED: 0, ERROR: 0, FAILED: 0`，rc=0，0 error 0 warning，末行 `cjpm test success`。
- 一个必须记住的环境坑：`std.unittest` 的 worker 要建临时文件，Git Bash 把 `TMP` 设成 POSIX 的 `/tmp` 时整轮报 `Too many attempts to create a temporary file`——剥码后 **0 个 Summary**，这是「根本没跑」而不是 5 条失败。把 `TMP`/`TEMP` 指到真实盘路径才有读数。

变异反证（只改切片副本，`core/src` 全程未动，还原用 `diff` 与源文件逐字节比对为空）：

| 变异体（故意改坏的实现语义） | 独占受害用例 | 结果 |
| --- | --- | --- |
| 空锚时改成 `TrustAll` | `clientTlsConfigWithoutRootsStaysOnDefaultNeverTrustAll` | FAILED |
| 只取 PEM 的第一张（半份锚生效） | `tlsRootsFromPemParsesEveryCertificateInBundle`、`clientTlsConfigWithRootsVerifiesAgainstThoseRoots` | FAILED |
| 去掉 `tlsRootsFromBundle` 的 exists/读取保护 | `tlsRootsFromMissingBundleFileYieldsNoAnchors` | ERROR |
| 去掉 `tlsRootsFromPem` 的解析 catch | `tlsRootsFromPemOnGarbageYieldsNoAnchors` | ERROR |

前三个变异体独占受害用例互不相交，合一轮全量构建跑：`TOTAL: 5, PASSED: 1, FAILED: 3, ERROR: 1`，rc=1，0 编译错误——唯一留下的绿正是那条未被变异的 `tlsRootsFromPemOnGarbageYieldsNoAnchors`。第四个变异体单独一轮：`TOTAL: 5, PASSED: 4, FAILED: 0, ERROR: 1`，红落在指定用例。还原后复跑回到 `TOTAL: 5, PASSED: 5`，rc=0。**5 条都不是假绿。**

## 8. 真机锚、通道读数，以及一条未过的负控

`node scripts/gen-ca-bundle.mjs <路径>` 本机实测：`信任锚导出完成：53 张`，84 105 字节（`LocalMachine\Root` + `AuthRoot` 共 94 条记录去重得 53，与 §3 里 .NET 枚举的 53 一致）。

在切片里加临时探针（`tlsDefaultRoots()` + `defaultTlsClientConfig()` 的生产装配路径，逐条观测写文件——`cjpm test` 的 worker stdout 不进 cjpm 日志，实测 grep 不到）：

```
CA_GOOD=...live-ca/ca-bundle.pem
roots.size=53
verifyMode=CustomCA(53)
good[53 anchors] https://www.baidu.com/ -> http-status:200
good[api.longcat.chat/v1/models]        -> http-status:404
wrong[1 unrelated anchor] baidu          -> http-status:200
wrong[1 unrelated anchor] longcat        -> http-status:404
```

- 通道本身通：`SACODE_CA_BUNDLE` 指向真机导出的 PEM 时，核心解出 53 张并把配置落到 `CustomCA(53)`（探针 `TOTAL: 7, PASSED: 6, FAILED: 1`，唯一红的是下面这条负控）。
- **负控未过，且必须写在这里**：只放 1 张与链路无关的自签根（`CN=Microsoft Root Certificate Authority`）时，两条 URL 照样拿到 200/404。也就是 **stdx 1.1.3 的 `CertificateVerifyMode.CustomCA(...)` 不把信任库收紧到这份列表**，行为上更接近「往默认证书库叠加锚」。因此：
  * 不能把它当证书锁定（pinning）手段，也不能对外声称「只信这批根」；
  * 它对本产品的价值仍然成立、但成立在别处——给默认证书库为空的那颗**随包 libssl** 补上锚。这条只能在按批次 B 重建出来的宿主上证，不能从切片外推；
  * 反过来说，§5 那条「无锚必须留在 `Default`、绝不 `TrustAll`」的钉子仍然是有意义的下限：`Default` 至少会如实报错，`TrustAll` 会把「没锚」伪装成「已校验」。
- `CertificateVerifyMode` 实测有 4 个 case（`CustomCA` / `Default` / `TrustAll` / `CustomVerify(_)`），穷尽匹配时漏 `CustomVerify` 会报 `non-exhaustive patterns`。

## 9. 当前状态

- 锚机制：代码与 5 条合同测试已落并全绿（§7），真机锚与 `SACODE_CA_BUNDLE` 通道已证（§8）。
- 整仓 `core cjpm test` 计数：**BLOCKED（提交级取证不可得）**。在 `git worktree add --detach` 出的 HEAD 纯净副本里只加本批 9 个文件，编译即红，8 条错误全在他人已入库的文件、且依赖他人**未落库**的工作区内容：
  * `core/src/cmds.cj` 4 条语法错（`init` 缺 `!`、`resolveWithArgs` 用匿名 struct 当返回类型）——同一文件在并发会话的工作区里已修好，未提交；
  * `core/src/team_board.cj` 6 条 + `core/src/team_workspace.cj` 1 条：引用 `WriteLease.protects`、`SessionLog.isDurableFrozen` / `freezeAfterDurableFailure` / `durableCheckpointBatched`、类型 `GitQueryResult`——这些成员只存在于未落库的 `lease.cj`/`session.cj`/`git_workbench.cj`；
  * `core/src/web_network.cj` 1 条 `webUrlEncode` 重载冲突（该文件工作区版本也在改）。
  工作区态另有 8 条 `worktree_setup_test.cj` 错误，同样是他人在途。两个读数都不是本批引入的红灯，不拿来顶替「core 全套通过」。解锁动作：等并发会话把 `cmds.cj`/`lease.cj`/`session.cj`/`git_workbench.cj` 落库后重跑 `cd core && cjpm test`。
- A3「桌面端到端出真答复」：**BLOCKED**。缺的不是代码，是能用的凭据——`~/.sacode/providers.json` 里的 longcat 键对 `/chat/completions` 回 `incorrect api_key`（`curl` 直连实测 401，与故意写错的键同形），`target/step.key` 不存在；唯一免凭据的 `freeapi` 卡在 §4 那条握手问题。解锁动作：提供一个可用真模型键（或恢复 `step.key`），随后按 §2 的复跑命令去掉 `SSL_CERT_FILE` 复验。
- 随包锚文件的**产出**已接（`scripts/gen-ca-bundle.mjs`，装包后落在宿主 exe 同目录的 `ca-bundle.pem`，由壳层经 `SACODE_CA_BUNDLE` 传入）；把它写进 `dist/host/bin/` 的实际执行步骤属批次 B 的重打链，届时用不带 `SSL_CERT_FILE` 的宿主复跑 §2 的因果对。

## 10. 批次 B：从当前源码重建双入口（2026-10-11 03:34–03:45 实测）

- 工作区根 `cjpm build`（members = core/cli/host/daemon）：`cjpm build success`，rc=0，0 条 `error`，164 warning。产物 `target/release/bin/{host,cli,daemon}.exe` 时间戳全部 03:34（11158528 / 10977280 / 11207168 字节）。各 member 目录下那几个 `main.exe`（12:13 / 14:41 / 23:21）是上一轮的冻结产物，没有拿来充当本轮证据。
- `core cjpm test` 仍拿不到计数，且是第三态「根本没跑」：剥码后 Summary 为 0 条、末行 `Error: cjpm test failed`。8 条编译错误全部落在他人在途代码——`core/src/cmds_test.cj` 未提交的 +51 行 TDD 红灯（`registerBuiltinCommands` 自由函数与 `resolveWithArgs` 的实现尚未落地），加已入库的 `core/src/worktree_setup_test.cj` 三处把 `Path` 传给 `wsTWrite(file: String)`。与 §9 同源，不是本批引入，也不拿它冒充「core 全套通过」。
- 随包锚落地：`scripts/pack-host.mjs` 新增 `--ca-bundle=<PEM>`，**校验排在 `rmSync` 之前**——锚路径写错时不许顺手把上一轮还能跑的宿主一起删掉。新测试 `apps/desktop/test/host-ca-bundle-pack.test.mjs` 3/3、rc=0，红灯落点是「那个 flag 被当成 DLL 目录去 `scandir`」。变异反证两个变异体各由独占受害用例杀掉（锚文件名漂成 `ca.pem` → 只杀掉用例 1；校验挪到 `rmSync` 之后 → 只杀掉用例 3），还原后 `diff` 空输出、复跑回 3/3，所以三条都不是假绿。末行计数改成 `readdirSync(dst).length`：同名 DLL 被两个来源各命中一次时，旧累加器报 93 而目录里实际 92。
- 重打 dev 态宿主：`gen-ca-bundle.mjs` 导出 **53 张 / 84105 字节** → `pack-host` 92 个文件；`dist/host/bin/sacode-host.exe` 与 `target/release/bin/host.exe` 的 **sha256 前缀逐字节相同**（`6e71a371fb8303df…`），sidecar `ca-bundle.pem` 与宿主 exe 同目录就位。
- A3 剩下的 TLS 那一半，这次带对照复验通过（临时脚本 `apps/desktop/.tmp-test/anchor-ab-e2e.cjs`，跑的是不带 `SSL_CERT_FILE` 的同一颗新宿主，锚路径来自壳层生产用的同一对函数 `paths.cjs` 的 `caBundleSidecar` + `hostEnvWithCaBundle`，不是脚本自己拼的变量）：

  | 配置 | `turn/poll` 的 `finishReason` | 判读 |
  | --- | --- | --- |
  | 带随包 sidecar 锚 | `error:http-status:400` | TLS 握手已完成，拿到的是真实 HTTP 状态码 |
  | 不给任何锚 | `error:http-request-error` | 塌在传输层 |

  两条链路**必须不同形**才算数：只跑带锚那轮拿不到绿，说明不了是锚在起作用。凭据那一半仍 BLOCKED（longcat 键无效，见 §9），所以「界面出现真答复」这条还没成立。
- CLI 交付面回归（npm 平台包 `npm/sacode-cli-win32-x64`，`bin/sacode.exe` 10978304 字节 @03:45；把 `cjc`/`cjpm` 从 PATH 剥掉后 `node` 仍可见，子 shell 实测 `cjc=NO cjpm=NO`）：`all` 132 PASS / 0 FAIL rc=0，`plugin` 17/0，`extjs` 12/0，`headless` 36/0，`stream` 21/0，`tool` 16/0，`att` 23/0，`goal` 10/0，`cancel` 9/0。
- 修掉一条**陈旧断言**（不是产品缺陷）：CLI 内嵌的装配断言还按「`ui` 类没接」写，而 `pluginWiredKinds` 早已含 `ui`（`core/src/plugin_assembly.cj:30`，本批没动这个文件），于是 `装配序把依赖排在前面` 与 `未接的种类如实拒成 kind-not-wired` 两条假红。判据是它在上一轮 14:41 的旧二进制上同样红，而核心自己的 `plugin_assembly_test.cj:90/108` 早就跟上新契约。改法：把「未接」的夹具换成真正没接的 `magic` 类（沿用核心测试同一形状，这条不变量仍被钉住），另加一条「已接通的种类照样进装配序」，并把顺序断言从「抄一遍核心的同名单破序结果」改成只钉「依赖排在被依赖者前面」（新增 `planPosOf`）。`plugin` 段 14 PASS / 2 FAIL → 17 PASS / 0 FAIL。
- 仍未过的项，都带出处：`sig` 4 条中断断言红（`中断确实送达处理器` / `在途 turn 因中断收束` / `中断类型是 Ctrl+C 或 Ctrl+Break` / `取消的 turn 留下 turn/cancelled`）——上一轮旧二进制读数完全相同，属本机非交互会话不投递 `GenerateConsoleCtrlEvent` 的既有限制；`tools` / `call` / `tips` 需要参数或已有归属会话（`tips-already-owned`），零断言退出，既不算通过也不算失败。

取证态：本节所有构建与测试读数都是**工作树态**（含他人在途源文件）。HEAD 纯净态能拿到的只有 §9 那条「编译即红」；解锁动作不变——等 `cmds.cj` / `lease.cj` / `session.cj` / `git_workbench.cj` 落库后重跑 `cd core && cjpm test`。

## 11. A3 复探（2026-10-11 04:39，批次 E 之后补做，结论仍 BLOCKED）

批次 E 打完包后回头再试一次「有没有可用的真模型入口」，三条都是负向读数，逐条可复跑：

| 探的路 | 命令 | 读数 |
| --- | --- | --- |
| 本机网关 `sa-ai`（`providers.json` 里的 current） | `curl -s -o /dev/null -m 6 -w '%{http_code}' http://127.0.0.1:8090/v1/models` | **`000`**（无人监听；`netstat -ano` 里也查不到 8090） |
| 同条目的凭据面 | 只看形态不看值：`api_key_len=0`、`secret_ref` 实际为空 | 配置就绪但**无凭据**，起轮会落在鉴权前 |
| 记忆里的授权端点 `freeapi.dgbmc.top/v1` | `curl -s -o /dev/null -m 12 -w '%{http_code}' https://freeapi.dgbmc.top/v1/models` | 12 s 内**未返回状态码**（传输层未通），且仓库与 `~/.sacode/` 全文 `grep -rl freeapi.dgbmc.top` 得 0 个文件——这条端点在本机没有任何配置落点 |

所以 §9 那句判据保持不变、也不复述为新事实：**A3 缺的是可用凭据或一个可达的兼容端点，不是代码**。TLS 锚那一半已按 §10 的双向对照验过（不带 `SSL_CERT_FILE` 的新宿主拿得到真实 HTTP 状态码）；「界面出现 assistant/message、usage 落账、session.log 无密钥」这一条要到用户提供任一可用入口后才能成立。解锁动作（任选其一）：给一个能用于 `/chat/completions` 的键，或把 `providers.json` 里 `sa-ai` 指向的本机网关起起来。

## 12. 模型目录自愈、批次 D 复验与批次 E 重打（2026-10-11 05:04–05:30 实测）

### 12.1 一条被自己的探针骗出来的「缺陷」，以及它现在的真实形状

上一轮把「界面选不到模型」归因成渲染层竞态（`app.js` 只在启动时 `load()` 一次）。本轮复核证明**那条归因不成立**，错在探针：`SaCodeModelSelect` 的 root 面板按设计只有一条「模型 · …」根行，模型行要钻进 `pane=model` 才渲染（`renderer/vendor/model-select.iife.js:293-306`），而当时那条探针只数了 root 面板的 `.model-select-row`，读到 `menuRows:1` 就判成「目录是空的」。同一份 A/B 实测（把 `renderer/model-directory-state.js` 临时换回 HEAD 的单发版本再换回来，其余一字未动）：

| 实现 | 界面里能否钻出模型行 | 选模型后 caption | 发一条出答复 | rc |
| --- | --- | --- | --- | --- |
| HEAD 单发（`git show HEAD:` 逐字节换入） | 能，1 条 `step-3.7-flash` | 「选择模型，当前 真实模型」 | 「收到就好」 | 0 |
| 本轮重试版 | 能，1 条 `step-3.7-flash` | 同上 | 同上 | 0 |

**所以界面实测不能充当「自愈生效」的证据**——两轮都没复现竞态。重试最终仍留下，但口径改小：它钉的是两个**可达的失败形状**，不是实跑观察到的现象——`apps/desktop/host-bridge.cjs:85` 的 5 秒请求窗口（`timeout: model/registry/describe`）与同文件 `:88` 的 `host-unavailable`；目录是发送键唯一的路由依据，这两种落空原先没人再扫。先红后绿的红灯是当场看的：两条新用例分别败在 `'error' !== 'ready'` 与 `至少试过一次重试`（`# tests 6 / # pass 4 / # fail 2`），实现后 `6/6, fail 0, rc=0`。有界性钉在 5 次尝试、间隔 `[500,1000,2000,3000]` ms，重试之间必须走定时器（断言 `ticks[0] > 0`，防空转打满宿主）。

### 12.2 批次 D 在新代码上重跑

| 项 | 命令 | 读数 | rc |
| --- | --- | --- | --- |
| 桌面单测 | `TMP=TEMP=apps/desktop/.tmp-test/t2 node --test` | tests 671、suites 1、pass 663、**fail 0、cancelled 0**、skipped 8 | 0 |
| 开发态界面冒烟 | `npm run ui-smoke -- --no-sandbox` | `UI_SMOKE PASS`；报告 `checks 296 / failed 0 / packaged false` | 0 |
| 布局冒烟 | `npm run layout-smoke -- --no-sandbox` | `LAYOUT PASS` 192 行、`LAYOUT FAIL` 0 行 | 0 |
| 宿主残留 | `tasklist //FI "IMAGENAME eq sacode-host.exe"`、`... electron.exe` | 两次都 `No tasks are running` | — |

本机前提照旧两条，缺一条就拿不到上面这些数：`TMP/TEMP` 必须指向仓内已授权写的目录（`%TEMP%` 对 `sacode-host.exe`/`electron.exe` 拒写，见 `2026-10-11-renderer-decoupling-and-full-regression-batchCD.md`），Electron 必须 `--no-sandbox`（Chromium 沙箱初始化在本机 rc=3）。**默认沙箱态仍是 BLOCKED**，解锁动作是本机 Chromium 沙箱能起来，不是改断言。

8 条 skipped 逐条认过，不是本批新造的洞：6 条真模型集成用例（`test/real-provider-e2e.test.mjs`、`test/real-provider-enhance.test.mjs`、`test/host-routing-real.test.mjs`）的门禁读 `STEPFUN_API_KEY` 环境变量或 gitignore 的 `target/step.key`；另 2 条（`test/host-startup-recovery.test.mjs:38/…`）门禁是 `const host = process.env.SACODE_HOST`，光跑 `node --test` 时没设就不执行。这 6 条此前被 §9/§11 记成「缺可用凭据」，本轮发现那把键其实在 `~/.sacode/user/credentials.env` 里且实测可用——归因要在 §13 里更正。

### 12.3 批次 E 因渲染层改动重打并复验

渲染层动了，上一轮的「产物含最新渲染层」不再成立，故整条重打（`dist/host` 未动，仓颉侧零改动）：

- `TMP` 重定向 + `npx electron-builder --config.electronDist=node_modules/electron/dist`，rc=0；产物时间戳全部落在本轮：`SaCode Setup 0.1.0.exe` 84420001 字节、`sacode-portable.exe` 84267967 字节、`win-unpacked/`（05:22–05:24）。
- 新模块确实在包里：`resources/app.asar` 内含 `retryWaits`（单测文件不在 `build.files` 里，因此不出现，属预期）。
- 载荷对账（`7za` 从两个安装器里抽 `resources/app.asar`）：win-unpacked / NSIS / portable 三份 asar **同一个 sha256** `ddee3cb7b90d98d2e08c353e704cdc13ee4eaf56b3f21903bd271f5b374fb439`；NSIS 内 `sacode-host.exe` 与源 `dist/host/bin/sacode-host.exe` **同一个 sha256** `6e71a371fb8303df290572dc087a533465572426061bace0b84ae6382163340a`。
- 打包态界面冒烟（都要设 `SACODE_SSE_FIXTURE` 指到真 `scripts/sse-contract-server.cjs`，否则增强夹具在包内找不到模块）：
  * win-unpacked：`UI_SMOKE PASS`，报告 `checks 296 / failed 0 / packaged true`，rc=0。
  * portable 第 1 轮：报告 `checks 296 / failed 1`，rc=1，唯一非绿是「增强在途时仍能切到另一个会话」（`test-support/ui-smoke.cjs:1141`，等 `.catalog-dialog` 失去 `[open]`，`waitFor` 默认 120×50 ms = 6 秒）。launcher stdout 0 字节，不能拿来判读，判据只有那份报告。
  * portable 第 2 轮（独占跑，`Win32_PerfFormattedData_PerfOS_Processor` 空闲率 89%，无 `cjc/cjpm` 在跑）：报告 `checks 296 / failed 0`，rc=0。
  * **判读**：这条是间歇性的，portable 态 1 红 1 绿；不写成「portable 296/296 通过」，也不靠调大 `waitFor` 掩盖——它是时序脆弱点，落「待运行验证/待查」类，未定位到产品缺陷的证据（同一条在 win-unpacked 与开发态都稳定绿）。
- 签名逐个实测（`powershell -NoProfile -Command Get-AuthenticodeSignature`）：`win-unpacked/SaCode.exe`、`sacode-portable.exe`、`SaCode Setup 0.1.0.exe`、`dist/host/bin/sacode-host.exe` **四条全 `NotSigned`**。这是本轮主动选择（`build.win.signExecutable:false`），「安装包已产出」不等于「已签名可分发」。
- NSIS 真机安装/卸载：仍 **BLOCKED**（无授权，不擅自动用户已装应用）。解锁动作：用户点头后跑一次装→启动→卸，并核 `Get-AuthenticodeSignature` 与卸载残留。

取证态：本节全部读数为**工作树态**（含并发改动的他人文件）。core 侧 `cjpm test` 整仓计数与 A3 完整口径（供应商经模型中心界面保存）见 §13。

## 13. A3 完整口径成立、§9/§11 凭据归因更正、core 整仓计数仍第三态（2026-10-11 05:38–05:49 实测）

### 13.1 更正：§9/§11 把「缺可用凭据」写错了作用域

§11 那三条负向探的是本机网关 `sa-ai`（`000`）、`providers.json` 里的空 key、以及记忆里的 `freeapi.dgbmc.top`（12 s 无状态码）。**这三条都没探 `~/.sacode/user/credentials.env`**，而那里躺着的 `SA_CODE_STEPFUN_API_KEY` 实测可用（本轮两次真答复都出自它）。所以「A3 缺的是可用凭据」这句归因只对 §11 探过的三条路成立，对本机整体不成立——原文保留，判据以本节为准。

### 13.2 A3 完整口径：模型中心界面保存 → 选模型 → 发送 → 出真答复

临时脚本 `apps/desktop/.tmp-test/a3-ui-fullpath.cjs`（不入库）。全程真点击：`#open-settings` → 模型中心 → `[data-model-center-tab="provider-settings"]` → `[aria-label="添加供应商"]` → 填 `Provider ID`/`显示名称`/`API 地址`/`模型 ID 1`/`模型名称 1`/`API 密钥` → 点 `.ps-actions` 里那颗 `保存`；再点开 `.model-select-trigger`、钻进模型面板、点 `[data-model-id="step-3.7-flash"]`；最后 `#composer` + `#send`。环境里**不给** `SSL_CERT_FILE`（显式 delete），锚走随包 sidecar `dist/host/bin/ca-bundle.pem`。

| 步 | 读数 |
| --- | --- |
| 界面保存 | `.ps-error` 为空，列表出现 `编辑 StepFun 真模型` |
| 通道复查 | `providers: ["stepfun:step-3.7-flash"]` |
| 选模型 | 面板 1 条 `step-3.7-flash`，选后 caption=`真实模型`，aria=`选择模型，当前 真实模型` |
| 发送 | `#send.disabled=false`，点击后界面出 `助手 · 1 条消息 ⏎ 收到就好` |
| 用量 | `用量 3406/200000 · 已计量` |
| 会话日志 | 9 行；含 `assistant/message`：**true**；含密钥：**false** |
| 残留 | `tasklist` 对 `sacode-host.exe`、`electron.exe` 均 `No tasks are running` |

**PASS**。

顺带钉出两条界面形状（都不是缺陷，但会决定下一次怎么跑）：

1. 新增供应商时密钥留空会被界面自己拒：`.ps-error` = `新增供应商需填写 API 密钥`；同形状的 `modelsSave(draft,'',0)` 直接打宿主却回 `OK rev=1`——**这道校验在页面层，不在宿主**。上一轮「留空靠 credentialRef 兜住」的假设只对已声明式供应商成立。
2. 环境里已经有 `SA_CODE_STEPFUN_API_KEY` 时，界面里再敲同一把键会回 `-32020 credential-read-only`（供应商记录本身已落库，rev=1）。真实用户形状必须是「环境不给键、界面里敲键」，§13.2 就是这么跑的。另记一条粗糙点：这条 `-32020` 是整串 `Error invoking remote method 'sacode:modelsSave': …` 直接甩进 `.ps-error`，人话化没做到。

安全侧如实一条：界面敲进去的键由宿主写进**设置目录里的 `credentials.env`（90 字节，明文）**——该目录 4 个文件里只有这 1 个含键，`session.log`、`providers.log`、`installation-id`、`tips-history.log` 都不含。A3 的判据（会话日志无密钥）成立，但「凭据落盘为明文」是产品现状，不是本轮引入，也不是可以当成已加密来宣布的。

### 13.3 仓内真模型用例第一次真的执行

`STEPFUN_API_KEY` + `SACODE_HOST` 一起给，跑 `test/real-provider-e2e.test.mjs`、`test/real-provider-enhance.test.mjs`、`test/host-routing-real.test.mjs`、`test/host-startup-recovery.test.mjs`：**8 条，7 ✔ 1 ✖，rc=1**（逐条实名打印，非计数推断）：

- ✔ 真实提供商往返：配置面登记的模型能出真答复（1124 ms）
- ✔ 真模型增强：当前会话的模型把草稿改写得更清楚，且不落进会话消息（20974 ms）
- ✔ 未启动宿主时请求明确拒绝 / 真实 stdin 错误事件拒绝全部在途请求 / 真实宿主退出后不再向死管道写入 / 实际 Host 首次启动读取默认通用设置 / 实际 Host 设置文件读取失败返回协议错误
- ✖ 真实 StepFun：自定义模型请求完成且进入待核算账本——`assert.ok(ledger.includes('usage-unspecified'))` 为假。实读账本：`result:"unsettled"`、`reason:"rate-unregistered:input"`、`meterSource:"vendor"`、`input:72,output:109,cacheRead:3264`。归因：`usage-unspecified` 是 HEAD 的 `core/src/ledger.cj:1071` 在「用量未知」时写的标记，而随包宿主（03:34 构建）里带着并发会话**尚未落库**的 `sse.cj` `reportedUsage = LedgerUsage(...,"vendor")`，用量已知就改走 `rate-unregistered:*`。**这是夹具与产物之间的口径漂移，不是产品缺陷**，所以不改断言掩盖——等 `sse.cj` 那批落库后再复判该标记。

这 3 个用例的夹具端点本轮换成实测可达的那对（`/v1` + `step-3.7-flash`），并按壳层生产位置补 `SACODE_CA_BUNDLE`（缺锚仍在 TLS 层如实失败，不降级校验）；断言一字未改。换端点与补锚之后，不带任何环境变量重跑全套仍是 **671 tests / 663 pass / fail 0 / cancelled 0 / skipped 8, rc=0**（无凭据时那 6 条继续 skip，不会被换成假绿）。

### 13.4 core 整仓 `cjpm test`：仍是第三态「根本没跑」，本批未引入红灯

`cd core && cjpm test` 落盘后按固定流程剥码读：**rc=1，剥码后 `Summary: TOTAL` 计数 0，`^error` 8 条**，末行 `Error: cjpm test failed`——不是「0 条失败」，是测试没跑。8 条落在：

- `core/src/cmds_test.cj:76/77/86/96/108`（`registerBuiltinCommands` 未声明等 5 条）——该文件是并发会话在途未提交的 TDD 红灯，实现还没落地；
- `core/src/worktree_setup_test.cj:160/181/217`（3 条 `mismatched types`）——已入库、归属他人。

本批 A 的 `core/src/tls_roots.cj` / `tls_roots_test.cj` / `sse.cj` 一条都不在错单上。库层替代读数：`cd core && cjpm build` **rc=0、`cjpm build success`、0 条 error、168 warning**，指名 `tls_roots` 的诊断 0 条。解锁动作不变：等 `cmds.cj`/`cmds_test.cj`/`worktree_setup_test.cj` 那条线落库后重跑 `cd core && cjpm test`。

一条本批欠账如实挂着：`core/src/sse.cj:6` 的 `warning: unused import 'stdx.net.tls.*'` 是批次 A 把 TLS 配置收敛到 `defaultTlsClientConfig()` 后的残留，但该文件此刻带着并发会话未落库的 +21 行改动，用 pathspec 提交会一起吞掉，故不在此刻清；等它落库后单独收。

### 13.5 未核销账本断言收口、A3 目标模型名落点核查、批次 D 复跑（2026-10-11 06:01–06:05 实测）

**A3 目标里的模型名先核落点，不靠改名凑通过。** 批次 A3 写的 `dots3-note-prev` 在本仓库全文检索 **0 个文件**（`dots3` 大小写不敏感同样 **0 命中**），在 `~/.sacode` 下 `grep -rl dots3` 也是 **0 个文件**——这个名字在本机没有任何代码或配置落点。所以 A3 按「实测可达的入口」跑（§13.2：`https://api.stepfun.com/v1` + `step-3.7-flash`，界面里敲键），四条判据逐条成立；这里同时如实记一句：**没有**保存过名为 `dots3-note-prev` 的模型，它不算已验项。

**§13.3 那条 1✖ 的收口方式**：把「账本里必须出现 `usage-unspecified` 字面量」换成按账本行结构取记录、再钉**蕴含关系**的断言（`apps/desktop/test/host-routing-real.test.mjs:39-44`）：

- 按「序号 \t 事件 \t JSON」切行，筛 `ledger/unsettled` 且含该模型名的最后一条，取不到即红，并把账本前 160 字节打印进错误信息；
- `rec.result` 必须是 `unsettled`；
- `rec.reason` 必须等于「`rec.input > 0` ? `rate-unregistered:input` : `usage-unspecified`」——用量未知与费率未登记两种契约态被同一条断言各钉一半，随包宿主与 HEAD 谁在位都不可能假装通过；
- 凭据材料不得出现在 `usage-ledger.log`。

读数（键从 `~/.sacode/user/credentials.env` 只读进内存，未打印、未进任何落盘回执；宿主固定 `apps/desktop/dist/host/bin/sacode-host.exe`）：

| 轮 | 配置 | 读数 | rc |
| --- | --- | --- | --- |
| 真模型 4 文件 | `real-provider-e2e` + `real-provider-enhance` + `host-routing-real` + `host-startup-recovery` | **8 tests / 8 pass / fail 0 / cancelled 0 / skipped 0**，§13.3 那条 ✖ 变成 `ok 1 - 真实 StepFun：自定义模型请求完成且进入待核算账本` | 0 |
| 变异 1 | true 分支期望值改成 `bogus-marker` | `not ok 1 - 真实 StepFun…`，`未核销原因与用量不自洽：input=72 reason=rate-unregistered:input`（`+ 'rate-unregistered:input'` / `- 'bogus-marker'`），1 pass 0 / fail 1 | 1 |
| 变异 2 | 事件名筛选项改成 `ledger/absent-event` | 同一条用例 ✖，红在取记录那步，错误信息带出真实首行 `0\tattempt/dispatched\t{"logicalRequestId":"current-…` | 1 |
| 还原 | `cp` 备份回写 | `cmp` 逐字节一致，残留扫描 `bogus-marker` 与 `absent-event` **0 处**，复跑 **1/1 pass** | 0 |

两个变异体各由同一条用例杀掉，所以这条断言不是假绿；但它只钉住**未核销契约的两个分支**，没钉费率本身。

**批次 D 在这个测试文件改动之后复跑**：

| 轮 | 读数 | rc |
| --- | --- | --- |
| run#1 | 671 tests / 662 pass / **1 fail** / cancelled 0 / skipped 8 | 1 |
| 独占复跑那条 ×3 | 三次各自 `ok 1 - 成员消息进入真实Provider与独立持久日志，正文结束不能自动完成任务`，每次 1/1 pass | 0 |
| run#2 | 671 / 663 / **fail 0** / cancelled 0 / skipped 8 | 0 |

run#1 的红是 `error: 'timeout: team/member/create'`（用例在 `team-host.test.mjs:46`，窗口是 `host-bridge.cjs:85` 的 `timeoutMs = 5000` 默认值），同配置第二轮不再复现、独占三连全绿——判为并发负载压穿有界窗口的**间歇性失败**，按原样记录而不抹平。归属：`team-host.test.mjs` 带着并发会话未落库的 +11 行（`withProvider` 夹具把 settings 路径 `.replaceAll('\\','/')`、`rmSync` 加 `maxRetries:10`），不是本批改的文件，本批不动它；也没有靠抬高全局窗口来「治」它——`host-bridge.cjs:82-84` 的注释写明抬高默认值会同时把真卡死的调用放更久，天生更慢的调用应由调用方给有界值。**未证实**的部分挂着：没测出当时具体哪一路负载压住了 `team/member/create`。

顺带复核批次 C 的行数门槛：`apps/desktop/renderer/app.js` 实测 **953 行**（< 1000）。

结束后残留：`tasklist //FI "IMAGENAME eq sacode-host.exe"` → `No tasks are running which match the specified criteria`。

## 14. 复查 §3：两条读数被推翻，但 A1 运行时路线是「被参数正确地证伪」而不是可疑（2026-10-11 06:11–06:13 实测）

动机：§3 把 A1 的运行时 CFFI 路线判死，却留着「原因未证」。本轮先怀疑**自己的探针**，两处都怀疑对了。探针 `apps/desktop/.tmp-test/tlsprobe/src/probe.cj`（v6→v9，临时不入库），构建 `cjpm build` rc=0，运行 rc=0。

### 14.1 更正一：`GetLastError` 在仓颉侧读到的是死槽，§3 的「lastErr=0」从来不带信息

同一次运行里的对照（`CreateFileA` 属 kernel32，可链接）：

| 探针 | 期望 | 实测 |
| --- | --- | --- |
| 打开真实存在的文件 | 无错 | `GetLastError=0`（与期望一致，不构成反证） |
| 打开 `D:/no-such-dir-9271/nope.txt` | Windows 应回 `2`（`ERROR_FILE_NOT_FOUND`） | **`GetLastError=0`** |

假文件必然设置 last error，读数却是 0，说明这枚 import 回来的 `GetLastError` 与 Win32 的错误槽不是同一处。于是 §3 表格里「全部 NULL，**lastErr=0**」那一列**没有证据力**——它既不能支持「提供者拒绝了」，也不能支持「提供者没报错」。原文保留，判据以本节为准。同时 `crypt32` 专用的 `CertGetLastError` 与 `CertCreateSystemRootStore` 在本工具链的 import lib 里**根本没有**：链接期报 `ld.lld: error: undefined symbol` 两条（`build6.log`），所以想拿到真错误码，在仓颉侧眼下没有可用通道（未文档化的 `dlsym` 之类不走，不靠猜签名）。

### 14.2 更正二：§3 的 `CERT_STORE_PROV_SYSTEM_W` 用错了序号；本轮按 ANSI 序号重做

`wincrypt.h` 里 provider 名是 `MAKEINTRESOURCE` 序号，不是字符串：`CERT_STORE_PROV_MEMORY_A=2`、`CERT_STORE_PROV_SYSTEM_A=9`、`CERT_STORE_PROV_SYSTEM_W=(10+0x8000)=32778`。§3 第 38/39 行传的是 **10**，那两行是错的参数，不能当证据。中间还有一轮（v7）把 `"SystemStore"`/`"MemoryStore"` 当字符串传，同样自伤，那一轮的 3~6 行全部作废、不写入结论。

按 ANSI 序号 9 重做，并在同一进程内放一条**正对照**（MEMORY 序号 2）：

| # | 调用 | 实测 |
| --- | --- | --- |
| 1 | `CertOpenSystemStoreA(0, mallocCString("ROOT"))` | NULL |
| 2 | `CertOpenSystemStoreA(hProv, "ROOT")` | NULL |
| 3 | `CertOpenStore(9, X509_ASN_ENCODING, 0, CERT_SYSTEM_STORE_LOCAL_MACHINE, "Root")` | NULL |
| 4 | `CertOpenStore(9, X509, 0, CERT_SYSTEM_STORE_CURRENT_USER\|INCLUDE_LOCAL_ROOT, "Root")` | NULL |
| 5 | `CertOpenStore(9, X509, hProv, LM, "Root")` | NULL |
| 6 | **正对照** `CertOpenStore(2, X509, 0, 0, "")` | **句柄有效，枚举=0**（新存储为空，符合预期） |

判读：`CertOpenStore` 本身、crypt32 绑定、指针与整型参数的编组都在同一次运行里被正对照**当场证明可用**，坏的确实只有「系统存储提供者」这一支——这次是在序号与字符串都试对之后得到的负读数，所以 §3 的**结论不变**，但它的**证据强度**变了：从「参数可能有误的负读数」升级为「带正对照、参数正确的负读数」。A1 的运行时路线仍然不能用，交付仍走 §4/§5 的显式 PEM 锚（`scripts/gen-ca-bundle.mjs` 用 .NET `X509Store('Root'/'AuthRoot','LocalMachine')` 导出，正是 §3 那行 .NET 对照能枚举 53 张的同一批存储）。

一处未决、不粉饰：本轮 `CryptAcquireContextA(..., PROV_RSA_FULL, CRYPT_VERIFYCONTEXT)` 回 `ok=0 hProv=0`，而 §3 记的是 `ok=1 h=<非零>`。两次声明的参数形状不同，且 §14.1 已说明错误码通道不可用，**定不出原因**； rows 2/5 因此实际是在 `hProv=0` 上调的，与 rows 1/3 同形，不影响上面的判读。

「为什么系统存储提供者在本进程开不起来」仍是未证项。要把它查实，缺的是错误码通道（`CertGetLastError` 需进 import lib 或走文档化的动态装载），不是再换一批序号常量试。

## 15. core 整仓计数第四次尝试：仍是第三态，但这次把 49 条错误全部归因完毕；本批未用 import 清掉 4 处（2026-10-11 06:15–06:53 实测）

### 15.1 `cd core && cjpm test`：rc=1、剥码后 `Summary: TOTAL` 计数 0——「根本没跑」，且本批 0 指名

落盘后按固定流程剥码读：**rc=1，`Summary: TOTAL` 0 条，末行 `Error: cjpm test failed`，`49 errors generated, 8 errors printed`**（cjpm 默认只印 8 条，见 §15.2 怎么拿全）。这与 §13.4 同一档位，但阻塞面已经换人：库层 `cjpm build` 本轮 **rc=0、`cjpm build success`、0 条 error**，坏的只有测试编译那一步。

### 15.2 先纠正我自己的一条假读数，再谈归因

第一次我把 `cjpm test -V` 打印出来的那条 cjc 命令用 `cmd /V /C "set Path=…&& cjc.exe …"` 复跑，得到 **rc=0 且 0 条 error**——这个读数**作废**：日志只有 125 字节的 Windows 版本 banner，`core/target/release/unittest_bin/core.exe` 根本不存在，说明 `cmd` 收不到那条内嵌 `&&` 的命令，**cjc 一次都没执行**。零输出既不是「编译干净」也不是「通过」，是「没跑」。改写成仓库内 gitignore 的批处理 `apps/desktop/.tmp-test/core-test-all-errors.cmd`（绝对路径、单引号传给 `cmd //c`）才真正执行。

拿全 49 条的办法是把 cjpm 自己那条命令原样复用并加 `--error-count-limit all`（`cjc --help` 里的选项，默认 8）：

| 报错文件 | 条数 | 归属 |
| --- | --- | --- |
| `core/src/worktree_test.cj` | 28 | **已入库且与工作树逐字一致**（`git diff` 空） |
| `core/src/worktree_setup_test.cj` | 9 | 同上，已入库、他人 |
| `core/src/worktree_tools_test.cj` | 6 | 同上，已入库、他人 |
| `core/src/cmds_test.cj` | 5 | 他人未落库的 TDD 红灯（`undeclared identifier 'registerBuiltinCommands'` 等） |
| `core/src/acp_approval_test.cj` | 1 | 已入库、他人（`lambda capturing mutable variables needs to be called directly`） |

合计 **49 = 49 generated = 49 printed**，本批的 `tls_roots.cj`/`tls_roots_test.cj`/`hook_executor.cj`/`model_catalog.cj`/`web_exec.cj`/`web_http.cj` **0 条指名**。主因写清楚：前三行那 43 条里绝大多数是 `SessionLog(Path(...))` → `expected 'Struct-String', found 'Struct-Path'`，而 `core/src/session.cj` 恰是并发会话**未落库**的 M 文件（其 `let path: String` 就是被改的一侧）——即「已入库的测试调用方」撞上「未落库的签名改动」。解锁动作不变也不掺假：等 `session.cj`/`cmds.cj`+`agent.cj` 那条线落库后重跑 `cd core && cjpm test`；**在它落库前，任何 core 全套计数都拿不到**，这条仍是 BLOCKED，库层 rc=0 只作替代证据、不冒充通过。

### 15.3 本批欠账清掉 4 处，剩 2 处都不是我的

批次 A 把 https 出口收敛到 `defaultTlsClientConfig()` 后留下的 `warning: unused import 'stdx.net.tls.*'`，清理前在测试编译里点名 **6 个文件**：`accel_relay`、`hook_executor`、`model_catalog`、`sse`、`web_exec`、`web_http`。本轮删掉其中属于我批次（最后改动提交为 `e2cc85d`）的 4 个——`hook_executor.cj:14`、`model_catalog.cj:6`、`web_exec.cj:7`、`web_http.cj:8`，`git diff` 恰为 **4 行删除、无其他改动**。清理后 `cd core && cjpm build`：**rc=0、`cjpm build success`、0 条 error、164 warnings**，该告警只剩 **2 处**：`accel_relay.cj`（属批次外提交 `1e6a1c7`）与 `sse.cj`（带着并发会话未落库的 +21 行，按 pathspec 提交会一起吞掉，继续挂着）。四个被改文件此前只调 `defaultTlsClientConfig()`（同包函数，无需 `stdx.net.tls`），这解释了为什么删除能编译通过。

顺带把 `model_catalog.cj:94` 那条 `warning: unused variable:'apiKey'` 判掉，免得下次再被当缺陷追：`summary(apiKey, ids)` 的注释写明「永不带凭据材料」，参数存在就是让调用方必须交出键而摘要侧绝不使用；真正发请求的 `fetch()`（`:100-108`）确实发 `Authorization: Bearer ${apiKey}`，且空键先抛 `model-credential-unavailable`。**不是缺陷，不改他人签名。**

宿主与 Electron 残留：本轮所有跑测结束后 `tasklist //FI "IMAGENAME eq sacode-host.exe"` 与 `electron.exe` 均 `No tasks are running`。

## 16. 第五次取 core 计数：真因是「提交态悬空引用」，HEAD 单独连库层都编不过；最小补齐集已构造性验证（2026-10-11 06:59–07:08 实测）

### 16.1 方法与两条前置排除

副本用 `git worktree add --detach D:/Temp/SaCode-head-core-count-20261011 a5ab6ec`（**仓库外**，主仓全程零改动），167 个 `*_test.cj`。两条会让结论失真的前提先排掉：

- **副本不缺依赖**：HEAD 的 `core/cjpm.toml` 里 `path-option` 是绝对路径 `C:/Users/jingg/stdx-work/stdx-1.1.3.1/windows_x86_64_cjnative/dynamic/stdx`，本机该目录存在（含 `libstdx.*.dll` 等），所以副本**不需要**改配置就能构建——「副本因缺 `.deps` 而红」这个假象被排除（`.deps` 那条相对路径是并发会话未落库的改动，不在 HEAD）。
- **临时产物**：日志与 TMP 全部落主仓 `apps/desktop/.tmp-test/`（已忽略），副本自身在仓库外。
- 为拿完整清单，在**副本**的 `cjc-option` 追加 `--error-count-limit all`。默认上限 8 条正是 §15 归因不完整的直接原因之一。

### 16.2 第一层：HEAD 的实现文件本身有 3 类不合法写法（4 条 error 同一根）

`cjpm test` 8 秒退出、rc=1、剥码后 `Summary: TOTAL` 计数 0（第三态），但这次只有 4 条 error，全在 `core/src/cmds.cj`：

| # | 位置 | 报错原文 |
| --- | --- | --- |
| 1 | `cmds.cj:11:105` | `expected ',' or ')', found '='` |
| 2 | `cmds.cj:64:65` | `expected a type name after ':' in function declaration, found '{'` |
| 3 | `cmds.cj:64:70` | `expected operator or end of expression, found ':'` |
| 4 | `cmds.cj:70:2` | `unclosed delimiter: '{'` |

对应三类 cjc 1.1.3 不接受的写法：默认参数没写 `!`（`parse: Option<…> = None`）、匿名 struct 作返回类型（`: {spec: CommandSpec, args: HashMap<…>}`）、`if` 分支不带花括号的表达式形态。**§15 把 HEAD 的红归给「别人的测试夹具」，本轮更正：主因是已入库的实现文件**，而修正只活在并发会话未落库的 `cmds.cj`（工作区 18+/6−）。

自我误读一并记下，免得下次重犯：第一版统计用 `==>` 行数当「每文件错误数」，把 170 条 warning 的定位一起算了，于是凭空多出 `ledger.cj` 34 条、`migration_pack.cj` 24 条这类假数字；真 error 只有 4 条（后一层 8 条）。判 error 只认 `^error:` 行。

### 16.3 第二层：8 条 error 全是「已入库文件引用未入库定义」，最小补齐集 7 个文件已验证充分

把 `cmds.cj` 修好后重新编，下一层错误才露出来（`--error-count-limit all`，共 8 条）。报错文件全部是**工作区干净、与 HEAD 一致**的，定义侧却都在未落库文件里：

| error 原文 | 报错位置（副本） | 定义所在文件:行 | 该文件 git 状态 |
| --- | --- | --- | --- |
| `undeclared type name 'GitQueryResult'` | `todo.cj:18:25` | `git_workbench.cj:29` | `??` 未入库 |
| `function 'webUrlEncode' has overload conflicts` | `prompt_enhance.cj:8:137` | `web_network.cj:7` | `M` 未落库 |
| `mismatched types` | `prompt_enhance.cj:9:87` | 同上 | `M` |
| `undeclared identifier 'it'` | `prompt_enhance.cj:10:162` | 同上（级联） | `M` |
| `'protects' is not a member of class 'WriteLease'` | `prompt_enhance.cj:11:90`、`:31:68` | `lease.cj:35` | `M` 未落库 |
| `'isDurableFrozen' is not a member of class 'SessionLog'` | `prompt_enhance.cj:12:93`、`attempt_log.cj:28:84` | `session.cj:167` | `M` 未落库 |
| `undeclared identifier 'appendDurablePrefix'` ×3 | 第三轮露出 | `durable_checkpoint.cj:8`/`:31` | `??` 未入库 |

第三轮再补 `ledger.cj`（`M`）与 `durable_checkpoint.cj`（`??`）后，副本 `cjpm build`：**rc=0、打印 `cjpm build success`、0 条 error、170 条 warning**（18 秒，增量）。即**最小充分集 = 7 个未落库实现文件**（`session` / `lease` / `web_network` / `git_workbench` / `durable_checkpoint` / `ledger` / `cmds`），不是猜测而是构造出来的。

### 16.4 对交付链的含义（这条比计数本身更重要）

- **HEAD 单独不可构建**：clean checkout、CI、换一台机器都打不出 core，因而打不出宿主与 CLI。本机之所以能连续出包，是因为工作区一直带着别人未落库的这 7 个文件。
- 所以批次 B「从当前源码重建双入口」里的「当前源码」在本机**只能是工作区态**，不等于提交态；`docs/evidence/2026-10-11-package-and-packed-verification-batchE.md` 那批产物的可复现性以此为前提，需在该文档补一句（下批做）。
- 批次 A/B 的验收项「core cjpm test 计数与 rc」在提交态**取不到**，判决 BLOCKED；解锁动作是**唯一且明确的一条**：让并发会话把上述 7 个实现文件落库（不是测试夹具——这是本轮相对 §13/§15 的实质更正）。

### 16.5 测试层读数：库层转绿后仍 49 条，且与工作区那次同数（2026-10-11 07:07–07:16 实测）

在同一副本（库层已 `cjpm build` rc=0）继续跑 `cjpm test`：**rc=1，`49 errors generated, 8 errors printed`，剥码后 `Summary: TOTAL` 计数 0** —— 仍是第三态，但这次红的位置换了一层：打印出的 8 条是 `3 × missing argument for parameter list '(Struct-String, Struct-String, Int64)' in call`（全在 `core/src/team_model_runtime_test.cj`）+ `5 × mismatched types`（全在 `core/src/worktree_setup_test.cj`），两个文件都是 **HEAD 已入库的测试**。也就是说：**§15 那 49 条不是「未落库的测试夹具自己写坏了」，而是「已入库的测试调用方」对不上「未落库的实现签名迁移」**——同一批 49 在工作区态与「HEAD+7 实现文件」态各测到一次，两次数字相同，这个等式本身就是归因的证据。

顺带记一条方法性事实：`cjc-option = [..., "--error-count-limit", "all"]` 对 `cjpm build` 生效（§16.3 的 8 条是全量），对 `cjpm test` 的测试编译**不生效**（仍然「49 生成 / 8 打印」）。所以测试层的完整清单只能靠 §15 那种从 `cjpm test -V` 里抄出原样 cjc 命令再手工插 flag 的办法拿，不能指望配置文件。

### 16.6 本批判决（五种状态各有独立读数，不许互相顶替）

| 状态 | 命令 | 读数 | 判决 |
| --- | --- | --- | --- |
| HEAD 单独 | `cjpm test` | rc=1，4 条 error（全在 `cmds.cj`），Summary 0 | FAIL（根本没跑） |
| HEAD + cmds.cj 语法修正 | `cjpm build` | rc=1，8 条 error（悬空引用），Summary 0 | FAIL（根本没跑） |
| HEAD + 7 个未落库实现文件 | `cjpm build` | **rc=0、`cjpm build success`、0 error、170 warning** | PASS（仅库层） |
| 同上 + 测试面 | `cjpm test` | rc=1，49 error / 8 打印，Summary 0 | FAIL（根本没跑） |
| 主工作区（他人实现+测试全在飞） | `cjpm test` | rc=1，49 error（§15 已逐文件归因） | FAIL（根本没跑） |

结论按口径写死：**core 全套 `cjpm test` 计数在今日无任何一种状态下可得**，故批次 A/B 验收项「core cjpm test 计数与 rc」= **BLOCKED**；库层 rc=0 只是「补齐集充分」的证据，不冒充测试通过。解锁清单是两层合一：7 个实现文件 **加上** 迁到新 `SessionLog` 签名的测试文件（至少 `team_model_runtime_test.cj`、`worktree_setup_test.cj`），由各自文件主责落库；落库后重跑 `cd core && cjpm test` 即可取数，本批不代改他人文件。

副本处置：取证完成后 `git worktree remove --force D:/Temp/SaCode-head-core-count-20261011`（该副本为本批所建，含本批的 8 处偏差，不留存）；主仓 `git status` 在本批全程未因取证发生改动。

## 17. 批次 B 复验：b6bb886 之后从新产物重建双入口，剥掉仓颉 PATH 逐子命令读数（2026-10-11 07:18–07:23 实测）

起因：§15.3 那次提交删了 core 里 4 处未用 import（源码 mtime 06:20），而随包产物是 03:34/03:45 的，按「不拿上轮冻结二进制充当证据」必须重打一遍。下表全部是本轮新读数。

| 步骤 | 命令 | 实测 |
| --- | --- | --- |
| 宿主构建 | `cd apps/host && cjpm build` | rc=0、`cjpm build success`；`main.exe` **07:18 / 11,158,528 B** |
| 重打随包宿主 | `node scripts/pack-host.mjs apps/host/target/release/bin/main.exe apps/desktop/dist/host <stdx动态目录> <runtime目录> --ca-bundle=apps/desktop/.tmp-test/ca-bundle-fresh.pem` | rc=0、**92 个文件** = 90 颗 DLL + `sacode-host.exe` + `ca-bundle.pem`；`sacode-host.exe` 07:18 |
| 信任锚复现 | `node scripts/gen-ca-bundle.mjs apps/desktop/.tmp-test/ca-bundle-fresh.pem` | **53 张 / 84,105 B**，sha256 前缀 `8a7b03701e0461d8` **与 03:37 那份逐字节相同** ⇒ 锚导出可复现，不是每次随机拼一份 |
| 桌面协议冒烟 | `npx electron . --smoke --no-sandbox` | rc=0，`SMOKE stop forced=false code=0` + `SMOKE PASS` |
| 桌面 UI 冒烟 | `npx electron . --ui-smoke --no-sandbox` | rc=0，**296 条 `UI OK` / 0 条 `UI FAIL`**，末行 `UI_SMOKE PASS` |
| CLI 构建 | `cd apps/cli && cjpm build` | rc=0、`cjpm build success`；`main.exe` 07:20 / 10,978,304 B |
| npm 平台包 | `node scripts/pack-cli.mjs` | rc=0、`packed 45 个文件到 npm/sacode-cli-win32-x64/bin（其中 stdx 33 + openssl 2 + mingw 3），扩展宿主 2`；`bin/sacode.exe` 07:20 |

**剥 PATH 的自证**：把 `PATH` 里匹配 `cangjie|stdx-work` 的条目整段剔掉后 `command -v cjc` / `command -v cjpm` 均回 `NO`，而 `command -v node` 仍 `YES`（扩展宿主要用）。CLI 一律在 `apps/desktop/.tmp-test/cli-run2`（干净、已忽略）里跑，避免自测产物落进源码目录。

逐子命令读数（同一 exe，`^PASS`/`^FAIL` 计数）：`all` **132/0 rc=0**；`headless` 36/0；`plugin` 17/0；`tool` 16/0；`stream` 21/0；`extjs` 12/0；`goal` 10/0；`cancel` 9/0；`ext` 8/0；`sig` **6/4 rc=1**；`seed`、`projection` 是打印 `ok` 行的数据步（非断言式，0 PASS/0 FAIL rc=0）；`realstream` 打印 `skip: SACODE_PROVIDER_BASE_URL unset`（外部配置前提，不算通过）。

`sig` 那 4 条红的原文是 `中断确实送达处理器` / `在途 turn 因中断收束` / `中断类型是 Ctrl+C 或 Ctrl+Break` / `取消的 turn 留下 turn/cancelled`，**与 §里旧二进制那轮的读数逐字相同**，同批其余 6 条（处理器注册、写租约取得与归还、租约文件消失、在册表清空、未落盘写入就地结算）全绿 ⇒ 判为「本机非交互会话不投递 `GenerateConsoleCtrlEvent`」这条既有限制在新产物上复现，不是本轮引入的回归；解锁动作仍是换能投递中断的交互终端（或 ConPTY）再跑。

需要参数/配置的操作类子命令如实记为「未结算」，不当通过：`team describe`、`batch check`（回 `batch-config-missing`）、`goal list`、`worktree`、`remote` 均 rc=64 打 usage；未知模式 `nope-xyz` 同样 rc=64 打同一份 usage，所以 64 只说明「没给参数/不被当自测跑」，不能读成红也不能读成绿。`tips` 独立跑回 **rc=8 `tips-already-owned`**（`core/src/tips.cj:220` 的 `lease.takeoverIfStale()` 为假），且在干净目录下复现——**租约落点不在 cwd、持有者是谁本轮未查**，这条挂着待查，不编成因。

残留：跑完后 `tasklist //FI "IMAGENAME eq sacode-host.exe"` 与 `electron.exe` 均 `INFO: No tasks are running which match the specified criteria.`。一处如实报备：`.tmp-test/cli-run`（第一轮用的目录）删除时报 `Device or resource busy`，按既往经验不死磕删除，留待句柄自然释放后由后续清理。

**批次 B 判决**：双入口从当前工作区源码重建 **PASS**（每步 rc 与产物 mtime/体积如上，均为本轮新构建）；CLI 逐子命令自测 **PASS（除 `sig` 4 条既有限制红、`realstream` 缺外部配置、操作类子命令未结算）**；「core cjpm test 计数」仍按 §16.6 判 **BLOCKED**，本表不冒充它。

## 18. 批次 E 复验被两条真红灯挡住：NSIS 在执行安装包那一步 CANNOT_EXECUTE，打包态冒烟缺测试夹具停在 252/296（2026-10-11 07:24–07:35 实测）

前置：§17 把宿主重打到 07:18 之后，`dist/electron` 里三产物仍是上一轮宿主，故按批次 E 口径重打。命令 `npx electron-builder --config.electronDist=node_modules/electron/dist`（本地官方 dist 269 MB，**未设任何镜像**）。

| 产物 | 结果 | 实测 |
| --- | --- | --- |
| `win-unpacked/` | 产出 **PASS** | 07:24；日志含 `updating asar integrity executable resource` 与 `file signing skipped via signExecutable configuration`；随包宿主 `resources/host/bin/sacode-host.exe` 11,158,528 B @07:18（就是 §17 那颗） |
| `sacode-portable.exe` | 产出 **PASS** | 07:26，84,256,059 B |
| `SaCode Setup 0.1.0.exe` | **FAIL** | `makensis` 自身成功（`Processed 1 file…Total size: 153273`），随后 electron-builder `executing file=…\SaCode Setup 0.1.0.exe args= env={"__COMPAT_LAYER":"RunAsInvoker"}` → `ERR_ELECTRON_BUILDER_CANNOT_EXECUTE`，`Exit code: null`，Output 空；07:26 与 07:29 两次复跑同点同错（第二次带 `DEBUG=electron-builder`，`nsis_rc=1`） |

**先做安全核查再谈修法**：这一步的语义是「electron-builder 以空参数直接运行刚生成的安装器」，若真被执行就可能静默装到用户机上。三处实查——`%LOCALAPPDATA%\Programs\` 下无 SaCode/sacode 目录（该目录只有 `Common/`、`Workbuddy/`，mtime 分别是 08-18 与 05-11）、HKCU `Uninstall\*` 里 `DisplayName -match 'SaCode'` 零命中、`tasklist` 里 `sacode|SaCode` 零命中 ⇒ **你已安装的应用没有被触碰**，失败是 spawn 被拒而不是装完了再退。
**副损伤如实记**：上一轮那个 84 MB 安装包**已被本轮 153 KB 残件覆盖**（同一路径，mtime 07:26；只有 `…exe.blockmap` 还停在 05:24）。也就是说这条线现在没有可用的 NSIS 产物，恢复只能靠重打成功，不能拿旧 blockmap 反推旧包体还在。

打包态冒烟（同 TMP 落点、`--no-sandbox`）：

- `win-unpacked/SaCode.exe --ui-smoke`：**rc=1，252 条 `UI OK`、0 条 `UI FAIL`**。中断点是 `Error: Cannot find module …\win-unpacked\scripts\sse-contract-server.cjs`（`MODULE_NOT_FOUND`）——该夹具真实住在**仓库根** `scripts/sse-contract-server.cjs`，被 `apps/desktop/test/*.test.mjs` 以 `REPO` 相对路径引用；而 `build.files` 那 20 项里没有它，`after-pack.cjs` 也不搬。⇒ 归 **随包清单缺件**（开发态 296 全绿、打包态跑不完），不是产品功能红；**不接受「252 也算过」这种缩范围读法**。
- `sacode-portable.exe --ui-smoke`：两次运行 stdout 均 **0 行**、rc=1（第二次加 `ELECTRON_ENABLE_LOGGING=1` 仍 0 行）⇒ 本机取证通道收不到 portable 自解压后子进程的输出，判 **BLOCKED**（不等同于「跑不起来」，也不等同于「跑过了」）。

哈希对账：`sha256` 前缀 `d2ef66eb8c3edc9a53ef` 在 `dist/host/bin/sacode-host.exe` 与 `win-unpacked/resources/host/bin/sacode-host.exe` 两处**逐字节一致**（第二腿成立）；第三腿（NSIS 载荷内的宿主）本轮取不到——安装包没产出，且仓内无 `7za` 可用（`node_modules/7zip-bin` 路径不存在）。⇒ **三方对账本轮不成立**，只交两方。

签名状态逐个实测：`Get-AuthenticodeSignature` 对 `win-unpacked/SaCode.exe`、`sacode-portable.exe`、`SaCode Setup 0.1.0.exe`、包内 `sacode-host.exe` **四个对象全部 `NotSigned`**——这是 `build.win.signExecutable=false` 的主动选择，「安装包已产出」与「已签名可分发」仍是两句话。

**批次 E 判决**：`win-unpacked` 产出 PASS 但打包态断言覆盖 **FAIL（252/296，缺夹具）**；`portable` 产出 PASS、打包态冒烟 **BLOCKED（stdout 零通道）**；`NSIS` **FAIL（CANNOT_EXECUTE，且覆盖掉了上一轮产物）**；签名如实 **NotSigned**；NSIS 真机安装/卸载仍 **BLOCKED（未获授权）**。三条解锁动作：① 把打包态 ui-smoke 依赖的夹具纳入随包清单，或让该用例在打包态走已随包的等价路径（属桌面线，需改 `build.files`/`after-pack`，而 `package.json` 此刻是别人未落库的 `M` 文件，我不代改）；② 查清本机为何拒 spawn 新生成的安装器（与 §13/§14 里那条按路径按可执行文件生效的策略同族嫌疑，未定位）；③ 换用能收到 portable 子进程输出的取证方式重跑那一腿。







