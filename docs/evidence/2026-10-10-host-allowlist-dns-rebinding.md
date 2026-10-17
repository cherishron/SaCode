# 2026-10-10 批次 M：Host 允许集与 DNS rebinding 防线（规格 §7 那句「Host/Origin 检查」的实现半）

对象：`apps/daemon/src/remote_schema.cj`、`apps/daemon/src/daemon.cj`、`apps/daemon/src/remote_schema_test.cj`、`apps/daemon/test/remote-host-guard.test.mjs`。
取证态：**工作区态**（HEAD = `e92c72e`；本批文件在改动前都是提交态干净文件，`git status` 当场核过）。

规格依据（`docs/superpowers/specs/2026-10-10-unified-remote-mobile-design.md` §7 第 124 行，逐字）：
> 外部 CORS 默认不开放；Host/Origin 检查、HTTPS 与凭据校验防止浏览器跨站及 DNS rebinding；非浏览器客户端没有 Origin 不能作为放行理由。

批次 G 落了 Origin 那一半，Host 那一半一直在「在飞未完成」表里（当时写的理由是「缺一个本实例允许被哪些主机名访问的配置面」）。本批把这两半一起补齐。

## 1. 加了什么

- `RemoteRequestSchema.hostViolation(header, allowed)`：按字节判，不做包含式匹配。归一化 = 转小写 → 剥 IPv6 方括号 → 仅在**唯一冒号**处切端口（裸 `::1` 里全是冒号，按第一个冒号切会把它砍没；带括号的 `[::1]:8443` 必须先剥括号）。
- `RemoteRequestSchema.allowedHosts(bind, extra)`：默认允许集 = 绑定地址本身 + `127.0.0.1` / `localhost` / `::1` + `SACODE_REMOTE_ALLOWED_HOSTS`（逗号分隔）。**`0.0.0.0` 与 `::` 不进集合**——它们是「所有网卡」而不是一个能被 Host 指名道姓的主机；`*` 只能由调用方显式写进配置，默认集永不产出它。
- 允许集为空 = **全拒**（配置读失败宁可拒干净，不把「没配」读成「不限」）。
- 两个调用点：`jsonBodyOf`（覆盖 `/rpc`、`/auth/*`）在 Origin 之后、读体之前；`/sse` 在订阅与抢槽之前直接 403。顺序即归因：Origin 在前，所以两条同时命中时报 Origin。
- 启动告警：`bind=0.0.0.0` 且未配主机名时往 **stderr** 写 `remote-host-warning: …`。stdout 那行 `127.0.0.1:port` 是测试与客户端解析端口的唯一锚点，不能因为多打一条信息就改格式，所以走 stderr。

## 2. 读数

| 面 | 命令 | 读数 |
| --- | --- | --- |
| 红灯（先写测试） | `cjpm test --target-dir target/m-td` | rc=1；`error: 'hostViolation' is not a member of class 'RemoteRequestSchema'` × 7、`error: undeclared identifier 'SCHEMA_DENY_HOST'` × 2 |
| cj 实现后基线 | 同上 | **TOTAL 160 / PASSED 158 / SKIPPED 0 / ERROR 0 / FAILED 2**，rc=1 |
| Node 真实 HTTP 面 | `node --test apps/daemon/test/remote-host-guard.test.mjs` | **tests 9 / pass 9 / fail 0 / cancelled 0**，rc=0 |
| 回归（独占逐套） | `target/M-regress.mjs`（跑完即删） | 11 套 83 用例：**82 通过 / 1 红**，rc=0 除 product 外全部 rc=0 |

cj 基线那 2 条红**不是本批的**：`scopeGrantSurvivesSnapshotRoundTrip` 与 `gatePassesDeviceScopeIntoAuthorizationSoManagementMethodIsReachable`，来自并发会话那份未入库的 `apps/daemon/src/remote_identity_scope_test.cj`（批次 K 已记为当轮红，本轮复现一致）。回归里唯一那条红同样不是新伤：`带外撤销一台：只砍被撤那台的在途流与新请求，另一台不受影响`——批次 K 刻意保留的撤销事故半径缺陷，不许为变绿而弱化。

回归逐套计数：request-limits 6/6、capability-contract 15/15、auth 19/19、tls 2/2、events 7/7、idempotency 5/5、sse-recovery 4/4、execution-gate 5/5、method-surface 6/6、product 5（4 通过 1 红）、host-guard 9/9。既有客户端都用 `127.0.0.1` 或 `localhost` 连，回环写法在允许集内，所以这条门禁没改变任何既有通过面。

## 3. 变异反证：第一轮抓到的是一个等价变异，不是通过

四个语义变异一轮同施加（只改语义不改签名），要求红集合逐条点名：

| 变异 | 改法 | 预期独占受害 | 实得 |
| --- | --- | --- | --- |
| M2 | `normalizeHost` 不剥 IPv6 方括号 | cj `hostHeaderMatchesAllowlistExactly…`、Node「回环主机的不同写法」 | 两侧各红 ✓ |
| M5 | `/sse` 那处的允许集写成 `*` | Node「/sse 的 Host 拒发生在订阅之前」 | 红 ✓ |
| M6 | `allowedHosts` 无条件收下 bind | cj `defaultAllowedHostsCarries…`、Node「bind=0.0.0.0 …」 | 两侧各红 ✓ |
| M1 | 堆叠 Host 判定条件改成永不触发 | cj `hostHeaderRejectsForeignSuffix…` | **没红** |

```
变异态 node --test rc=1  tests 9 / pass 6 / fail 3（正是三条预期）
变异态 cjpm test rc=1     TOTAL=160 PASSED=155 ERROR=0 FAILED=4（外部 2 + 本批 2）
还原逐字一致=true，回绿重建 rc=0，回绿复跑 tests 9 / pass 9 / fail 0
cj 侧 多判=[] 漏判=["hostHeaderRejectsForeignSuffixAndMissingWithoutSubstringMatch"]
判定=MUTATION-VERDICT-FAILED
```

