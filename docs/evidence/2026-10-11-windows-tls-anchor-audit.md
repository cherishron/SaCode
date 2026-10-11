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

## 19. §18 那条「拒 spawn」归因是错的：NSIS 桩能被 spawn，真因是非 MSYS 进程写不了 `AppData\Local\Temp`；换 TMP 落点后 NSIS 产出转 PASS（2026-10-11 07:44–07:55 实测）

**先更正自己的旧结论**：§18 第 458 行写的「失败是 spawn 被拒而不是装完了再退」以及解锁动作②「查清本机为何拒 spawn 新生成的安装器」**已被本轮实测推翻**。桩能被正常创建进程并执行，只是它自己不退出。

**链条读通了（三处都是 `node_modules` 里的实现，不是推断）**：
1. `app-builder-lib/out/targets/nsis/NsisTarget.js` 的 `computeUninstallerData` 走**两遍编译**：第一遍带 `BUILD_UNINSTALLER` 宏把 `installerPath` 编成一个「只吐卸载器就退出」的桩——这就是 §18 里那个 153,273 B 的 `SaCode Setup 0.1.0.exe`，**它从来不是被覆盖的旧包，而是第一遍的半成品**；`Processed 1 file…Total size: 153273 / 184838 bytes (82.9%)` 是 makensis 对桩自己的体积读数。
2. 第二遍在 `NsisTarget.js:374`：`wineVm.exec(installerPath, [], { env: { __COMPAT_LAYER: "RunAsInvoker" } })`，用桩生成 `…__uninstaller.exe`。
3. `app-builder-lib/out/vm/WineVm.js` 的 `execWine` 在 `process.platform === "win32"` 时直接 `exec(target, appArgs, options)`，且**写死 `options.timeout = 120 * 1000`**。所以 §18 那个 `Exit code: null` + `Output:` 空的读数是「子进程弹窗挂住、120 秒被超时杀掉」的正常表现——**我把超时误读成了拒绝**。第三遍（真安装器 + block map）在此之前根本不会执行。

**弹窗正文才是真因**：用 UIA 读那顆桩的错误框（`get_window_state`，标题 `NSIS Error`），正文是 `Error writing temporary file. Make sure your temp folder is valid.`——与本机早已存在的「非 MSYS 进程写不了 `C:\Users\jingg\AppData\Local\Temp`」同族（前两个独立佐证是宿主与 Electron，NSIS 桩是第三个）。

**同形状 A/B（同一 spawn 形态、只差 TMP 值）**：

| TMP/TEMP 落点 | 结果 |
| --- | --- |
| `/tmp`（Git Bash 默认注入） | 弹窗 `NSIS Error`，进程挂住，无卸载器 |
| `C:\Users\jingg\AppData\Local\Temp`（Windows 形式，bash 内联与 `cmd.exe` 原生环境块各试一次） | **同样**弹窗、同样挂住、无卸载器 ⇒ 「MSYS 注入了 POSIX 路径」这个假设被证伪，注入方不相关 |
| `D:\…\apps\desktop\.tmp-test\nsis-tmp` | 桩 **8 秒内自行退出并产出 `SaCode Setup 0.1.0.__uninstaller.exe` 133,785 B** ⇒ 落点是唯一变量 |

**排除项实测**：`statfsSync` 读数 `C:/ freeMB=180020 totalMB=524184`、`D:/ freeMB=243340` ⇒ 不是磁盘满；node 在 `C:/Users/jingg/AppData/Local/Temp/` 下 `mkdirSync` **成功**（`MKDIR-IN-WINDOWS-TEMP=OK`）⇒ 不是笼统的目录写权限，NSIS 在该目录的失败机制未进一步定位，如实记为「未定位，但落点可绕」。

**跑桩之前的安全核查**：`node_modules/app-builder-lib/templates/nsis/installer.nsi` 在 `!ifdef BUILD_UNINSTALLER` 分支里 `.onInit` 只有 `WriteUninstaller "${UNINSTALLER_OUT_FILE}"` + `quitSuccess`（第 63-65 行），并配 `SilentInstall silent` 与 `RequestExecutionLevel user`，且 `!ifndef BUILD_UNINSTALLER` 才 `include installUtil.nsh` ⇒ **桩不可能走到安装 Section**，跑它不构成「安装应用」。三次弹窗期间实查 `%LOCALAPPDATA%\Programs\` 无 SaCode/sacode 目录；我启动的桩进程全部清理（`taskkill` 或超时自灭），最后一测 `tasklist` 计数 **0**。

**换落点后的 NSIS 判决（转绿）**：`cmd.exe` 批处理里 `set TMP/TEMP=D:\…\.tmp-test\nsis-tmp` 后 `npx electron-builder --win nsis --config.electronDist=node_modules/electron/dist`，外层 **`rc=0`**，日志依次出现 `building target=nsis` → `file signing skipped … SaCode Setup 0.1.0.__uninstaller.exe` → `file signing skipped … SaCode Setup 0.1.0.exe` → `building block map`，产物 **`SaCode Setup 0.1.0.exe` 93,860,235 B @07:54**、blockmap 99,338 B @07:55（与 §18 那次的 153,273 B 残件同路径，本轮是真包）。**未设任何镜像**，electron 平台二进制仍走本地官方 dist。附带一条自身缺陷披露：第一版批处理直接写 `npx …` 未加 `call`，cmd 调用 `.cmd` 后不返回，导致批内 `echo BUILDER-RC=` 永远不打印——退出码只能从外层取，已在后续脚本改用 `call`。

**打包态夹具那条腿的合规解法（零产品改动）**：`test-support/ui-smoke.cjs` 里 `SACODE_SSE_FIXTURE` 覆盖口**在 HEAD 就有**（`git show HEAD` 第 926-927 行），其注释原话是「打包态从 asar 里往上爬找不到仓库 `scripts/`，由驱动用 `SACODE_SSE_FIXTURE` 指到真实那份，这一组断言在安装包里才是实跑而不是跳过」；`test-support/golden-path-smoke.cjs:10` 同一约定。所以 §18 解锁动作①里我写的「需改 `build.files`/`after-pack`」也是**不必要的**：正确做法是驱动侧设该环境变量指向仓库根 `scripts/sse-contract-server.cjs`（13,089 B @10-06 09:11，存在性已实测），**不把测试夹具塞进发布包**。开发态与打包态的历史读数分别是 `.tmp-test/b-smoke.log` 296 条 `UI OK`/0 条 `UI FAIL`、`.tmp-test/e-packed-smoke.log` 252/0。

**本批判据**：§18 的「NSIS 拒 spawn」**FAIL（归因错误，本轮更正）**；NSIS 产物 **PASS（rc=0，93,860,235 B @07:54，两遍编译走通）**；「非 MSYS 进程写不了 `AppData\Local\Temp`」这条本机约束 **PASS（第三个独立佐证，机制未定位）**；打包态夹具修法 **PASS（HEAD 既有覆盖口，零产品改动，已写入驱动脚本）**；win-unpacked 与 portable 两条 296 项腿的读数和签名复核见 §20（本轮尚未结算，不在此处冒充）。

## 20. 批次 E 复验结算：三产物齐、双入口打包态各 296 项、宿主哈希三条腿均实测一致（2026-10-11 07:53–08:03 实测）

前置是 §19 的两条修法同时生效：**TMP/TEMP 落点换到 `.tmp-test/nsis-tmp`**，驱动侧设 `SACODE_SSE_FIXTURE=D:\Project\sa\saai\sa-code\scripts\sse-contract-server.cjs`（13,089 B，存在性实测 YES）。构建命令 `npx electron-builder --win <target> --config.electronDist=node_modules/electron/dist`，**未设任何镜像**。

| 产物 | 结果 | 实测读数 |
| --- | --- | --- |
| `win-unpacked/` | 产出 **PASS** | `resources/app.asar` 6,794,111 B @23:56:25；`app.js`/`msgfold.js`/`main.cjs`/`preload.cjs` 在包内 |
| `sacode-portable.exe` | 产出 **PASS** | `STEP0-rc=0`，84,256,050 B @07:58 |
| `SaCode Setup 0.1.0.exe` | 产出 **PASS** | §19：外层 `rc=0`，93,860,235 B @07:54，blockmap 99,338 B @07:55 |

**双入口打包态各 296 项**（分母与开发态 `.tmp-test/b-smoke.log` 的 296 同一条，不缩范围）：

- `win-unpacked/SaCode.exe --ui-smoke --no-sandbox`：**rc=0**、stdout `252→296` 补齐后 **296 条 `UI OK` / 0 条 `UI FAIL`**（386 行日志），另落文件报告 `.tmp-test/nsis-tmp/sacode-smoke-11916-1791676704447/ui-smoke-report.json` @23:58:53 `passed=true failed=0 checks=296 packaged=true`。
- `sacode-portable.exe --ui-smoke --no-sandbox`：**rc=0**，stdout **0 行**——这条不是新缺陷，`ui-smoke.cjs:1182` 的注释就写着「便携启动器不保证继承 stdout；显式 `--session-dir` 保留完整断言报告供验收」，所以按**文件报告体**结算：`sacode-smoke-22572-1791676746510` @23:59:35 `passed=true failed=0 checks=296 packaged=true`。§18 那句「portable BLOCKED（stdout 零通道）」由此改为 **PASS（取证通道换成报告体，同一批断言同一分母）**。
- 第三轮 `sacode-portable.exe --ui-smoke`（专门为了抓运行期解包哈希而重跑）：**`PORTABLE3-rc=0`**，报告 `sacode-smoke-22904-1791676888997` @00:01:58 同样 `checks=296 failed=0 packaged=true`。

**宿主载荷哈希：本轮三条腿全部是实测值**，前缀均为 `d2ef66eb8c3edc9a53ef`、体积 11,158,528 B @07:18：① 源 `dist/host/bin/sacode-host.exe`；② `win-unpacked/resources/host/bin/sacode-host.exe`；③ **portable 运行期解包出来的那颗** `.tmp-test/nsis-tmp/3KWcKjJnWpxidpy6lyc5MMoi0cx/resources/host/bin/sacode-host.exe`（在进程存活窗口内用有界轮询抓到并当场哈希；portable 退出即自清该目录，上一轮就是因此取不到）。**第四腿仍 BLOCKED**：NSIS 安装器内部的宿主需要**授权实跑安装**才能测；中间归档 `@stand-alonesacode-desktop-0.1.0-x64.nsis.7z` 在构建成功后被工具链自己删掉（07:29 那次失败的还在、08:00 已无），仓内也没有 7z 抽取器（`node_modules/7zip-bin` 不存在，MSYS `tar` 是 GNU tar 不认 7z）⇒ 不拿「同源必然同哈希」的推断冒充实测。**为什么不自动作到 scratch 目录**：`p0-status-2026-10-02.md` 第 1520 行确有 `SaCode Setup 0.1.0.exe /S /D=dualtest/nsis-install` 的历史先例，但本轮 `package.json` 的 NSIS 配置是 `oneClick=true`，静默装会向 HKCU `Uninstall\` 写注册项与 Start Menu 快捷方式——不是纯目录级、可无痕撤销的动作，而目标文本把「真机安装/卸载」明写在需授权前提下，所以停在这里。你若要补这第四腿，一句话即可，我会用 `--session-dir` 同款落点装到 `.tmp-test/nsis-install/`、测完跑它自己的 `/S /Uninstall` 再核注册项与进程零残留。

**签名状态如实记录**：`Get-AuthenticodeSignature` 逐个实测 `win-unpacked/SaCode.exe`、`sacode-portable.exe`、`SaCode Setup 0.1.0.exe`、包内 `sacode-host.exe` —— **四个全部 `NotSigned`**。这是 `build.win.signExecutable=false` 的主动选择，「安装包已产出」不等于「已签名可分发」。

**渲染层新鲜度取的是最硬的一条**：`asar.extractFile(app.asar,'renderer/app.js')` 与当前源码 **逐字节相同**（各 76,839 B，`identical=true`），且 asar mtime 23:56:25 晚于源文件 mtime 17:19:21。asar 清单（路径按反斜杠返回，需归一化后统计，第一版探针因没归一化把 `renderer=0` 报了个假数）：**196 条目 / renderer 124 个文件 / `renderer/vendor/` 20 个 / `test-support/` 49 个 / `*-ipc.cjs` 7 个（`customs,execution,lsp,models,plugins,team,worktree`）/ 仓库根 `scripts/` 为 0** —— 最后一条正面印证了 §19 的判断：夹具确实没随包，只能由驱动注入。

**afterPack 卫生只到单侧证据**：`package.json:27` 挂着 `"afterPack": "./after-pack.cjs"`，该脚本删 `debug.log` 与 `resources/default_app.asar`；产物里 `resources/` 只有 `app.asar`、`elevate.exe`、`host/`，而官方源 dist 里 `default_app.asar` 存在（108,953 B @2019-06-18）⇒ 脏文件确实没留下。但**未能把它和 builder 自身可能的排除行为分离**，归因保守记为「卫生结果符合预期，执行主体未唯一确定」。

**来源披露（这条决定这批读数的适用范围）**：`appDir=./` —— 本轮三产物直接打在**在飞工作区**上，不是 `.tmp-test/renderer-current-*` 那份冻结副本。所以包内已含他人未落库的改动（上面那 7 个 `*-ipc.cjs` 与未入库的 `after-pack.cjs` 都在生效）。这是「**最新 renderer 已进包**」的证据，**不是**「提交态可复现」的证据；后者要另起 `--detach` worktree 再打一轮。

**进程与副作用**：`tasklist` 里 `sacode|SaCode Setup` 计数 **0**，两轮冒烟与三次桩实验自己起的进程都已收；NSIS 只构建未执行，未安装任何东西。

**本批判据**：三产物产出 **PASS**（rc 与体积、mtime 如上，全部本轮新建）；双入口打包态 296 项 **PASS**（win-unpacked rc=0 且 stdout 296/0，portable rc=0 且报告体 checks=296 failed=0，第三轮复现同样 296）；宿主哈希 **PASS（三条腿实测一致）**，第四腿（NSIS 内部）**BLOCKED**，解锁动作＝你授权我实跑一次安装并随后卸载；签名如实 **NotSigned**（四对象）；NSIS 真机安装/卸载 **BLOCKED（未获授权）**，你已安装的应用未被触碰。

## 21. 批次 D 全量回归本轮读数：npm test 671/663/0/0/8、dev ui-smoke 296/0，以及一条必须先加 `--no-sandbox` 的环境读数（2026-10-11 08:05–08:12 实测，layout 腿仍在跑）

三条腿都按 D 的口径跑**本轮**读数，不引用上一轮的绿灯。`TMP/TEMP` 全部指 `.tmp-test\nsis-tmp`（§19 那条约束同样适用于宿主与 Electron，不指过去就是成片的假红）。

| 腿 | 结果 | 实测 |
| --- | --- | --- |
| `npm test` | **PASS** | `.tmp-test/d.cmd` 外层 **`NPMTEST-rc=0`**；TAP 汇总 `# tests 671`、`# suites 1`、`# pass 663`、**`# fail 0`**、**`# cancelled 0`**、`# skipped 8`、`# todo 0`，`duration_ms 47755` |
| `npm run ui-smoke`（原样，不带额外参数） | **FAIL（环境）** | **`UISMOKE-rc=-2147483645`** = `0x80000003` STATUS_BREAKPOINT，日志 23 行只到 npm banner、**0 条 `UI OK`**——本机 Electron 默认沙箱在非交互会话里起不来那条老限制，不是产品红 |
| `npm run ui-smoke -- --no-sandbox` | **PASS** | `.tmp-test/d-uismoke2.log`：**296 条 `UI OK` / 0 条 `UI FAIL`**，末行 `UI_SMOKE PASS` |
| `npm run layout-smoke -- --no-sandbox` | **在跑，不判** | 截至本节撰写 `LAYOUT PASS=6 / LAYOUT FAIL=0`，速率约 6 行/分钟，192 行需 30 分钟量级；**读数未结算前不写结论**，结算后补进本节 |

