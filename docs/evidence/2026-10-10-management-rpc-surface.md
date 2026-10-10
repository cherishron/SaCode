# 批次 O：认证 RPC 管理面（auth/devices / auth/revoke）——建了处理器，故意没建 scope 的来源

规格出处：`docs/superpowers/specs/2026-10-10-unified-remote-mobile-design.md` §5

> 网络最小身份引导端点限定为 POST /auth/enroll 与 POST /auth/token；…设备列表、确认、撤销只能通过本机受保护管理入口**或具有显式管理权限的认证 RPC**。

前半句早就落了（`--manage list-devices` / `--manage revoke-device`）。**后半个通路一直没建**：契约里这两行的 `implementationAnchor` 至今写着「拟新增: apps/daemon/src/identity.cj」，daemon 的分派对它们只会掉进 `-32601`。本批把处理器与分派补上，并明确不补 scope 的来源。

## 1. 为什么本批不建「设备怎么拿到 management scope」

实测依据，不是推测：

- `git show HEAD:core/src/remote_identity.cj | grep -n scopes` → **零命中**。HEAD 里 `DeviceRecord` 与 `AuthenticationContext` 都没有 scopes 字段。
- 工作区那份 `remote_identity.cj` 有 7 处 `scopes`（含 `d.scopes.add(scope)`），未提交，且它带来的两条用例 `scopeGrantSurvivesSnapshotRoundTrip` / `gatePassesDeviceScopeIntoAuthorizationSoManagementMethodIsReachable` 当轮为红——这条线由并发会话持有。
- 授权侧其实**早就建好了**：`RemoteAccessAuthorizer.check` 走 `scopeFor(permission)`，`management` 类别要求视图里含 `management` scope（`core/src/remote_authorization.cj:166`）。缺的从来不是判定，而是「视图里的 scope 从哪来」。

所以这里有两个选择：另造一套授予机制（环境变量白名单之类），或者把处理器的授权输入统一成 `DeviceAuthzView` 然后停住。选后者，因为前者会与那条线**在同一语义上撞车**（两条互不相干的 scope 授予通道，比一条没有更难审）。本批保证的是「视图里没有 management 就一步都不执行」，等记录级 scope 落地时，视图带着它进来，处理器不用改。

## 2. 处理器：三步顺序与两处语义诚实

`apps/daemon/src/remote_management.cj`：

1. **先核管理权**（`requireManagement`）。顺序是钉子：未授权时若先去查目标存不存在，应答本身就成了设备清单的可枚举探针。
2. **再挡空目标**（`revoke-target-invalid`）。空串是最危险的「未知目标」——把它当成「没指定就全撤」，一次参数缺失就能废掉整台实例，这正是批次 K 在撤销那条线上抓过的事故半径形状。所以空目标单独归因，不与 `revoke-target-unknown` 混用。
3. **最后才动存储**，且只有真撤动了才落盘。

两处与本机入口**故意不同**的语义，都写进了注释与用例：

- 目标设备号**不设长度上限**。它由登记时的 `deviceName` 拼出，客户端给多长就多长；在这里加一个上限会造出一台「RPC 面撤不掉」的设备，那比回显一个长串更糟。回显走 `jsonEscapeText`，注入不了结构。
- 落盘失败不回 78。本机入口操作的是从快照读出来的一次性副本，落盘失败时磁盘与内存都没变，可以直接宣告失败；RPC 操作的是**在跑的 store**——撤销当场生效，落盘失败意味着「重启后这台设备会复活」。所以把结果如实带在应答里（`persisted:false`），而**没配快照路径时干脆不出这个键**：「没配持久化」既不等于「已持久」也不等于「写失败」，硬塞一个 `true` 是谎。

`auth/devices` 只投影 `DeviceSummary` 的四项（deviceId/principalId/kind/revoked）——凭据原文与摘要在类型上就取不到，不是靠这里记得过滤；已撤销设备**照旧列出并标 `revoked:true`**，否则用户在自己设备的管理面上看不见自己撤销过什么。

## 3. 读数

### cj 侧（`apps/daemon`，`cjpm test`，TMP 每轮唯一）

| 轮 | TOTAL | PASSED | ERROR | FAILED | rc |
| --- | --- | --- | --- | --- | --- |
| 红灯（只写测试，未实现） | — | — | — | — | 1（`error: undeclared identifier 'RemoteManagementService'` × 8，编译阶段就红） |
| 实现后 | 176 | 174 | 0 | 2 | 1 |
| 变异还原后重跑 | 176 | 174 | 0 | 2 | 1（与实现后逐数相同） |

计数从上一批的 167 涨到 176，正好是本批新增的 9 条用例；`FAILED 2` 仍是并发会话那两条 scope 用例，名字逐字未变。9 条里 8 条首跑即绿，1 条红——那条红是**我的断言写错了**，不是实现错，见第 5 节。

### wire 侧（`apps/daemon/test/remote-management-rpc.test.mjs`，5 条）

`# tests 5 / pass 5 / fail 0 / cancelled 0 / rc=0`。内容：契约两行的权限类别与 `requiredScope` 与归属键；未认证只拿认证拒因；认证但无管理权拿 `-32001 scope-required`（并用错误码把「方法不存在」与「缺管理权」钉开）；无权限时存在与不存在的目标应答**逐字相同**；拒绝落审计且 who 可辨、不含凭据原文与 `Bearer`。