**M1 是等价变异**，判定按设计失败而不是放过。根因：那条用例里堆叠值 `"a.com, b.com"` 即使去掉逗号守卫也照样被拒——因为整串匹配不到 allowlist 里的任何一项（`a.com`、`b.com`）。也就是说「含逗号/空格即拒」这条守卫在当时的用例集里**没有任何一个可观察后果**。

它唯一的可观察场景是允许集配成 `*` 时：那时精确比对不再起作用，只有堆叠守卫还在挡。于是补一条专门用例 `stackedHostIsRejectedEvenWhenAllowlistIsWildcard`（同时要求 `"a.com"` 在 `*` 下必须放行，避免这条守卫被改成永久拒绝），再单独复跑 M1：

```
基线:        TOTAL=160 PASSED=158 ERROR=0 FAILED=2（只有外部两条）
M1 变异态:   TOTAL=160 PASSED=157 ERROR=0 FAILED=3（多出 stackedHostIsRejectedEvenWhenAllowlistIsWildcard）
还原回绿:     TOTAL=160 PASSED=158 ERROR=0 FAILED=2
M1 抓到=true；越界红=[]；还原逐字一致=true
判定=M1-CAUGHT-BY-NEW-CASE
```

这条链条的结论值得单独记：**「用例集里少一条红」和「实现里少一条守卫」是两种不同的缺陷，只有前者能被变异轮暴露**。第一轮如果只看 Node 侧 3/3 全中，很容易把整轮判成通过。

## 4. 传输层与本仓门禁的分层（裸 socket 实测）

三种畸形 Host 是 stdx 自己在解析层就 400 掉的，本仓代码压根没被调用：

| 请求形态（裸 socket 发出） | 实测响应 | 谁挡的 |
| --- | --- | --- |
| HTTP/1.1 完全不带 Host | `400`，正文 `Host should be and only one.` | stdx |
| `Host: `（值为空） | `400`，同上 | stdx |
| 两个 `Host:` 头 | `400`，正文 `Host should be only one.` | stdx |
| 单个 `Host:` 里堆两个值（`a, b`） | `400`，正文 `Malformed host header.` | stdx |
| **HTTP/1.0 不带 Host** | 走到本仓，回 `host-not-allowed`，未进分派 | **本仓 `hostViolation`** |

这张表有两个用处。一是别把前四行当成本批能力的证据——它们是传输层的，我在用例里因此只断言「没走到分派」（不出现 `"result"` / `"protocolVersion"`），不钉死那句英文，以免 stdx 换措辞就红。二是最后一行说明这条门禁不是纸面上的：HTTP/1.0 是唯一「解析器接受但没有 Host」的形态，没有 `hostViolation` 时它能直接进分派。用例名：`HTTP/1.0 不带 Host 时传输层不管，这条由本仓门禁挡下`。

顺带纠正一处我自己写错的断言：第一版用 Node 的 `http` 客户端发 `headers.host = ''` 想测「缺 Host」，实测 Node 会回退到连接地址填一个合法 Host，于是那条用例拿到的是 `initialize` 的成功回包——看起来像门禁失效，其实是夹具没发出那个形态。改成裸 socket 后才拿到真读数。

## 5. 本批明确没做到的

1. **`--bind` 与主机名仍是两个独立配置面**。`RemoteAccessConfig.fromEnvironment()` 里 `SACODE_REMOTE_BIND` 只有地址语义，新增的 `SACODE_REMOTE_ALLOWED_HOSTS` 是名字语义，二者不校验一致性：把 bind 配成 `192.168.1.10` 而允许集里忘写它，本机以外仍连不上（默认集已含 bind 本身，所以只有「用另一个 DNS 名访问同一地址」才需要额外配置）。这条设计选择记录在此，不当缺陷。
2. **TLS 证书 SAN 与 Host 允许集不联动**：LAN 场景要同时给证书加 SAN、给允许集加名字，两个地方各配一次。规格没要求联动，本批不擅自加校验，但这是运维最容易踩的坑，写进「在飞」。
3. **Host 拒绝不落审计**：与 Origin/深度那批路由级拒因一致（发生在身份确认之前，没有 deviceId 可记）。这条判断沿用批次 G 的口径，未在本批重新论证。
4. **Linux 侧未验**：stdx 在 Linux 上是否同样在解析层挡缺 Host / 重复 Host，本机无 Linux 无法测。若 Linux 行为不同（比如放行 HTTP/1.0 之外的更多无 Host 形态），本仓的 `hostViolation` 仍会兜住，但**实测缺口如实留着**，属任务 2/3 的 Linux 半（BLOCKED）。

## 6. 顺手修掉我上一批写坏的一处文档结构

给本批加「在飞」行时做标题集合对账，发现 `docs/evidence/2026-10-10-remote-batch-progress.md` 的 `## 后续批次依赖` 在**批次 L 那次文档提交（`e92c72e`）里被我吞掉了**：那次 Edit 的 `old_string` 是「换行 + 该标题」，而 `new_string` 只写了两条表格行、没有把标题回写。逐版本计数确认丢失点就是 `e92c72e`（`6908006` 有、`e92c72e` 无），该节正文（5 条 bullet）一直还在，只是变成了没有标题的孤段。本批已把标题补回，并按「上一提交标题集合 vs 当前集合」做差集复核：丢失集为空、新增集只含批次 L/M 两个小节名。

这条正是我自己踩过的形状：从 `tail` 看一切正常，表格与 bullet 都在，只有把标题集合拿去做差才暴露。