**8 条 skip 逐条点名（不糊过去）**：`grep " # SKIP"` 恰好 8 行，其中 **6 条是真实模型凭据门槛**——`ok 215 真实StepFun：自定义模型请求完成且进入待核算账本`、`ok 399 真实提供商往返`、`ok 400 真模型增强`、`ok 401 真实 StepFun 调用 read`、`ok 402 真实 StepFun 回合收到系统提示`、`ok 403 真实 StepFun 调用 todo_write`，理由原文都是「缺少 STEPFUN_API_KEY 或 target/step.key」；另 2 条是 `ok 219 / ok 220 实际 Host：…`，门槛是 `test/host-startup-recovery.test.mjs:38` 的 `{ skip: !host }`（没给 `SACODE_HOST`）。**门槛是「凭据/宿主未注入」而不是「断言被删」**：`test-support/fixture-env.mjs` 里 `STEPFUN_API_KEY` 被显式清空，注释写明「不能让测试默认读取真实注册表或环境凭据」，所以默认跑必 skip。

**因此 fail=0/cancelled=0 不等于这 8 条已验**：批次 A 的真实模型链路另有独立证据（§13.2 走界面全路径：模型中心添加供应商→选 `step-3.7-flash`→发送→出真答复，环境里显式 delete 掉 `SSL_CERT_FILE`），但**单元层这 8 条本轮仍是 skip**，判据按 skip 记，不拿 A3 的界面证据顶替它们。凭据可用（`~/.sacode/user/credentials.env` 单变量 `SA_CODE_STEPFUN_API_KEY`，90 B），下一步把它们带真键实跑一遍再回来记账——**键只进环境变量，绝不落盘、绝不打印**（cmd 批处理里 `set KEY=*** 会把键写进文件，所以这条腿必须走 bash 命令替换；宿主侧还要 `SACODE_HOST` 指 `apps/desktop/dist/host/bin/sacode-host.exe`，同目录已有 `ca-bundle.pem` 84,105 B）。

**本轮还顺手抓到一条构建侧变化**：`prelayout-smoke` 的 vendor 链现在跑 5 个脚本（`pack-vendor` / `pack-tinyvue` / `pack-tinyrobot` / `pack-pages` / `pack-next-sdk`），编译 12 个 TS 页面并折叠 `next-sdk.iife.js`（315,588 B）——比本会话早前记录的 vendor 步骤多了后两个，属别人已推进的线，我不动它，只在此登记分母环境变了。

**本批判据**：`npm test` **PASS（671/663，fail=0，cancelled=0，rc=0）**；dev `ui-smoke` **PASS（296/0）**，但**必须先 `--no-sandbox`**，原样 `npm run ui-smoke` 在本机是 `0x80000003` 环境红；`layout-smoke` **在跑（暂不判）**；8 条 skip **如实按未验记**，其中 6 条待带真凭据补跑。

## 22. §21 那 6 条补跑做完了：红的全是夹具缺信任锚，产品侧零改动；带键全套 671/669/0/0/2 rc=0（2026-10-11 08:33–08:38 实测）

**先说结论归因**：批次 A 的真实模型链路**没有新产品缺陷**——本轮那几条红，根因是三条凭据门控用例从未接上「壳层在生产里会注入的那一跳」，属测试夹具缺件。产品侧接线一直是真的：`apps/desktop/paths.cjs` 的 `caBundleSidecar` + `hostEnvWithCaBundle` 由 `main.cjs:53` 调用，把宿主同目录的 `ca-bundle.pem` 经 `SACODE_CA_BUNDLE` 交给宿主；`paths.cjs:20-23` 顶部注释本来就把这条塌陷写下来了（「实测宿主不带锚时那两次请求塌成 http-request-error」）。缺的是三条用例没照着 `real-provider-e2e.test.mjs:17-20` 的既有做法补这一跳。

**单变量对照（同一份独立探针 `.tmp-test/read-probe.mjs`，只差 `SACODE_CA_BUNDLE` 一个变量）**：

| 腿 | 锚 | 端点与模型 | 实测读数 |
| --- | --- | --- | --- |
| 1 | 无 | `/v1` + `step-3.7-flash` | settled=true、interrupted=**true**、finishReason=`error:http-request-error`、textLen=0、日志无 `"name":"read"`、无 `ok-read:` |
| 2 | 有 | `/v1` + `step-3.7-flash` | interrupted=false、finishReason=`stop`、textHasSecret=**true**、`"name":"read"` 与 `ok-read:` **都在**、日志不含键、stopCode=0 且未 force |
| 3 | 有 | `/v1` + `step-5-preview` | 同上全绿（textLen=25），即三条用例原本要跑的模型也能出工具调用 |

会话日志里连 `request/header` 都没有，说明失败发生在 provider 打开阶段而非解析阶段；`core/src/sse.cj:136` 的 `catch` 把异常正文丢掉、只留 `http-request-error`，所以宿主 stderr **零字节**也如实一致——这条不是「静默挂起」，是传输层抛错后按契约塌成固定形态（`core/src/transport_failure.cj:8`）。

**端点侧另测了一组三对（只读 HTTP 状态，键不落盘不打印）**：`/v1` + `step-5-preview` → **200**；`/step_plan/v1` + `step-3.7-flash` → **403**；`/v1` + `step-3.7-flash` → **200**。可见 403 卡在 **path** 不在模型——账号侧对 `step_plan` 这条路要实名。所以三条用例**只把 baseUrl 从 `step_plan/v1` 换成 `/v1`，模型保持 `step-5-preview`**（比 §21 里 e2e 那条「顺手换成 step-3.7-flash」更接近原意图，不缩断言）。

**改了什么**：新增 `apps/desktop/test-support/real-host-env.mjs`（`realHostEnv(directory, host)`：自有配置目录 + 撤掉 `SACODE_PROVIDER_*` 覆盖 + **复用 `paths.cjs` 的 `caBundleSidecar`/`hostEnvWithCaBundle`**，锚不在就不设变量，让核心如实失败，绝不降级校验）；`test/real-provider-read-tool.test.mjs`、`real-provider-system-prompt.test.mjs`、`real-provider-tools.test.mjs` 各改三处（引入 helper、baseUrl、注释）。**产品源码一行未动**（`git diff --stat` 只有这三个 test 文件 25 增 12 删 + 一个新 helper）。

**本轮踩到并登记的三条本机陷阱**：
1. cmd 包装脚本里 `for /f ... set %%a=%%b` 会**顺带把带前缀的 `SA_CODE_STEPFUN_API_KEY` 也注入环境**，而宿主视 env 携带的凭据为只读——`core/src/credential.cj:154-158` 的 `set()` 遇 `envLookup(ref)` 非空即抛 `credential-read-only`，三条用例因此在 ~100 ms 处齐红（根本没上线）。修法：映射成 `STEPFUN_API_KEY` 后把带前缀那个 `set X=` 撤掉。**这条红是我自己包装脚本造的，不是产品回归。**
2. 同一个 `.cmd` 里写中文注释会**把 cmd 的代码页解析打断**（脚本后半段没执行，`ENV-TMP` 回显出的是继承来的用户 Temp，日志是上一轮的旧文件而 rc 却报了 0）——包装脚本一律 ASCII。
3. Git Bash `export TMP` 对 Node 的 `os.tmpdir()` **不生效**（`process.env.TMP` 看得见，`tmpdir()` 仍返回用户 Temp），而 cmd 里 `set TMP=` **生效**——宿主在非 MSYS 进程下写不了用户 Temp（§19 第三条独立证据），所以跑这套用例的取证腿必须走 cmd 包装并把 TMP 指到 `.tmp-test/nsis-tmp`。

**读数**：三条用例单独跑 **PASS（tests 3 / pass 3 / fail 0 / cancelled 0，rc=0）**，逐条 `ok`，duration 4,278 ms / 1,795 ms / 3,400 ms（真往返）。带凭据全套 **PASS（tests 671 / pass 669 / fail 0 / cancelled 0 / skipped 2，rc=0）**；与 §21 无凭据基线对得上：663 + 6 = 669、8 − 6 = 2。6 条真实模型用例逐条点名绿：`真实 StepFun：自定义模型请求完成且进入待核算账本`（ok 215）、`真实提供商往返：配置面登记的模型能出真答复`（ok 399）、`真模型增强`（ok 400）、`真实 StepFun 调用 read 读盘上文件并把正文带进续答`（ok 401）、`真实 StepFun 回合收到系统提示，并能从冷进程日志重建`（ok 402）、`真实 StepFun 调用 todo_write 后续答，冷宿主从日志恢复工具结果`（ok 403）。余下 2 条 skip 是 `host-startup-recovery.test.mjs` 里既有的 `{ skip: !host }` 两条（`实际 Host：首次启动读取默认通用设置…`、`实际 Host：设置文件读取失败返回协议错误…`），与凭据无关，本轮不判。收尾 `tasklist` 实查 `sacode-host.exe` **零残留**。`layout-smoke` **192 PASS / 0 FAIL**——读数是 08:18 那轮（改动前），本批改动画像与产品零接触（只动 test 与一个 test-support helper），不构成该腿的重跑义务，如实标注为「改动前读数」。

**批次 D 判据更新**：npm test 无凭据 **PASS 671/663/0/0/8 rc=0**（§21）与带凭据 **PASS 671/669/0/0/2 rc=0**（本节）两条都成立；ui-smoke **PASS 296/0**；layout **PASS 192/0**；宿主零残留。**仍 BLOCKED 未变**：`core cjpm test` 提交级计数（等别人把 7 个实现文件与签名迁移后的测试落库）、NSIS 真机安装/卸载与第四条哈希腿（未获授权）。

## 24. 批次 A 的 A1 定性收口：机制被替换但锚集合已实测等价（raw=94 / distinct=53 / 随包 53），另把「不带 SSL_CERT_FILE」做成结构保证（2026-10-11 08:52–08:54 实测）

A1 原文要求「CFFI 绑 crypt32 导出系统信任根 → 注入 `CustomCA`」。本轮把这条的**实际达成度**测清楚，不含糊过去：

**机制：未按原文实现，且本机不可实现。** `core/src/tls_roots.cj:18-25` 记录的三条路实测结论仍然成立——crypt32 各入口在仓颉进程里恒返回 NULL（`CertOpenSystemStoreA("ROOT")`、`CertOpenSystemStoreW`、`CertOpenStore(SYSTEM_W, LOCAL_MACHINE 0x20000)` 与 `CURRENT_USER|INCLUDE_LOCAL_ROOT 0x10000` 全 NULL 且 lastErr=0），同进程里 `CertOpenStore(MEMORY)`、`CryptStringToBinaryA`、`CryptAcquireContextA` 都正常，同机 .NET 用同一个 `CertOpenStore` 能枚举——本轮又**现场复核了这个正对照**：`X509Store('Root','LocalMachine')` 此刻回 **53** 张。所以缺的不是证书、不是权限，是仓颉进程内那条 FFI 通道，原因未证。

**内容：实测等价，不是缩了范围。** 这是本轮新增的硬读数。`scripts/gen-ca-bundle.mjs:21` 导出的是 **两张存储**（`Root` + `AuthRoot`）并按 DER 精确去重。现场量：`raw=94`、`distinct=53`（`.tmp-test/store-count.ps1`，PowerShell 逐条 `ToBase64String(RawData)` 后 `Sort-Object -Unique`）——本机 `AuthRoot` 的 41 张与 `Root` **逐字节重复**。随包的 `apps/desktop/dist/host/bin/ca-bundle.pem` 实测 **53 个 PEM 块 / 84,105 B**，与 distinct 数**完全相等**，即覆盖两张存储里全部不同的系统根，一张没漏。
**可复现性**：现场重跑 `node scripts/gen-ca-bundle.mjs apps/desktop/.tmp-test/ca-fresh.pem`（rc=0，打印「53 张」），产物与随包文件 **逐字节相同**（sha256 前缀同为 `8a7b03701e0461d8`）——随包锚不是历史遗留物，当前脚本 + 当前系统就能重造。

**判决**：A1 的**保证**（校验开着、锚来自 Windows 系统信任根、走 `verifyMode = CustomCA`、绝不 TrustAll）达成且可复现；A1 的**机制**（进程内 crypt32 枚举）本机不可用，已如实替换为「打包机上导出、随宿主同目录分发、核心只认 `SACODE_CA_BUNDLE`」。把一条自己解释不通、且在本机恒 NULL 的入口做进产品去替换一条已验证的通道，才是这里真正的风险。

**同轮把 A3 那句「不带 SSL_CERT_FILE」从巧合做成保证**（commit `82fab46`）：核心取锚顺序是 `SACODE_CA_BUNDLE` → `SSL_CERT_FILE` → 用户目录，此前只是本机碰巧没设后者。夹具统一入口 `test-support/real-host-env.mjs` 现在显式 `delete env.SSL_CERT_FILE`。读数两条：零网络探针 `.tmp-test/helper-probe.mjs` 核 8 条环境整形规则 **8/8 PASS**（含「调用方显式给的锚不被覆盖」「随包锚缺失时干脆不设变量」），rc=0；带**诱饵** `SSL_CERT_FILE=D:\decoy\other-root.pem`（不存在的文件）重跑 read 闭环用例 **ok 1，tests 1 / pass 1 / fail 0 / cancelled 0**，rc=0，宿主零残留。

## 23. 批次 B 的 CLI 腿补第四条对账：npm 平台包内 exe 与本轮新构建逐字节一致；另登记 AGENTS.md 一处过期路径（2026-10-11 08:47–08:48 实测）

§20 的哈希对账只覆盖了宿主那条链。本轮把 CLI 入口也实测一遍：

| 对象 | 体积 | mtime | sha256 前 24 位 |
| --- | --- | --- | --- |
| `npm/sacode-cli-win32-x64/bin/sacode.exe` | 10,978,304 B | 10-11 07:20 | `83b9018f2644ae60a14abd84` |
| `apps/cli/target/release/bin/main.exe`（本轮 `cjpm build` 产物） | 10,978,304 B | 10-11 07:20 | `83b9018f2644ae60a14abd84` |

两枚**体积与哈希全等**，且 mtime 就是 §17 那轮重建的时刻——npm 平台包里装的确系本轮新构建，不是上一轮冻结二进制。这一条是 §17「剥掉仓颉 PATH 逐子命令自测」的前置：跑的是包内那颗，而那颗与源码构建产物是同一颗。

**顺带核到的一条安全项**：包目录已从 `npm/dsh-cli*` 改名成 `npm/sacode-cli*`（`package.json` 实读 `@stand-alone/sacode`，bin 为 `sacode` + `sacode-daemon`；平台包 `@stand-alone/sacode-win32-x64` 自身无 bin）。会否因此把 35 MB 二进制变成可提交项？实测 `git check-ignore -v npm/sacode-cli-win32-x64/bin/sacode.exe` 命中 `.gitignore:116 npm/sacode-cli-*/bin/`，第 117 行还管着 `extjs/` ⇒ **忽略规则已随改名更新，无入库风险**；`git status -- npm/` 输出为空。

**登记一处过期文档，但不代改**：`AGENTS.md`（git 跟踪的是这个名字；`agents.md` 只是同一文件在大小写不敏感文件系统里的别名）第 16 行与第 51 行仍写 `npm/dsh-cli` / `npm/dsh-cli-win32-x64` / `npm/dsh-cli-*/bin/`，与磁盘上的实际目录和 `.gitignore` 现行的模式都不一致。这是会误导下一个 agent 的过期路径（按它去 `git add npm/dsh-cli/bin/cli.js` 会直接找不到文件）。AGENTS.md 属项目指令文件、改动需要你点头，本轮我只把「哪两行过期、正确值是什么、忽略规则其实已对」测清楚记在这里，不动它。

## 25. §22 的接线做成统一门禁：六条真实模型用例 + 两条 `!host` 用例一次跑绿，11/11/0/0/0 rc=0，全套 671/669/0/0/2 rc=0（2026-10-11 08:57–09:00 实测，commit `d674f68`）

§22 只给三条凭据用例补了锚。本轮把**六条**真实模型用例（`real-provider-e2e` / `real-provider-read-tool` / `real-provider-system-prompt` / `real-provider-tools` / `real-provider-enhance` / `host-routing-real`）的环境整形收敛到 `apps/desktop/test-support/real-host-env.mjs` 一处，逐文件删掉各自复制的 `if (!process.env.SACODE_CA_BUNDLE) {…}` 块——同一个「复用生产接线（`paths.cjs` 的 `caBundleSidecar` + `hostEnvWithCaBundle`）+ 撤掉 `SSL_CERT_FILE`」的保证从此覆盖整条真实链，而不是覆盖其中三条。

**迁移中发现并修掉一个自己造的顺序缺陷**：helper 最初写成 `{ ...整形后的 env, ...删 provider, ...extra }` 之外的顺序（`...extra` 早于 provider 删除被套用），那会让 `real-provider-enhance` 故意传的兜底诱饵（`SACODE_PROVIDER_BASE_URL=http://127.0.0.1:1` + 一个「不能误用的兜底模型」+ 空 `STEPFUN_API_KEY`）被整形步骤抹掉，用例就会去打真网络。改法是让 `...extra` 最后套用，并用两条新探针用例把顺序钉住。

