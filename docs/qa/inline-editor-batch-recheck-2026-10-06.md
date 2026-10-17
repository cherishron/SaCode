# 第一批上游修复（`b81dae2` 内联编辑器）独立复核 + 9 条宿主红归因（I／W80，2026-10-06）

对象：`docs/evidence/dsh-upstream-fix-inline-editor-2026-10-06.md`。取证据形态：**工作区态**（主工作区 `apps/desktop`，`apps/desktop/test/*` 本批无在飞改动；core 侧此刻有别人的 ` M core/src/bu_exec.cj`，与桌面用例无关）。私有 `TMP/TEMP/TMPDIR`。

## 1. 定向读数：复现

按文档给的同一行命令、同一 cwd 原样执行：

```
node --test test/inline-editor.test.mjs test/inline-editor-render.test.mjs \
            test/goal-bar.test.mjs test/page-sources-parse.test.mjs \
            test/renderer-bundle-guard.test.mjs
```

实测 `# tests 15 / # pass 15 / # fail 0 / # cancelled 0 / # skipped 0`，`rc=0`。⇒ 该批「15/15」的**渲染层定向断言成立**，含真实 Electron 那条（offscreen + 独立 user-data + CSP `script-src 'self'`）与「去掉 ResizeObserver 就转红」的变异反证。**但这 15 条不碰 core**，所以它既不代表 core 可编，也不代表队列后端可验。

## 2. 那 9 条宿主红：复现了失败名，没复现出他们的分母

同一台机器、同一枚 `dist/host/bin/sacode-host.exe`，把三个队列 suite 换**私有 TMP** 复跑：

| 读数 | 他们的记录 | 本批复跑 |
|---|---|---|
| 命令 | `message-queue` + `queue-reference` + `queue-attachment` | 同 |
| 计数 | 21 tests / **12 pass** / 9 fail，rc=1 | **9 tests / 0 pass / 9 fail** |

**9 条失败名逐条相同**（排队 id 铸造、不幂等、落盘后换进程仍在、轮次边界恰好一条、步边界送进下一次请求、非图片模型拒历史图片、带图排队落引用、送达前删掉即作废、投影返回持久引用）。但**通过数没复现出来**：我这轮每个文件都在更早的位置就断了，总测试数只有 9。⇒ 不许写「与他们一致」；能写的只有「红集合一致，绿集合我比他们更少」。另外他们文档给的失败成因线索（系统 Temp 下目录创建被拒）在我这里**只成立了一半**：换成私有 TMP 后这 9 条照红，所以 Temp 不是唯一前提，而真正的原因被上一节那个丢原文的 catch 抹平了。

## 3. 真因：宿主把「环境读不到设置」伪装成「请求不合契约」

每条失败的 `error` 都是 `-32602 bad-send-policy`，栈顶在 `host-bridge.cjs` 收到宿主响应处。读宿主源码，`apps/host/src/main.cj:1260-1270` 的形状是：

```cangjie
try {
    let params = JsonValue.fromStr(body).asObject().get("params")...   // 请求形状
    let preference = GlobalAppearanceSettings.forUser().read().busySend // 环境/设置
    sendMode = GlobalAppearanceSettings.sendMode(preference, turnBusy, accelerated)
} catch (e: Exception) { emit(errFrame(idText, -32602, "bad-send-policy")) }
```

**一个 catch 罩住两类完全不同的错**：请求不合契约（客户端的错，`-32602` 名副其实）与 `forUser()` 抛的环境异常。而更麻烦的是**这一句把底层异常原文丢了** —— 相邻分支都写 `errFrame(idText, code, e.message)`，只有这里写死 `"bad-send-policy"`，于是线上读到的只是一个契约码，`settings-home-unavailable` / `settings-root-not-absolute` / `Directory.create` 被拒 **三种环境错在协议面上长得一模一样**。

**先纠正我自己的一条推测**：我一度判断「差异在于队列夹具没固定设置主目录」—— 查了才发现三份夹具**都注入了** `SACODE_USER_SETTINGS_DIR`（`message-queue.test.mjs`、`queue-reference.test.mjs`、`queue-attachment.test.mjs` 各自 `new HostBridge(HOST, { ...process.env, SACODE_USER_SETTINGS_DIR: join(dir,'settings') })`），与 `attachment-*` 系列同一套既有约定。所以「缺注入」这个解释**不成立**，撤回。剩下能证的是两件事：① 该分支合并两类错并丢掉原因，**现有输出无法判定这 9 条到底属于哪一类**（他们文档里「settings / attachments 目录创建被拒」的观察与环境分支相容，但不是我这轮直接测到的）；② 私有 TMP 换不掉这 9 条红，所以 Temp 不是唯一前提。

**可执行的解锁动作（不改语义、只让归因 possible）**：把这一处改成携带底层原因（`errFrame(idText, -32602, "bad-send-policy: ${e.message}")`，或给环境错单开一个码），下一跑就能直接从线上分清是请求形状还是设置目录；这属 `apps/host/src/main.cj`（A 名下公共入口），我不代改。

## 4. 同批观察：固定提交此刻仍编不出来（本批复核的边界条件）

`git show HEAD:core/src/bu_exec.cj` 第 74 行仍是 `MonoTime.now().toNanoseconds()`（该成员在 cjc 1.1.3 不存在，实测 1 error → `failed to compile package core` → **无 Summary**）。修复只在**未提交**的工作区编辑里，且改成了 `(now - now).toSeconds()`：编译错误消失，但两次独立采样相减恒≈0，而该函数要给 `core-bu-userdata-<stamp>` 一个唯一目录名。同文件 `:81/:159` 已有可用形态 `(MonoTime.now() - started).toMilliseconds()`（先存锚点）。另两处半批形态被 `node docs/qa/check-inflight-ownership.cjs` 当场抓住：`core/src/cu_exec.cj` 与 `core/src/cu_exec_test.cj` **至今未跟踪**而同名兄弟 `bu_exec.cj` 已进提交；`core/cb2.txt` 又一份未忽略的 cjpm 转储。

⇒ 「15/15 通过」与「core 编不出来」**同时为真**，两者不矛盾（前者不依赖 core）。本批所有桌面读数都必须带这个前提去读：宿主二进制无法从当前提交重打，任何宿主侧红/绿都不是固定提交的证据。

## 5. 本批判据

第一批吸收的渲染层定向断言 **PASS（15/15 rc=0，命令原样复跑，含真实 Electron 与变异反证）**；9 条宿主红的**失败名复现 PASS、分母复现 FAIL（9/0 对 21/12）**；「系统 Temp 是唯一成因」**FAIL（私有 TMP 下照红）**；宿主 `-32602` 归因失真 **FAIL（一个 catch 合并请求契约错与环境错，且写死文案丢掉 `e.message`，`apps/host/src/main.cj:1260-1270`）**；「这 9 条属于两类中的哪一类」**BLOCKED（现有协议面分辨不出；解锁动作=该分支带上底层原因，属 A 名下宿主公共入口，我不代改）**；我先前「队列夹具缺 `SACODE_USER_SETTINGS_DIR` 注入」的推测 **已撤回（三份夹具都注入了，与 `attachment-*` 同一约定）**；固定提交 core 编译 **FAIL（`bu_exec.cj:74`，无 Summary，属「根本没跑」第三态）**；宿主产物不可重打 **BLOCKED（前提=core 编译回绿）**。