**wire 侧没有独立的红灯阶段**（这 5 条写在实现之后），它们的有效性由变异轮回答——而变异轮给出的答案并不漂亮，见下一节。

### 全量 daemon Node 回归（工作区态）

`# tests 117 / pass 102 / fail 15 / cancelled 0 / skipped 0`（上一批基线 112/97/15）。+5 全绿、红条数与构成不变：11 条 `host-proxy` + 3 条 `team-host`（并发会话在飞的 `host_proxy.cj`）+ 1 条批次 K 保留的撤销事故半径。契约套（`remote-capability-contract.test.mjs`）在把两条 anchor 从「拟新增」改成实名文件后仍通过——`DAEMON_LOCAL` 早就把这两个方法算作 daemon 自有，推导集不受影响。

## 4. 变异反证，以及本批最该留的一条

| 变异 | 改法 | 受害用例 | 结果 |
| --- | --- | --- | --- |
| O-M1 | `requireManagement` 恒回「允许」 | `devicesJsonRequiresManagementAndNeverLeaksDigestOrCredential`、`managementHandlersDenyBeforeReadingTargetSoUnauthzCannotProbeDeviceList` | **被抓** |
| O-M2 | 删掉空目标那道挡 | `revokeEmptyTargetIsRejectedWithoutTouchingStore`（它会落进 unknown 而不是 invalid） | **被抓** |
| O-M3 | `persistedFlag` 写死 `"true"`（连 `saveSnapshot` 调用一起没了） | `revokeReportsPersistedFalseWhenSnapshotWriteFails` + `revokeMarksOnlyTargetAndPersistsSnapshot`（快照文件压根没建） | **被抓** |

O-M1+M2+M3 同轮施加：`TOTAL 176 / PASSED 169 / ERROR 0 / FAILED 7`，红集 = 上面 5 条 + 并发会话那 2 条，逐条对得上，没有来路不明的红。

**O-M4 是这批最值得记的一条。** 把 `daemon.cj` 里那条分派支摘掉（条件换成永不命中的方法名），重建 exe 后跑那 5 条 wire 用例：**5/5 全绿**。原因不是用例坏，而是**今天的 wire 路径根本走不到分派支**——门禁在 `gate.check` 就用 `scope-required` 拒掉了，处理器与分派支一次都没被调用。于是这 5 条钉的是「管理面的失败闭合姿态」，**不是**「分派把方法接到了处理器上」。分派半的真实覆盖要等 scope 来源落地才会出现在 wire 上；在那之前，谁把分派支删掉，wire 套不会响。这条限制写在这里，别让「wire 5/5 绿」被读成「端到端已验通」。

还原自证：`逐字一致 => true`（两个被改文件都与备份一致）、终还原 `build rc=0`。另外记一笔工具自身的假信号：脚本里那个 `which()` 探针用 `MGMT_ERR_TARGET_INVALID}" }` 判断 M2 是否在位，而真实文本里那段带转义引号（`INVALID}\"}" }`），所以探针**恒报 m2:true**——差点被我读成「没还原干净」。能定案的只有「与备份逐字一致」那条断言，字符串探针只当线索用。

## 5. 我自己写错的一条断言（按键名判取值）

`revokeMarksOnlyTargetAndPersistsSnapshot` 首跑红在
`Expect Failed: ((text.indexOf("credential") ?? -1) == -1)`。
实现没错——快照的键名本来就叫 **`credentialDigest`**，那是设计要求的存储形态（凭据只存摘要）。我拿「不含 credential 这个子串」去表达「不含凭据」，等于把合法键名当成违禁内容。改法是断言换成三件真事实：快照里含 `credentialDigest`、**不含两台设备的凭据原文**（`credA`/`credB`），且清单里两台设备都读得出。`auth/devices` 那面仍保留「整段应答不含 credential 子串」——那里我们完全控制投影，键名也是要审的一部分。

## 6. 本批没做的事

- **scope 的来源**（第 1 节）。连带地：分派支在 wire 上不可达，O-M4 已证明这一点。
- **能力宣告没动**。`initialize` 仍只列 `initialize`/`session/catalog`/`session/events`（加团队与代理代理的那几条），`auth/devices`、`auth/revoke` 不在其中。加进去等于向所有客户端宣告一条今天只有管理权设备能用的方法，而宣告位与实际可达性的关系本身还挂在「protocolVersion 仍是 0.1」那行未对上。
- **`auth/rotate`**（契约里第三件管理动作，批次 G 原始任务名里就带着它）仍未实现，且它比 revoke 更依赖那条 scope 线——轮换要写凭据摘要，正落在并发会话改的那段代码里。
- **撤销动作的目标设备号不落审计**。规格 §5 列的审计字段里没有「目标」，要加就是扩面（并得同时进净化与脱敏链），单独立批；今天的拒因是固定词表，审计里能看出「这台设备试了 auth/revoke」，看不出它对哪个目标。
- 桌面/移动消费方还没有接这两个 RPC（桌面那条线整体由并发会话持有）。