**读数**（全部为本轮实测）：
- 零网络整形探针 `.tmp-test/helper-probe.mjs`：**HELPER 12/12 PASS**，先落盘再取 rc，**real-rc=0**（日志 `.tmp-test/probe-25.log`）。其中包含 `extra_cannot_be_clobbered`、`extra_provider_decoy_survives`、`extra_settings_override`、`anchor_still_set_with_extra`、`inherited_provider_still_dropped` 五条顺序与共存断言。
- 七个文件一起 `node --test`（带 `STEPFUN_API_KEY` + `SACODE_HOST`）：**# tests 11 / # pass 11 / # fail 0 / # cancelled 0 / # skipped 0**，包装脚本 `CREDSIX-rc=0`。比 §22 的 3 条多出 8 条，是因为这次把原先被 `!host` 挡掉的 `host-startup-recovery` 两条也放进了同一腿；收尾 `tasklist` 实查 `sacode-host.exe` **零残留**。
- 带凭据全套 `npm test`：**# tests 671 / # pass 669 / # fail 0 / # cancelled 0 / # skipped 2**，`CREDALL-rc=0`——与 §22 基线逐位相同，说明这次纯接线的迁移没碰坏任何一条既有断言。**这 2 条 skip 就是上面放行的那两条**：全仓 `test/` 目录里只有 2 处 skip 门控（`host-startup-recovery.test.mjs` 的两条 `{ skip: !host }`，ripgrep 全目录仅此二命中），而 `npm test` 这一腿的包装脚本 `.tmp-test/cred-all.cmd` 压根没设 `SACODE_HOST`（实读第 2–11 行），所以它们照旧被挡。也就是说 skipped 2 不是「未知门控」，而是**消得掉的**：补一条设了 `SACODE_HOST` 的全套腿就该是 skipped 0（已在 §26 之后准备 `.tmp-test/cred-all-host.cmd` 专跑这一腿）。
- 改动面：`git show --stat d674f68` = 4 files、16 插 / 22 删，全部在 `apps/desktop/test*`；产品源码一行未动。

**登记两条 rc 读数陷阱**（都是本轮自己踩的）：① 后台任务通知里的「exit code 0」是我包装命令（末尾 `echo "CJPM-rc=$?"`）自己的退出码，被包装的原命令真实读数只看日志末行；② `node x.mjs | tail -6` 之后取 `$?` 拿到的是 `tail` 的 0，不是 node 的——本轮复跑探针时先这样拿过一次假 0，改成「先重定向落盘、再 `echo real-rc=$?`」才拿到真值。

## 26. 「core cjpm test 计数与 rc」第一次拿到可复现的**逐条**归因：工作区态卡在 `cmds_test.cj`，提交态卡在 `cmds.cj` 的 cjc 1.1.3 语法与三处悬空引用（2026-10-11 08:55–09:10 实测）

这条验收项此前只能写 BLOCKED。本轮把两个态各跑一遍并把错误逐条落名，BLOCKED 的前提第一次是**具体到符号**的。

**工作区态**（`.tmp-test/ct-worktree.log`，197,120 B，末行 `Error: cjpm test failed` + `CJPM-rc=1`）：剥 ANSI 并拆 CR 后 **`Summary: TOTAL` 出现 0 次** ⇒ 三态里的「根本没跑」，按红线不许报任何条数。编译器侧：`49 errors generated, 8 errors printed`、`160 warnings generated` / `64 warnings generated, 35 warnings printed`。打印出来的 8 条定位（把 `error:` 与其后紧跟的 `==>` 配对取，不能按出现顺序硬套）：

| 文件 | 条数 | 错误原文 | 该文件 git 态 |
| --- | --- | --- | --- |
| `core/src/cmds_test.cj` | 5（76/77/86/96/108 行） | `undeclared identifier 'registerBuiltinCommands'` ×3、`mismatched types`、`no matching function for operator '()'` | **M**（未落库 +51 行，别人在飞） |
| `core/src/worktree_setup_test.cj` | 3（160/181/217 行） | `expected 'Struct-String', found 'Struct-Path'` | **与 HEAD 逐字一致**（无人正在改） |

**先更正我自己给过的归因**：`ledger.cj` / `migration_pack.cj` / `custom_model_registry.cj` / `plugin_manifest_test.cj` 这些名字来自 `==>` 全集计数（37 / 25 / 16 / 13），它们是**warning 的定位**，不是 error。上一段口头说的「错误聚在 index.cj、ledger.cj」是错的，以本表为准。另外整份日志里 `tls_roots.cj`、`tls_roots_test.cj`、`sse_test.cj` 各命中 **0** 次（`.tmp-test/err-histogram.mjs` 逐串数过），批次 A 的 A2 文件不在这条阻塞里。

**注册表符号 `registerBuiltinCommands` 全仓还没有实现**：`grep -c` 工作区 `core/src/cmds.cj` = **0**（HEAD 版同样 0）。所以工作区态这一腿在他人把实现写出来之前必然编不过，与我无关也无法代做（那是别人的在飞文件，`cmds_test.cj` 上还有他 51 行未落库改动，我不动）。

**提交态**（新建 detached 副本 `D:/Temp/SaCode-core-cnt-20261011` @ `6b8e4b7`，`.tmp-test/ct-head-6b8e4b7.log`，`CJPM-rc=1`）：`4 errors generated, 4 errors printed`，**四条全在 `core/src/cmds.cj`**， cjnative 1.1.3 直接判语法错：

- `cmds.cj:11:105` `error: expected ',' or ')', found '='` —— 原文 `public init(name: String, help: String, parse: Option<((Array<String>) -> HashMap<String, String>)> = None)`，**默认参数值**这条语法本机编译器不接受。
- `cmds.cj:64:65` `error: expected a type name after ':' in function declaration, found '{'` —— 原文把返回类型写成 `{spec: CommandSpec, args: HashMap<String, String>}`。
- 另两条 `expected operator or end of expression, found ':'` / `unclosed delimiter: '{'` 是上述两处的级联。

同一轮把副本里的 `cmds.cj` 换成工作区那份未落库的版本（只改副本，共享工作区一行未动），错误立刻换成 **20 generated / 8 printed**，其中 6 条落在 `team_board.cj`、1 条落在 `team_workspace.cj`：`WriteLease.protects`、`SessionLog.isDurableFrozen` / `freezeAfterDurableFailure` / `durableCheckpointBatched`、`undeclared type name 'GitQueryResult'`，另加 `web_network.cj:127` 的 `function 'webUrlEncode' has overload conflicts`。**这些成员/类型只存在于他人未落库的 `session.cj` / `lease.cj` / `web_network.cj` 与未入库的 `durable_checkpoint.cj` / `git_workbench.cj` 里**——即已提交的 `team_board.cj` / `team_workspace.cj` 带着悬空引用进了库，所以提交态在**库层**就编不过。这条我不能代修：补它等于替别人把未复核的实现落库。

- 我自己动的一行级修复（commit `6b8e4b7` + `b72d621`，仅 `core/src/worktree_setup_test.cj`，纯增补、未改任何已有行）：给夹具补 `wsTWrite` 的 `Path` 重载，因为该文件已有 6 个调用点直接传 `Path`（5 处还传 `"…".toArray()`，即字节数组）。**这一条自己先红了一次**：`6b8e4b7` 落盘的类型位其实是 `Array[Byte>`（`sed -n '62p' | od -c` 取证：方括号里那个收口是 `>`，而工具回显显示成 `Array[Byte]`），cjc 1.1.3 在 `worktree_setup_test.cj:62:39` 报 `unclosed delimiter: '('`；`b72d621` 改成官方文档形态 `Array<Byte>`（依据 `cangjie-lang-features/string/README.md:410` 的 `func toArray(): Array<Byte>`）。
  **验证状态：仍未取得。** 有一条容易误读的旁证要点破：副本里 `unittest_bin/std.testrunner.exe`（11,297,280 B @09:12:06）**不能**当作「测试目标已编译链接」的证据——`cjpm test` 的库层 `cjc -o libcore.a` 在 09:22 还在跑（`Get-CimInstance` 取到 PID=28748/父=13224 即本会话那条 `cjpm.exe test`），库都没编完不可能已链出测试程序；同尺寸的同名文件在主工作区也有一份（@08:41，那一轮以 1 条编译错误收场）。真正的判据只有剥码后最后一个 `Summary` 块 + `CJPM-rc`，读数落 §27。

**判据更新**：`core cjpm test 计数与 rc` = **BLOCKED**，解锁条件从笼统的「等别人落库」具体化成三条可核对的前置：① `registerBuiltinCommands` 的实现落库（工作区态）；② `cmds.cj` 改掉默认参数值与大括号返回类型两处语法（提交态）；③ `team_board.cj` / `team_workspace.cj` 依赖的 `protects` / `isDurableFrozen` / `freezeAfterDurableFailure` / `durableCheckpointBatched` / `GitQueryResult` 与 `webUrlEncode` 重载冲突随实现一并落库（提交态）。三条都不由我持有，缩范围或改断言都不在该项的允许处置里。

## 27. 第三条腿也拿不到计数：把工作区实现整体借进提交态副本后，红换了一批但仍停在「根本没跑」（`38 errors generated / 8 printed`，Summary 0）（2026-10-11 09:10–09:33 实测）

§26 做了两次单变量实验（纯 HEAD、只借 `cmds.cj`）。这轮把第三条腿做穷：**副本 = HEAD 的测试面（含 `6b8e4b7`+`b72d621` 的夹具重载）+ 工作区全部未落库实现面**——只动 `D:/Temp/SaCode-core-cnt-20261011` 这份副本，逐文件 `cp` 覆盖 169 个非 `*_test.cj` 文件，共享工作区一个字节没改（覆盖后 `git -C 副本 status` 只报本批预期的 M/??）。

**读数**：库层第一次编过（`160 warnings generated`，无 error）；测试面 **`CJPM-rc=1`、`38 errors generated, 8 errors printed`、剥码后 `Summary: TOTAL` 出现 0 次** ⇒ 仍是第三态「根本没跑」，**没有可报的条数**。打印出的 8 条全是同一形状 `expected 'Struct-String', found 'Struct-Path'`：

| 位置 | 原文 |
| --- | --- |
| `worktree_setup_test.cj:288:26`、`worktree_setup_test.cj:313:26` | `let log = SessionLog(Path(repo).join("a.log"))` |
| `worktree_test.cj:191:43`、`214:26`、`245:26`、`267:26`、`285:26`、`304:43` | 同一类把 `Path` 传给期望 `String` 的调用 |

**两条判读**：

1. 我修的 6 个 `wsTWrite(Path…)` 调用点（原先报在 160/181/217）没有再出现在打印集合里，报错形状换到了 `SessionLog(...)` 上。但 `8 printed` 是编译器上限（`cjc --error-count-limit <value|all>` 默认 8，本轮实测 `cjpm test --help` 里**没有**直传该参数的口子，只有 `-V`），所以「消失」本身不构成定论；定论要靠 `-V` 抓到测试面那条 `cjc` 命令行后原样重跑并加 `--error-count-limit all`，把 38 条全列出再与 `worktree_setup_test.cj` 的行号集合做差。这条腿本轮正在跑，读数单独记。
2. 更硬的新事实是：**这条「借实现」的路也拿不到 core 测试计数**。§16 已经见过反方向（已入库测试对不上未落库实现签名，同一批 49 条在工作区态与「HEAD+7 实现文件」态各测到一次）；现在把实现**全量**借过来，红仍然停在测试面，只是换了调用点。合起来：**提交态测试面与工作区实现面之间是双向签名漂移，任何单向借用都补不齐**——所以「core cjpm test 计数与 rc」今天的不可达不是某次构建没跑成，而是两侧必须同时落到同一个 commit 上才可能出 `Summary`。§26 的三条前置因此收紧成这一条更本质的判据。

**顺带做的一次密钥自查**（`.tmp-test/secret-scan.mjs`，脚本只输出布尔与计数，不打印键或其任何前缀）：把 `~/.sacode/user/credentials.env` 里长度 > 20 的值读进内存，对 `.tmp-test/` 下所有 `*.log|*.txt|*.json|*.md|*.clean` 逐个 `includes` 比对。读数：**`secret-vars-loaded=1`、`scanned=325`、`leaked-files=0`，脚本 rc=0**（这条 rc 是先重定向落盘再 `echo real-rc=$?` 取的，不是 `| tail` 之后那个——即 §25 登记的第二条陷阱）。这把「凭据不落盘」这条红线在本批全部取证文件上验了一次，而不只是靠 `session.log` 不含键那一处。

## 28. 批次 D 的最强读数到手：带宿主带真键全套 **671 / 671 / 0 / 0 / 0，rc=0**，两条 `!host` skip 也被消掉（2026-10-11 09:33–09:45 实测）

**相对 §22 的增量只有一处**：给同一个 `.cmd` 包装加 `set SACODE_HOST=...\apps\desktop\dist\host\bin\sacode-host.exe`（本轮 07:18 新构建，11,158,528 B，同目录 `ca-bundle.pem` 84,105 B），把 §21/§22 一直按 skip 记的那 2 条 `{ skip: !host }`（`host-startup-recovery.test.mjs:38` 门控）也真跑起来。产品与测试代码一行未动，`skipped` 因此从 2 变 0，而不是把门槛删掉。

**同一条腿跑了三次，逐条如实记**：

| 腿 | 时间 | 读数 | 判 |
| --- | --- | --- | --- |
| leg1 | 09:34 | `tests 671 / pass 670 / fail 1`，`CREDALLHOST-rc=1`；唯一红是 `not ok 538 成员消息进入真实Provider与独立持久日志…`，消息原文 `timeout: team/member/create`，实测 5,473 ms 撞 `host-bridge.cjs:85` 的默认 `timeoutMs = 5000` | FAIL（时序） |
| leg2 | 09:37 | `tests 671 / suites 1 / pass 671 / fail 0 / cancelled 0 / skipped 0 / todo 0`，`duration_ms 50918`，`grep -c "^not ok"` = 0 | PASS |
| leg3 | 09:45 | 同 leg2 五计数，`duration_ms 57611`，`# SKIP` 计数 **0**，`ok 538` 该用例本轮绿，包装 rc 文件里 `CREDALLHOST-rc=0` | **PASS（本批定稿读数）** |

**leg1 那条红按「待查脆弱点」登记，不当产品缺陷也不当运气**：三条独立证据支撑这个定性——(1) 单独重跑该用例 **3/3 绿、rc=0**；(2) 历史同形：`batchD-rerun.log` 曾以同一条 `timeout:` 消息记 `fail 1`，紧接 `batchD-rerun2.log` 回 `fail 0`；(3) 该用例所在 `apps/desktop/test/team-host.test.mjs` 是**别人正在修改的文件**（`git status` 里 M 态），不是本批改动画像。脆弱点本身仍然真实存在：5 秒单请求预算 vs 真 Provider 往返，谁动了这条链都要知道它有先例。

**我自己的两处取证操作缺陷，写下来防复犯**：

1. **leg1 的日志正文被我的 leg2 覆盖了**。包装脚本原来把日志名硬编码成 `cred-all-host.log`，两条腿写同一个文件——135,664 B 的 leg1 正文只剩会话内读数，盘上留下的 135,342 B 是 leg2 的。已把参数化补进脚本（`cred-all-host-%RUNTAG%.log` + 顶部 `if "%RUNTAG%"=="" set RUNTAG=1`），并**重跑 leg3 重新造出一对**：`.tmp-test/cred-all-host-3.log`（135,404 B，五计数在盘）与 `.tmp-test/cred-all-host-3.rc.txt`（`ENV-TMP` / `ENV-HOST` / `HOST-present=1` / `KEY-present=1` / `CREDALLHOST-rc=0`）。
2. **包装腿的 rc 天生不在 npm 日志里**：`call npm test 1> …log 2>&1` 只重定向 npm，最后那句 `echo CREDALLHOST-rc=` 走 `.cmd` 自己的 stdout。所以「计数」和「rc」必须两份文件才配成对证据，leg3 就是这么配的。

**还有一次「命令根本没跑」的读数**：第一次调 leg3 用 `RUNTAG=3 cmd //c .tmp-test\\cred-all-host.cmd | grep -E "…"`，立刻返回且盘上没有 `cred-all-host-3.log`——cmd 的报错被管道里的 grep 吞了。判据落回「日志文件不存在即未运行」，改绝对路径 + 全量重定向落盘后才真跑成。**这是 §25 那条 rc 陷阱的姊妹形态：空输出不是 rc=0，是压根没跑。**

**收尾实查**：`tasklist | grep -icE "sacode-host\.exe|electron\.exe"` = **0**（leg3 之后与 A3 两轮之后各查一次，都是 0）。

**批次 D 判据（本轮全绿，四腿齐）**：`npm test` 无凭据 **671/663/0/0/8 rc=0**（§21）、带凭据 **671/669/0/0/2 rc=0**（§22）、带凭据且带宿主 **671/671/0/0/0 rc=0**（本节，本批定稿）；dev `ui-smoke` **296 条 UI OK / 0 FAIL**、`layout-smoke` **192 PASS / 0 FAIL**（§22 已如实标注那是产品改动前读数，本批只动 test 与文档，不构成重跑义务）；宿主零残留。**仍 BLOCKED 未变**：`core cjpm test` 计数（§26/§27 双向漂移）、NSIS 真机安装卸载与第四条宿主哈希腿（未获授权）。

## 29. A3 桌面端到端在**本轮新构建**上复跑两轮：四条判据齐绿，第一轮漏了「设置面板可见打开」这一环，登记为驱动抢跑并补跑（2026-10-11 09:39 / 09:44 实测）

被试产物是 §17 那轮从当前源码重建的宿主：`dist/host/bin/sacode-host.exe` 11,158,528 B @07:18、`dist/host/bin/ca-bundle.pem` 84,105 B @07:18（不是 §13.2 那轮的旧宿主）。驱动 `.tmp-test/a3-ui-fullpath.cjs` 环境里 `delete e.SSL_CERT_FILE`，只设 `SACODE_CA_BUNDLE` 指那颗随包锚——**满足 A3 的「不带 SSL_CERT_FILE」**。

**第一轮（09:39，`.tmp-test/a3-current-build.log`）四条判据本身全绿**：界面出正文 `展开 ⏎ 助手 · 1 条消息 ⏎ 收到就好`、`用量 3371/200000 · 已计量`、`session.log` 9 行且 `assistant/message`=true、含键=false、磁盘四文件均不含键=true、结论 PASS、`A3-rc=0`。

但**它开头两行是 `打开设置: 无 #open-settings` 与 `等到设置面板: false`**（那条 `until` 把 60 × 500 ms 预算耗尽）。这条不能糊过去，先分清是哪一侧的问题：

- `#open-settings` 在当前渲染层**确实存在**（`renderer/app.js:742` 那颗按钮的 id），且**同一个驱动**在 05:41 与 05:44 两轮的首步读数都是 `打开设置: clicked` + `等到设置面板: true`（`.tmp-test/a3-fullpath.log`、`.tmp-test/a3-fullpath2.log` 前两行原文）。所以判为**驱动首步抢在渲染挂载之前**的时序竞态，不是产品回归。
- 后果要说清是哪一环没被覆盖：这一轮里「进模型中心 / 进供应商子页 / 点添加 / 保存」的点击全都落在**处于关闭状态的 dialog 子树**上——CDP 的 `querySelector` 不看可见性、`.click()` 照样触发 Vue 处理器。因此**功能链证据仍成立**（保存后界面自己回显 `rows:["编辑 StepFun 真模型"]`、`window.sacode.modelsDescribe()` 通道复查到 `stepfun:step-3.7-flash`），但**「点设置按钮 → 面板真的打开」这一环本轮没验到**。

**修驱动后补跑第二轮（09:44，`.tmp-test/a3-current-build2.log`）**：只加一行就绪等待（`say('等到应用就绪', await until("!!document.querySelector('#open-settings')"))`），读数 `等到应用就绪: true` → `打开设置: clicked` → `等到设置面板: true`，收尾 `关闭设置: 点了关闭` → `设置面板还开着: false`，缺的那一环补齐；四条判据同向复现：界面 `展开 ⏎ 助手 · 1 条消息 ⏎ 收到就好`、`用量 3385/200000 · 已计量`、`session.log` 10 行、`assistant/message`=true、含键=false、`磁盘文件均不含密钥: true`、结论 **PASS**、**`A3-rc=0`**；宿主与 Electron **零残留**（`tasklist` 计数 0）。

**两处防误读的注解**：

1. `session.log 有 provider 配置事件: false` 是**负向泄漏探针**（驱动 `:139`，正则是 `/provider|model\/registry/i`）——false 才是期望值，供应商配置属 `providers.log` 不属 `session.log`。后来的读者别把它读成「配置没落盘的功能缺失」。
2. `通道复查` 里那个 `keyCfg:["?"]` **不是绿也不是红**：驱动在 `credentialConfigured === undefined` 时才打 `?`，说明该字段在 `modelsDescribe` 的响应里没出现。凭据面这一轮的依据只有两条——磁盘/日志四文件不含键、以及界面拿到真答复；不把这个 `?` 写成「凭据已正确登记」。

**与 §13.2（05:44，重建前宿主）对照**：同一条全路径两轮都 PASS，`session.log` 9/10 行、usage 3371 / 3385 / 3406 三读数同量级——本轮新构建的宿主没有让这条链退化。**批次 A 的 A3 判据因此按「当前构建」重记一遍为 PASS**；`core cjpm test` 计数仍是 §27 那条 BLOCKED，本节的绿不顶替它。

## 30. 三条独立复核：批次 E 产物仍对应当前桌面源码、A2 确实在库里、以及阻塞 core 计号的四处符号**刚刚在工作区补齐**（2026-10-11 09:51–09:52 实测）

**一、批次 E 的新鲜度复核（不重跑打包，只比对时间戳）**：以 `dist/electron/win-unpacked/resources/app.asar`（6,794,111 B @07:56）为基准，用 `find renderer -type f \( -name "*.js" -o -name "*.ts" -o -name "*.css" \) -not -path "renderer/vendor/*" -newer <asar>` 查非 vendor 渲染层源码——**零命中**；四个入口文件 `main.cjs` / `preload.cjs` / `host-bridge.cjs` / `paths.cjs` 与未跟踪的 `plugins-ipc.cjs` 逐个 `-nt` 比对也都是 older。三产物 `SaCode Setup 0.1.0.exe` 93,860,235 B @07:54、asar @07:56、`sacode-portable.exe` 84,256,050 B @07:58 因此仍对应**当前**桌面源码。

> 一个必须先排掉的假信号：`find ... -newermt "2026-10-11 07:50"` 会命中一整批 `renderer/vendor/*.iife.js`，看着像「打包后又被改」——但那些是 gitignore 的构建产物，**我自己 08:05–08:12 的 ui-smoke / layout 腿就把它们重写过**。所以这条复核必须按 `-not -path renderer/vendor/*` 排除产物，只比源码。

**二、A2 的落点复核**：`core/src/tls_roots.cj`（5,276 B @03:08）与 `core/src/tls_roots_test.cj`（6,242 B @02:51）**两个都已入库**（`git ls-files` 都列出）。`core/src/sse.cj:94` 现在是 `ClientBuilder().tlsConfig(defaultTlsClientConfig()).autoRedirect(false).build()`——即统一走默认证书配置，没有旁路。全仓 `TrustAll` 命中**只出现在禁止语境**：`tls_roots.cj:16` 的注释「任何情况下都不退到 TrustAll」、`tls_roots_test.cj` 的红线注释与用例名 `clientTlsConfigWithoutRootsStaysOnDefaultNeverTrustAll`。没有一处把它当可通过的期望值。

**三、最重要的一条状态变化**：§26/§27 把提交态编译失败归因到四处悬空符号，本轮复查发现它们**已经在工作区里有定义了**——

| 符号 | §26/§27 的判 | 本轮实测 |
| --- | --- | --- |
| `registerBuiltinCommands` | 全仓 0 个定义 | `core/src/agent.cj` 有 `public func registerBuiltinCommands(reg: CommandRegistry)` |
| `WriteLease.protects` | 悬空 | `core/src/lease.cj` 有 `public func protects(sessionPath: String): Bool` |
| `SessionLog.isDurableFrozen` / `freezeAfterDurableFailure` / `durableCheckpointBatched` | 悬空 | `core/src/session.cj` 三个都在 |
| `GitQueryResult` | 悬空 | `core/src/git_workbench.cj` 有 `public class GitQueryResult` |

但落库态一条都没有：`git status` 显示 `agent.cj`、`lease.cj`、`session.cj`、`cmds_test.cj` 是 **M**、`git_workbench.cj` 是 **??**（未跟踪），而 `git show HEAD:<file> | grep -c <符号>` 对这四个符号**全部为 0**。也就是说 §27 那句「两侧必须同时落到同一个 commit 才可能出 Summary」**结论不变**，但工作区这一侧刚刚被别人的在途改动补齐了——这给了一个**窗口**：工作区态现在有机会真跑出 `Summary`。

**因此本轮另开两条腿**（读数单独成节，不在此预告）：

1. 一条 `cjc --test-only --error-count-limit all` 的**只编译**腿（`.tmp-test/core-test-all-errors.cmd` → `.tmp-test/core-all-errors.log`，剥码后 278,708 B）。它一路打到 codegen 阶段，**全程 `grep -c "error:" = 0`**，只剩 `unused import` 一类告警。但这条腿是我**主动中断**的（进了 30 分钟量级的静默 codegen/link，而它只用来数错误，继续等不出新事实），所以「0 条错误」是**一次被中断运行的缺失读数**，不能当完成态证据——这一点必须写明。TaskStop 只停 Bash 壳，随后 `tasklist` 实查 `cjc/cjpm/lld/link` 计数 **0**，无孤儿。
2. 一条真 `cjpm test` 腿（`.tmp-test/core-test-ws.cmd`，`TMP/TEMP` 指 `.tmp-test\nsis-tmp`、PATH 带 stdx dynamic，日志 `.tmp-test/core-test-ws.log` + rc 单独落 `.tmp-test/core-test-ws.rc.txt` 配对）。它若出 `Summary`，就同时证掉「编译干净」和「计数与 rc」；**但这是工作区态读数，含别人未落库的源文件，不得冒充提交级证据**，落库态仍按 §27 判 BLOCKED。

## 31. 批次 E 第四条宿主哈希腿**到手且不需要安装**：NSIS 内嵌载荷与源、win-unpacked 逐字节一致；§20 那句归因是错的，按更正节办（2026-10-11 09:55–09:56 实测）

**先更正 §20**。原文写的是「第四腿仍 BLOCKED：NSIS 安装器内部的宿主需要**授权实跑安装**才能测……仓内也没有 7z 抽取器（`node_modules/7zip-bin` 不存在，MSYS `tar` 是 GNU tar 不认 7z）」。前半句事实成立（仓内确实没有），**但推论错了**：electron-builder 自己的缓存里就有官方抽取器 `C:\Users\jingg\AppData\Local\electron-builder\Cache\7zip@1.0.0\7zip-win-x64-a34pt\bin\7za.exe`（849,920 B，自报 `7-Zip (a) 24.09 (x86) … 2024-11-29`）——这是构建时官方工具链自己下载的，不是镜像、不涉网络；而且**根本不需要 NSIS 解析器**（下面第一条实测证明了载荷是原样内嵌的）。

**探针先判「内嵌还是被二次压缩」**（`.tmp-test/nsis-carve-probe.cjs`，只读、不抽取、不落盘）：对 `SaCode Setup 0.1.0.exe` 全文 93,860,235 B 扫 7z 签名 `37 7A BC AF 27 1C`。读数：**`sig-hits=1`、`offset=140446`、`fromEnd=93719789`，判定 PROBE-EMBEDDED-PLAIN**，整个扫描 `real 0m0.160s`。NSIS stub 占前 140,446 B，之后一路到 EOF 就是那份 `app-64.7z`，没有被 NSIS 自己的压缩器二次吃掉。

**切出来让 7za 认**：按该 offset 复制到 `.tmp-test/nsis-4th-leg/app-64-carved.7z`，`carved-bytes=93719789 == size-offset`（`equal=true`）。`7za l/e` 对它自报：`Type = 7z`、`Method = LZMA2:20 LZMA:20 BCJ2`、`Solid = -`、`Blocks = 166`、`Physical Size = 93363048`、`Tail Size = 356741`、结论行 **`Everything is Ok`**；唯一告警是 `There are data after the end of archive`——那就是 NSIS 挂在 7z 之后的 356,741 B 尾块（卸载器数据），良性，也正是「从签名切到 EOF 仍然可用」的原因。

**第四条腿（本节的正题）**：抽出 `resources\host\bin\sacode-host.exe`，解压后 **11,158,528 B**，`sha256 = d2ef66eb8c3edc9a53efb0b9777c14255f440eee47bb488dead90e9f880e2a4c`——与 ① 源 `dist/host/bin/sacode-host.exe`、② `dist/electron/win-unpacked/resources/host/bin/sacode-host.exe` **三处同一**。§20 那句「三条腿实测一致、第四腿 BLOCKED」由此升级为 **四条腿实测一致**（源 / win-unpacked / portable 运行期解包 / NSIS 内嵌）。

**顺带加送的两条对账**（同一份清单，不额外装任何东西）：

- `resources/app.asar` 抽出后 `sha256 = ddee3cb7b90d98d2e08c353e704cdc13ee4eaf56b3f21903bd271f5b374fb439`，与 win-unpacked 那份**一致** ⇒ 安装包与解包目录跑的是同一个渲染层，不是两份不同构建。
- `resources\host\bin\ca-bundle.pem`（84,105 B）**在安装包清单里** ⇒ §24 那颗随包信任锚确实进了 NSIS，A3 的「不带 `SSL_CERT_FILE` 也能验真」在安装包形态下有载荷支撑。

**随包依赖清点（这条我差点读反，必须写下来）**：NSIS 清单里 `resources\host\bin` 共 **92 条目 / 90 个 `.dll`**，与 `win-unpacked/resources/host/bin` 实测 **92 / 90** 相同——AGENTS.md 那条「宿主 exe 必须与全部依赖 DLL 同目录」在安装包内成立。**但第一版计数给了个危险的假信号**：我写的正则是 `host\\bin\\.*\.dll`，bash 双引号把它变成 `host\\bin\\`（两个反斜杠），而 listing 里是单反斜杠路径，于是报出 `dll=0`，读起来像「安装包把依赖 DLL 全落了」。改成 `host.bin` 通配后才拿到 92/90。登记这条不是自谦：**计数脚本的转义错误会造出比「文件真缺失」更像事实的假结论**，凡「0」都要先用第二种匹配方式复现一次。

**仍然 BLOCKED 的只剩一件事**：NSIS **真机安装/卸载**本身。理由与 §20 同且不变——`package.json` 的 NSIS 配置是 `oneClick=true`，静默装会向 HKCU `Uninstall\` 写注册项并建 Start Menu 快捷方式，不是纯目录级、可无痕撤销的动作，而目标文本把「真机安装/卸载」明写在需授权前提下。**这条 BLOCKED 与哈希腿无关了**：哈希对账已经不需要安装。解锁动作仍是「你授权一次，我装到 `.tmp-test/nsis-install/`、跑它自己的 `/S /Uninstall`、核注册项与进程零残留」。

**副作用与卫生**：全程未执行安装、未写注册表、未启动安装包、未联网。落点只有 `.tmp-test/nsis-4th-leg/`（gitignored）：`listing.txt` 14,559 B、`extract.log` 611 B、`extract-asar.log` 610 B、`out/sacode-host.exe` 11,158,528 B、`out/app.asar` 6,794,111 B；93,719,789 B 的中间切件按「做完即删」已 `rm` 掉，复现法是「探针取 offset + 按 offset 复制到 EOF」两步，offset 已写在正文（140,446）。

## 32. 工作区态 `cjpm test` 的**库层**已结算：0 error / 160 warnings / `libcore.a` 6,414,900 B @09:52 全新落盘；测试面仍在编，计数仍未到手（2026-10-11 09:52–10:00 实测）

§30 那条腿（`cjpm test`，工作区态）跑到 10:00 的中间事实，单独记一条，因为它们**不等 Summary 也成立**：

- **库层编译结算**：剥码后日志的最后一段是 `160 warnings generated, 160 warnings printed.`，且**全程 `error:` 计数为 0**；该段落出现 **1 次**（对应库层那一段编译）。产物侧同时给上了硬证据：`core/target/release/core/libcore.a` **6,414,900 B @09:52**、`core-cache.json` @09:52——都是本轮新生成，不是上一轮的残留（批次 B 那句「产物 mtime/体积证明本轮新构建」在库层这一侧已经满足）。
- **测试面仍在进行**：`cjpm.exe`(23872) 之下挂着 `cjc.exe`(24560，RSS 1,548,768 K)，`core/target/release/unittest_bin/` 目录空、`Summary` 计数为 0 ⇒ 按 §27 那套判据现在**还不能报任何用例数**，只能报「库层绿、测试面未结算」。既往读数里这一段（测试目标编译 + link）是 30 分钟量级的静默段，不判挂死。

**顺带登记一条仓库根卫生违规（不是我造的，也没擅动）**：提交前 `git status --short --untracked-files=all` 按顶层聚合时露出仓库根有一个**未跟踪且未被忽略**的文件 `tmpFilea27728`——`file` 判 JSON text、236 B、mtime **2026-10-10 10:54**（早于本批开工），内容形态是 `snapshotVersion/revocationVersion/nextDeviceId/devices/enrollments[{digest,principalId:"p-b",expiresAtUnixM…}]`，即某条设备撤销/注册线的一次落盘；`git check-ignore -v` 明确返回 NOT-IGNORED。按 AGENTS.md「仓库根只允许已入库的源码、文档与配置；出现未跟踪未忽略的顶层文件即视为违规」这条**成立**，但它的 mtime 与内容都不属于本批任何一条腿（本批临时产物全部落 `.tmp-test/`，§27 那次 325 文件扫描也确认没有密钥外泄），且并发会话可能正在读它——**所以我没有删也没有移**，等一句授权再处置（可逆做法：原字节移进 `apps/desktop/.tmp-test/`）。

## 33. 批次 F 四项缺口第一次正式落笔：按后端实测契约逐条归类——一条是「模拟成功」、一条连可取消的在途状态都不存在（2026-10-11 10:03–10:05 实测）

**先认一条文档缺口**：本文件此前**没有任何一节写过批次 F**（`grep -n "批次 F\|插件管理"` 全文 0 命中）——四项处置只存在于对话里，不满足「不默认算已解决」要留档的要求。本节补上，每条都指向可直接复核的源码处理体。

证据主体是 `apps/host/src/main.cj` 的插件分支（按 `method ==` 判定；行号会随并发编辑漂移，故只用符号锚点）与宿主在 `initialize` 应答里自报的 `capabilities` 常量。

| 项 | 后端实况（可复跑锚点） | 归类 | 处置 |
| --- | --- | --- | --- |
| remote source 远程源 | `method == "plugin/registries"` 的处理体是**硬编码** `{"registry":null,"fallbackRegistries":[]}`；`plugin/install/inspect` 落到 `PluginStore.inspectSource(sourcePath: String)`（`core/src/plugin_store.cj`），入参是**路径形状** | **模拟成功**（动词在能力清单里、返回是空壳）＋远程取源**后端未实现** | 本轮不实现（理由见下）；不接受「有 registries 动词」当作已支持远程源 |
| entry enable 组件级启停 | `method == "plugin/entry/set-enabled"` 的处理体直接 `emit(errFrame(id, -32033, "plugin-entry-not-wired"))`；桌面侧他人未落库的 `plugins-ipc.cjs` 已在发这个动词 | **后端未实现**，但是**诚实失败**（不是假成功） | 本轮不实现；缺口归属在后端不在壳层，壳层接线已由并发线补上 |
| install cancel 安装取消 | `initialize` 自报 `capabilities` 里**没有** `plugin/install/cancel`；`plugin/install/start` 是 `store.install(spec)` 之后**同步** `pluginInstallRequests[rid] = "done"`，`plugin/install/progress` 只从这张内存表读 phase | **后端未实现**＋语义空转：安装**没有在途窗口**可取消 | 本轮不实现；并连带登记 `install/start` 目前是**假异步**——真做 cancel 前必须先把安装改成真异步任务 |
| build approval 构建审批 | `plugin/install/start` 的处理体只读 `requestId` 与 `spec`，**不读 `approvedBuilds`**；而 `preload.cjs` 的 `pluginsInstall` 把 `approvedBuilds` 一路传下来 | **传输契约错误**（参数在传输面被静默丢弃）＋后端无审批通道 | 本轮不实现；拒绝理由不是「难」，是后端连承接它的字段都没有 |

**为什么这一轮不实现（三条可复核的理由，不是拖延）**：

1. 落地要动的三个文件**全部被并发线持有**：`git status` 实测 `core/src/plugin_store.cj` **M**、`apps/host/src/main.cj` **M**、`apps/desktop/plugins-ipc.cjs` **??**（未跟踪）。在它们之上加动词＝覆盖或错接别人未复核的在途实现，而 AGENTS.md 与本目标都把「保护共享工作区他人改动」排在前面。
2. 新写的 core 侧用例**当场拿不到绿证**：提交态仍按 §27 判 BLOCKED（双向签名漂移），工作区态计数此刻还在跑（§32）。
3. 语义前置未解决：cancel 依赖「真实异步安装」，而实测是**同步置 done**。先加动词只会得到一个永远取消不到任何东西的假功能。

**「能实现就实现并补测试」里能实现的那一半我做了**：新增 `apps/desktop/test/plugin-gap-contract.test.mjs`（**3 条用例**，真起宿主、真发协议帧，复用 `test-support/real-host-env.mjs` 的撤夹具＋随包锚口径），把上面三条「后端现状」变成**会随真实契约演进而转红**的断言：

- 能力清单必须含 `plugin/install/start` 与 `plugin/install/progress`（**正控**，防止在空场上赢），且 `plugin/install/cancel` 必须为 `false`；
- `plugin/registries` 返回 `registry === null` 且 `fallbackRegistries` 深等于空数组；
- `plugin/entry/set-enabled` 用 `assert.rejects` 收到 `plugin-entry-not-wired`（不是假成功）。

每条都写明「后端若真接上，这条必须转红」。**绿灯在这里的含义是「现状被钉住」，绝不是「功能可用」**。运行读数（tests/pass/fail/cancelled 与 rc）待 §32 那条 core 腿让出 CPU 后单独补记；这 3 条会把 `npm test` 分母从 671 抬到 674，届时批次 D 的定稿读数按新分母重记，不拿旧数顶。

**§33 那句「待补记」的读数已到手（2026-10-11 10:07 实测，`.tmp-test/gap-1.log` / `gap-2.log`）**：

- 第一次跑 **FAIL（tests 3 / pass 0 / fail 3，`GAP-rc=1`）**，三条同错 `host-unavailable`（`host-bridge.cjs:88` 的 `this.proc` 空）。**根因是我的夹具漏了 `await bridge.start(directory)`**——`HostBridge` 构造函数只存参数不 spawn（对照 `test/real-provider-read-tool.test.mjs:29-30` 的既有写法）。这条红与被测系统无关，先怀疑夹具这条规矩又一次是对的。
- 补上 `start()` 后 **PASS（tests 3 / pass 3 / fail 0 / cancelled 0 / skipped 0，`GAP-rc=0`）**，三条 `ok` 逐条点名：能力清单含 `install/start` 与 `install/progress` 但不含 `install/cancel`、`plugin/registries` 返回 `registry=null` 且 `fallbackRegistries` 为空、`plugin/entry/set-enabled` 以 `assert.rejects` 收到 `plugin-entry-not-wired`。
- 连带义务已完成：全套按新分母重跑 —— **`npm test` 674 / pass 674 / fail 0 / cancelled 0 / skipped 0，`CREDALLHOST-rc=0`**（`.tmp-test/cred-all-host-4.log` 136,121 B 与 `.tmp-test/cred-all-host-4.rc.txt` 197 B 配对，`grep -c "^not ok"` = 0），`tasklist` 里 `sacode-host.exe|electron.exe` 计数 **0**。批次 D 的定稿读数由 §28 的 671 升级为 **674**；`ui-smoke` 与 `layout-smoke` 的分母不受新增测试文件影响（它们数的是界面断言数），不重跑，如实标为 §22 读数。

## 34. §30 那条「工作区窗口」的期望被证伪：core 在工作区态同样出不了 Summary，rc=1 / Summary 0 次 / `43 errors generated, 8 printed`（2026-10-11 09:52–10:06 实测）

**先更正 §30 第三项的推论**。那节写「四处悬空符号已在工作区获得定义 ⇒ 工作区态现在有机会真跑出 Summary」——**定义确实有了，但形状不匹配**，所以这个「窗口」不存在：

- `registerBuiltinCommands` 在工作区是 **类成员**：`core/src/agent.cj` 里该行缩进 4 空格、签名为 `public func registerBuiltinCommands(reg: CommandRegistry): Unit`（`grep -n -B3` 实测其上是类内注释与成员位）。
- 而 `core/src/cmds_test.cj` 按 **包级自由函数**调用它（`registerBuiltinCommands(reg)`）。
- 于是编译器给的仍是 `undeclared identifier`，不是「缺实现」也不是我可读的别的错。**这是并发线内部的 API 形状分歧**：`agent.cj` 与 `cmds_test.cj` 两份都是 M 态，改哪一侧是它们的设计决定，我不替任何一方定形状。

**本轮实测读数（`cjpm test`，工作区态，含他人未落库源文件）**：`CJPMTEST-rc=1`；剥码后 **`Summary: TOTAL` 出现 0 次** ⇒ 第三态「测试根本没跑」，按判据**不许报任何用例数**；结尾 `43 errors generated, 8 errors printed.`（8 是 `cjc` 默认打印上限，同 §27）。把每条 `error:` 与其后第一个 `==>` 配对（`.tmp-test/err-histogram2.cjs`，避开 §26 那条「告警也带 `==>`」的误读陷阱）：

| 打印出的 8 条 | 位置锚点 | 原文形状 |
| --- | --- | --- |
| 3 条 | `cmds_test.cj:76`、`:86`、`:96` | `undeclared identifier 'registerBuiltinCommands'` |
| 1 条 | `cmds_test.cj:77` | `undeclared identifier 'it'`（前一条失败后的连锁） |
| 1 条 | `cmds_test.cj:108` | `no matching function for operator '()' function call` |
| 2 条 | `worktree_setup_test.cj:288`、`:313` | `mismatched types`（即 §27 那批 `SessionLog(Path(...))` 调用点） |
| 1 条 | `worktree_test.cj:191` | `mismatched types`（同一类） |

**同轮拿到的另一半事实是绿的**：库层那一段编译**已结算**且**零 error**（§32），`libcore.a` 6,414,900 B @09:52 全新落盘。也就是说 core 的**库面**在本轮工作区是编得过的，卡点全在**测试面**这两处形状分歧上。

**批次 A 的验收口径因此照实结算（不缩、不顶替）**：

| 验收项 | 判 | 依据 |
| --- | --- | --- |
| A3 桌面端到端出现 assistant/message、usage 落账、无密钥、零 `SSL_CERT_FILE` | **PASS** | §29 两轮，`A3-rc=0`，零残留 |
| 结束后宿主零残留 | **PASS** | §28/§29/§33 三处 `tasklist` 计数 0 |
| `core cjpm test` 计数与 rc | **BLOCKED（本轮再次实测未达成）** | 提交态 §27；**工作区态 §34：rc=1、Summary 0 次**，卡点为 `registerBuiltinCommands` 的类成员/包级调用形状分歧与 `SessionLog(Path)` 签名分歧，两份测试与两份实现都在并发线手里 |

**所以批次 A 不能报完成**：链路本身（A1/A2/A3）有实测支撑，但目标文本明写的「core cjpm test 计数与 rc」这一条今天**两侧都拿不到**，且今天多了一条更硬的证据——即使把实现全借过来（§27）、即使符号定义已出现在工作区（本节），只要测试与实现不同源同批落库，`Summary` 就不会出现。**解锁动作不变且更具体**：并发线把 `cmds_test.cj`/`agent.cj`（以及 `session.cj` 的 `SessionLog` 构造与 `worktree*_test.cj` 的调用形状）**同一批**落库后，我再跑一次 `cjpm test` 取五计数。

## 35. 逐批次终判表（本轮 A–G 一次收拢，每格带实测读数与出处；两处 BLOCKED 不含任何替代性绿灯）2026-10-11 10:10

| 批次 | 判 | 实测读数 | 出处 |
| --- | --- | --- | --- |
| A1 系统信任根进 TLS | **PASS（机制替换已如实登记，不是按原方案实现）** | crypt32 进程内枚举恒 NULL（路由证伪，两条读数）；改走构建期导出 PEM 注入 `CustomCA`；锚集合 raw=94 / distinct=53 / 随包 53，逐张对得上 | §3、§14、§24 |
| A2 `tls_roots.cj` 与测试、`sse.cj` 统一默认配置 | **PASS** | `core/src/tls_roots.cj` 5,276 B 与 `tls_roots_test.cj` 6,242 B 均已入库（`git ls-files` 两行都在）；`sse.cj` 走 `.tlsConfig(defaultTlsClientConfig())`；全仓 `TrustAll` 只出现在禁止语境的注释与用例名 `clientTlsConfigWithoutRootsStaysOnDefaultNeverTrustAll` | §30 |
| A3 桌面端到端（无 `SSL_CERT_FILE`） | **PASS** | 在当前构建宿主（11,158,528 B @07:18）+ 随包锚（84,105 B）上两轮：界面出正文「收到就好」、`用量 3371/3385/200000 · 已计量`、`session.log` 9/10 行含 `assistant/message`=true 且含键=false、磁盘四文件不含键=true、`A3-rc=0`、宿主零残留；第一轮漏掉的「面板可见打开」已归因驱动抢跑并补跑 | §29 |
| A 验收项 `core cjpm test` 计数与 rc | **BLOCKED（今日两侧各实测一次，均第三态）** | 提交态：`38 errors generated / 8 printed`、Summary 0 次（§27）。工作区态：**`CJPMTEST-rc=1`、Summary 0 次、`43 errors generated, 8 errors printed`**，8 条逐条配对归因到 `cmds_test.cj`(5) / `worktree_setup_test.cj`(2) / `worktree_test.cj`(1)；同轮**库层零 error**、`libcore.a` 6,414,900 B @09:52 全新落盘 | §27、§32、§34 |
| B 从当前源码重建双入口 | **PASS** | core 库层本轮新构建（上一行）；宿主重打并 `dist/host/bin/sacode-host.exe` @07:18；CLI 平台包剥掉仓颉 PATH 后逐子命令 `^PASS/^FAIL` 计数、包内 exe 与本轮新构建**逐字节一致**（第四条对账腿） | §17、§23、§32 |
| C 渲染入口 < 1000 行 | **PASS** | `renderer/app.js` **953 行**，且工作区与 HEAD 该文件**无差异**（`git status` 该路径 0 行输出）——不是靠压行凑数 | §30 |
| D 全量回归 | **PASS（分母已随 §33 新增用例升级并重记）** | `npm test` 三种门槛读数：无凭据 671/663/0/0/8 rc=0（§21）、带凭据 671/669/0/0/2 rc=0（§22）、带凭据带宿主 **674 / pass 674 / fail 0 / cancelled 0 / skipped 0，`CREDALLHOST-rc=0`**（§34，日志 136,121 B 与 rc 文件 197 B 配对）；`ui-smoke` 296 条 UI OK / 0 FAIL；`layout-smoke` 192 PASS / 0 FAIL（后两条为 §22 读数，本轮改动不触及其分母，已如实标注）；`tasklist` 宿主与 Electron 计数 **0** | §21、§22、§28、§34 |
| E 打包与安装包验收 | **PASS**（安装/卸载除外） | 三产物本轮新建（Setup 93,860,235 B @07:54、asar 6,794,111 B @07:56、portable 84,256,050 B @07:58）；双入口打包态各 **296 项**；宿主载荷哈希由三条腿升级为**四条腿实测一致**（源 / win-unpacked / portable 运行期解包 / **NSIS 内嵌**，前缀 `d2ef66eb…80e2a4c`），且包内 `app.asar` 与 win-unpacked 那份 `ddee3cb7…` 一致、`ca-bundle.pem` 84,105 B 在清单内；`host/bin` 92 条目 / 90 DLL 两侧相同；签名四对象如实 **`NotSigned`**（`signExecutable=false` 是主动选择，「已产出」不等于「可分发」） | §19、§20、§30、§31 |
| E 的 NSIS 真机安装/卸载 | **BLOCKED（未获授权，非技术不可行）** | `oneClick=true` 的静默装会写 HKCU `Uninstall\` 与 Start Menu 快捷方式，不是纯目录级可无痕撤销的动作。**你已安装的应用未被触碰**；解锁动作＝授权一次，我装到 `.tmp-test/nsis-install/`、跑它自带 `/S /Uninstall`、核注册项与进程零残留 | §20、§31 |
| F 插件管理四项缺口 | **未解决（逐项归类，不默认算已解决）** | remote source＝`plugin/registries` 硬编码空壳（**模拟成功**）＋远程取源未实现；entry enable＝后端直接回 `-32033 plugin-entry-not-wired`（诚实未实现）；install cancel＝能力清单无该动词且 `install/start` 同步置 `done`（**假异步，无在途可取消**）；build approval＝`approvedBuilds` 在宿主处理体里根本不被读（**传输契约错误**）。本轮补上 3 条**钉住现状**的运行时契约用例（首跑 3 全红＝我夹具漏 `bridge.start()`，修正后 **3/3 pass、`GAP-rc=0`**）；不实现的可复核理由：要动的 `core/src/plugin_store.cj` 与 `apps/host/src/main.cj` 均为 **M**、`apps/desktop/plugins-ipc.cjs` 为 **??**，三份都在并发线手里 | §33、§34 |
| G 精确提交 | **PASS** | 本轮 6 枚，全部 `git commit -m … -- <显式路径>`，无一次 `add -A/.`：`b135989`（§28/§29）、`b1f91dd`（§30）、`0f46a12`（§31）、`fb4fed8`（§32）、`391563b`（新测试，1 文件 +57）、`d1640e0`（§33/§34）；每枚提交后 `git show --name-status` 逐条比对实际路径；文档各节均为**纯增行**（+47/+26/+23/+9/+63），未消费别人一行 | 本节 |

**贯穿红线的当轮自证**：不缩范围——两处 BLOCKED 都按原文口径保留，没有任何一条用别的入口的绿去顶（`core` 计数没有，A3/D 的绿也没被写成它有了）；不设镜像——四条腿全走本机官方宿主与构建器自有缓存，`ELECTRON_MIRROR` 始终未设；不提交产物与密钥——产物路径全部 `git check-ignore` 命中，`.tmp-test/` 325 个取证文件与本文档分别扫过密钥（`leaked-files=0`、`doc-secret-hits=0`）；不叠加在跑测试——core 编译期间只做零负载的读与写文档，宿主类用例一律等 CPU 空了独占跑；临时产物只落 `.tmp-test/`（93 MB 中间切件已删）；**唯一一条我没擅自处置的越界项**：仓库根那个非本批的 `tmpFilea27728`，登记在 §32 等一句授权。

## 36. 更正两处我自己的错读，把提交态测试面的 35 处已入库类型形状错当场修掉，并结算 core 编译读数（2026-10-11 10:14–10:36 实测）

**一、更正「HEAD 侧一条都没有」**（§34 那段的依据，也是 §35 表格里批次 A 那一行的依据）：这句来自一条坏管道。我当时写的是
`git grep -c "$s" HEAD -- core/src | paste -sd+ | bc || echo 0`——`git grep -c` 的输出是 `HEAD:file:count` 形式的多行，
`paste -sd+` 拼出来的串（`HEAD:core/src/a.cj:2HEAD:core/src/b.cj:1`）`bc` 必然报语法错，于是每条都掉进 `|| echo 0`，
五个符号「齐刷刷为 0」。**0 是工具失败，不是没有命中。** 换成直接照打 `git grep -c "$s" HEAD -- core` 后的实测：
`isDurableFrozen` 命中 4 个文件（`team_board.cj:2`、`team_board_test.cj:2`、`team_runner.cj:3`、`team_runner_test.cj:1`）、
`freezeAfterDurableFailure` 2 个、`durableCheckpointBatched` 3 个、`protects` 4 个——**这些符号本来就在 HEAD**。
但「命中」不等于「在此定义」，是自有定义还是悬空引用必须 `git grep -n` 逐行看；数数不够，这条判据已补进记忆。

**二、更正「`registerBuiltinCommands` 属提交态阻塞」**：`git show HEAD:core/src/cmds_test.cj | grep -c registerBuiltinCommands` = **0**，
即「调用方」与「类成员定义」**两侧都只在工作区未落库**，并发会话落库后即自洽。它是工作区在飞分歧，不是 HEAD 缺实现。

**三、提交态测试面的真阻塞大头是无人持有、本线程可修的**：`SessionLog(Path(...))` 共 **35 处**——
`git grep -c 'SessionLog(Path(' HEAD -- core` 给 `worktree_test.cj:28`、`worktree_tools_test.cj:5`、`worktree_setup_test.cj:2`
（三个文件在 `git status` 里都**干净**，不在并发线手里）。而 `git show HEAD:core/src/session.cj` 第 116 行是
`public init(path: String)`，且 `git log -S'public init(path: Path)' -- core/src/session.cj` **空输出**＝该签名历史上从未收过 `Path`
⇒ 错在调用侧。修法形状也不是我猜的 API：同文件 `worktree_tools_test.cj:105/:297` 当时就写着 `.toString()`（同文件 2 对 3 混排就是铁证），
`agent.cj:298`、`batch.cj:47`、`hook_settings.cj:22` 皆为同形。本批补齐缺的 **33 处**（另 2 处本就正确）。
- 机械核验：`SessionLog(Path(` 总数 35 → 带 `.toString()` **35**、缺 **0**；`git diff --numstat` = `2 / 28 / 3` 行，
  减 33 加 33，且「新增行里不含 `toString`」计数为 **0** ⇒ 除这 33 行外没有任何附带改动。
- **没有为了变绿动一条断言**：这三个文件自身的期望值惯用法就是 `.toString()`（`worktree_test.cj:221` 用
  `canonicalize(Path(wtBaseDir(root)).join("alpha")).toString()`），`SessionLog` 只当会话身份用；
  `wtCoreRemoveRequiresCreatingSession` 要求两个实例身份串一致（475/480 现在两处是同一串），
  `@Expect(tree.directory(), root)` 比的也是 String。原先这些行是编译错，不存在被破坏的既有行为。

**四、把 §34 那 43 条错误按归属彻底拆开**（读留在盘上的原件 `apps/desktop/.tmp-test/core-test-ws.log`，197,770 B @10:05；
剥码后 6,485 行，末段 `43 errors generated, 8 errors printed`）：
- **35 条**＝上面这批 `mismatched types`，打印出的 3 条样本分别钉在 `worktree_setup_test.cj:288:26`、`:313:26`、`worktree_test.cj:191:43`；
- **8 条**＝并发会话未落库的 `cmds_test.cj`：已打印 5 条钉在 76:5、77:34（`undeclared identifier 'it'`）、86:5、96:5、
  108:13（`no matching function for operator '()'`），全部落在同一个 hunk `@@ -71,0 +72,51 @@`（`git diff --numstat` = 51 加 0 删）之内，另 3 条被默认打印上限遮住；
- 35 + 8 = 43 这个「闭合」在当时算得对，但**归因错了**，按本节第五点的结算读数更正：那 8 条里只有 **5 条**属并发线未落库的 `cmds_test.cj`，
  另 **3 条是已入库代码自带的**（`worktree_test.cj:450/451/452`，见本节第七点）。所以原先那句
  「**没有一行落在已入库代码上**」**作废**——已入库代码自带两类形状错，一类我已修，一类我不臆造修法。
- HEAD 侧同类漏网也扫过：`SessionLog(` 的实参形状除 `Path(...)` 外全是 String 形态（`"${root}/session.log"` 177、`path` 125、`p` 43、
  `file` 15、`f.path` 6 等），与 43 = 35 + 8 互洽，不存在第四类形状错。

**五、编译读数已结算**（工作区态那一轮，10:20:22 起跑 → 10:29:17 落盘；壳 `apps/desktop/.tmp-test/core-test-ws2.cmd`，日志与 rc 分文件配对，不覆盖 §34 原件；起跑前 `cjpm.exe`/`cjc.exe` 实查 **0/0**，非叠加）：
`CJPMTEST2-rc=1`；剥码后 `Summary: TOTAL` **0 次**（仍是第三态，用例数拿不到）；末段 **`16 errors generated, 8 errors printed.`**；
`core-test-ws2.log` 187,397 B @10:29:17 与 17 B 的 rc 文件配对；库层侧 `160 warnings printed` 复现。
- **我原先写的可证伪预期是 `43 → 8`，实到 16，预期落空**。落空原因经打印集核对，不是「我改错了」：上一轮的 8 条打印上限把
  `worktree_test.cj:450/451/452` 这三条同族红挤出了打印集；本轮它们进打印集，同时更深处另有若干条被**解封**
  （先前被 `SessionLog` 类型错污染而未检查的后续表达式现在才被检查），这就是 `generated` 8 → 16 的机制。
- **没证到的部分如实登记，不写成已全证**：打印出的 8 条**没有一条落在我改的 33 行上**；且本轮 `worktree_test.cj` 的
  首个报错行是 **450**，说明该文件 1–449 行（含我改的 191/214/245/267/285/304/326/339/344/361/402/442）零错误。
  但余下 8 条被 `printed=8` 上限遮住、落点**本轮未取得**，所以「33 行全部干净」只证到 449 行为止。
- 取不全的原因也是实测的：`cjpm test --error-count-limit all` 被拒，原文
  `Error: the customized key 'error-count-limit' is wrong, the example is 'cfg_1'` + `the path 'all' does not exist` + `Error: cjpm test failed`；
  `cjpm test --help` 全表**没有任何转发给 cjc 的错误计数开关**。而 `cjpm test -V --dry-run` 里的 `--dry-run` **并不跳过构建**
  （踩既有那条坑，等于又起一次全量编译），已按启动时间认领我自己那条 cjpm(13012)/cjpm(26412) 并 `taskkill //F //T` 收掉，
  事后 `Get-Process cjpm,cjc` **空表＝零残留**。
- 本批 3 个测试文件已按路径精确提交：`8c2bd57`（3 files changed, 33 insertions(+), 33 deletions(-)，ahead 140，**未 push**）。
  **「`core cjpm test` 计数与 rc」这一格到本批结束仍是 BLOCKED**——修复把已入库那两类形状错消掉了一类，
  但出不了 Summary 的前置在并发线手里（`cmds_test.cj` 的 5 条 + 库层那两处，见本节点七）。

**六、顺手把批次 D 两条「改动前读数」是否失效查死了**（怕 §22/§35 那两句被并发线的新改动作废）：
`layout-smoke 192 PASS / 0 FAIL` 出自 `.tmp-test/d-layout2.log`（10-11 08:18，8,778 B），`ui-smoke 296` 出自 `d-uismoke2.log`（08:08，28,082 B）。
两条腿的输入面在这之后**没有任何变化**，两个独立证据同向：① `git log --since="2026-10-11 08:18" -- apps/desktop/renderer apps/desktop/layout-smoke.cjs apps/desktop/main.cjs apps/desktop/preload.cjs` **空输出**；
② 带日期的 mtime 全部早于 08:18——`layout-smoke.cjs` **10-10 19:09**（连冒烟壳自己都没动）、`main.cjs` 10-11 03:11、
`renderer/frame.css` 10-10 18:40、`renderer/product-design.css` 10-10 23:57、`renderer/pages/composer-menu.ts` 10-09 15:44、
`provider-settings.ts` 10-11 00:52、`composer-commands.ts` 10-10 08:39。
这些文件里 5 个是 `M`、1 个是 `??`（并发线在飞），但它们的**在飞状态在 08:18 那轮就已经在工作区里**，
所以「192/0 与 296 是并发线在飞状态下的读数」这句限定要保留，而**不是**「读数已作废」。§35 表格里 D 那一行按此口径成立。

**七、本轮新查出第二类已入库测试形状错（不是我造的，也不由我臆造修法）**：`worktree_test.cj:450/451/452`（同族实为 450–453 四行）报
`'isSome' is not a member of class 'JsonBool' / 'JsonString' / 'JsonInt'`。
- 这四行与 HEAD **逐字节相同**（`git show HEAD:core/src/worktree_test.cj` 取 444–455 行与工作区同区间 `diff` 无输出），
  所以属**已入库代码自带**，与本批改动无因果关系——它是本轮 `generated` 从预期 8 涨到 16 的去向之一。
- 作者意图是明确的（注释写「类型钉住：三个布尔位、五个字符串/整数位都不许换位」），但**同仓两种现成惯用法都不等于它**：
  `isSome()` 是 `Option` 的方法（`agent.cj:610`、`ledger.cj:666`、`credential_test.cj:89`），而 Json 侧的写法是
  `.asBool().getValue()` / `.asString().getValue()`（`batch_test.cj:31`、`computer_executor_test.cj:69-71`）。
- 于是只有两条出路，都要么**替原作者定期望值**、要么**替该模块选一种类型钉法**：断值（我没有 `name`/`uncommittedCount`/`uniqueCommits` 的期望值）
  或断类型（需我自选 `is JsonBool` 一类未在本仓验证过的写法）。该文件所属子系统的实现 `core/src/worktree_tools.cj` 在 **10:28:33 刚被并发会话写过**
  （其 `git status` 为空＝写回内容与 HEAD 一致，故本轮编译输入在内容上仍是静态的，污染排除，但归属清楚）。
  **结论：本批不臆造修法**，只把 file:line、报错原文、两种候选与解锁动作（该模块作者定期望值或定类型钉法）登记在此。
- 对计数的影响：即便这四行修好也出不了 Summary——`cmds_test.cj` 那 5 条在并发线未落库的 hunk 里，库层另有 `GitQueryResult`
  （定义在未入库的 `git_workbench.cj`，已入库的 `team_workspace.cj:18` 却引用它）与 HEAD `cmds.cj` 的写法待并发改动落库。
  所以「core cjpm test 计数与 rc」仍是 **BLOCKED**，且现在**每一格的归属都点名到位**。













