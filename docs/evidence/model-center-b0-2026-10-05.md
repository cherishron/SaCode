# 模型中心 B0 密码学面探针现场（2026-10-05）

对应规格 `docs/superpowers/specs/2026-10-05-model-center-design.md` §15 的 B0 ①② 两条，
以及 §8.2 选定的迁移包构造（PBKDF2-HMAC-SHA256 + SM4-CTR + HMAC-SHA256 的 encrypt-then-MAC）。

本文件的存在理由：规格原先只写「证据在 gitignore 的 `target/b0/`」，评审的人复现不了。
这里把**复跑命令、原样输出、逐字节比对**落成入库件。探针代码本身仍留在 `target/b0/`
（不进产品源码），本文件只登记现场与判读。

## 环境（本次实测）

| 项 | 值 |
| --- | --- |
| Cangjie | `Cangjie Compiler: 1.1.3 (cjnative)` / `Target: x86_64-w64-mingw32` |
| stdx | `1.1.3.1`，`windows_x86_64_cjnative/dynamic/stdx`（经 `cjpm.toml` 的 `path-option`） |
| Node | `v22.23.2`（对照面：`crypto`） |
| OpenSSL | 命令行可用；`libcrypto-3-x64.dll` 本机有两颗（`/mingw64/bin` 为 3.5.4），排查版本问题须钉目录 |
| 平台 | Windows 10.0.26300 / x64 / Git Bash |

## 复跑命令

```bash
cd /d/Project/sa/saai/sa-code/target/b0
cjpm build > build.log 2>&1; echo "rc=$?"          # 期望末行 cjpm build success、rc=0
cd target/release/bin
CJH="/d/Program Files/HuaWei/Cangjie"
SD="/c/Users/jingg/stdx-work/stdx-1.1.3.1/windows_x86_64_cjnative/dynamic/stdx"
export PATH="$CJH/bin/runtime:$CJH/bin/lib/std:$SD:$PATH"
./main.exe                                          # 按 ^PASS/^FAIL/^SKIP 计数
cd /d/Project/sa/saai/sa-code/target/b0 && node oracle.cjs
```

> 裸跑 `main.exe` 必须把 stdx 与 runtime 目录加进 `PATH`，且要 **POSIX 形式**（`/c/...`），
> 写成 `C:/...` 不生效——否则会拿到 `libstdx.*.dll` 缺失的 rc=127，那是环境问题不是结论。

## 探针原样输出（本次重跑，rc=0）

```text
PASS cipher-cbc-encrypt | enc=32 plain=31
PASS cipher-cbc-roundtrip | back=31
PASS cipher-ctr-encrypt | enc=31 plain=31
PASS cipher-ctr-roundtrip | back=31
FAIL gcm-iv12-aad-tag16 | 抛出 Encrypt failed due to create tag error.
FAIL gcm-iv12-noaad-tag16 | 抛出 Encrypt failed due to create tag error.
FAIL gcm-iv16-aad-tag16 | 抛出 Encrypt failed due to create tag error.
FAIL gcm-iv12-aad-tag12 | 抛出 Encrypt failed due to create tag error.
SKIP gcm-tamper/aad (无可用密文: Encrypt failed due to create tag error.)
HEX etm-encKey a29978a5494a4a948542f0f3efe32d58
HEX etm-ct b1ebc0d73303e40c3fd93a36c5ca4d9074cf1e5fa6a067aa01ad089ec808ba
HEX etm-tag 31f73b01ecb866c3697674841a9d60c8091be0e1f225ffdd55d6adef5d0c36c5
PASS etm-ciphertext-shape | ct=31 plain=31 tag=32
PASS etm-roundtrip
PASS etm-tamper-ct-rejected
PASS etm-tamper-header-rejected
PASS etm-wrong-passphrase-rejected
PASS etm-tamper-iv-rejected
HEX hmac f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8
HEX pbkdf2-2 3e915a8b575707d72fe3dfd731e8fb5d050ac4922d31fd8bd05cd592df666e9e
HEX pbkdf2-4096 c5e478d59288c841aa530db6845c4c8d962893a001ce4e11a4963873aa98134a
HEX pbkdf2-1-len40 051e945b44155846de9d879b8c062eee1f5fc6ef37e33c8a8ee0a770d45be8da441d1113172e4b85
PASS securerandom-nextbytes | salt[0]=183
```

计数：**PASS 11 / FAIL 4 / SKIP 1**（4 条 FAIL 全属 `SM4-GCM` 构造本身，1 条 SKIP 是因为 GCM 拿不出密文，无法再做篡改分支）。

## Node 对照面输出

```text
hmac f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8
pbkdf2-2 3e915a8b575707d72fe3dfd731e8fb5d050ac4922d31fd8bd05cd592df666e9e
pbkdf2-4096 c5e478d59288c841aa530db6845c4c8d962893a001ce4e11a4963873aa98134a
pbkdf2-1-len40 051e945b44155846de9d879b8c062eee1f5fc6ef37e33c8a8ee0a770d45be8da441d1113172e4b85
openssl false | sm4 变体: sm4,sm4-cbc,sm4-cfb,sm4-ctr,sm4-ecb,sm4-ofb
```

### 逐字节比对（仓颉侧 vs Node `crypto` 侧）

| 向量 | 结果 |
| --- | --- |
| HMAC-SHA256 | **逐字节一致** |
| PBKDF2-HMAC-SHA256，c=2 | **逐字节一致** |
| PBKDF2-HMAC-SHA256，c=4096 | **逐字节一致** |
| PBKDF2-HMAC-SHA256，c=1、dkLen=40（跨多块） | **逐字节一致** |

自建 PBKDF2 是构建在 `stdx.crypto.digest` 的 `HMAC(key, HashType.SHA256)` 之上的，这四条向量就是它可替代「栈里没有现成 KDF」的依据。RFC 6070 形态的多块向量（`dkLen=40`）专门用来钉块间计数拼接，只测单块等于没测。

## SM4-GCM 不可用的归因（含一张容易取错的表）

```text
openssl list -cipher-algorithms | grep -i sm4-gcm
  { 1.2.156.10197.1.104.8, SM4-GCM } @ default        # 算法确实存在
openssl list -cipher-commands | grep -i sm4
  sm4-cbc  sm4-cfb  sm4-ctr  sm4-ecb  sm4-ofb          # 这里没有 sm4-gcm
```

**取错表的教训**：`cipher-commands` 只是 OpenSSL **CLI 子命令**名单，不是 provider 能力清单。
先前据它判「本机 OpenSSL 无 SM4-GCM」是错的。正确的归因链是：
1. `SM4-GCM @ default` 在 `cipher-algorithms` 里存在；
2. 把 OpenSSL 3.5.4 的 `libcrypto-3-x64.dll` 放进 exe 同目录（Windows DLL 搜索序第一位）仍复现失败；
3. `iv=12/16`、`aad` 有无、`tagSize=12/16` 四种组合一律 `Encrypt failed due to create tag error.`。

→ 归因于 **stdx 1.1.3.1 的 GCM 调用路径**，不是本机环境，也不是 OpenSSL 缺算法。我们改不了它。

## 判读与边界

- 迁移包按 §8.2 定形：**口令 PBKDF2 双上下文派生（`|enc` 出 16B SM4 密钥 / `|mac` 出 32B HMAC 密钥）+ SM4-CTR 保密 + HMAC-SHA256 覆盖 `头‖IV‖密文` 的 encrypt-then-MAC**，先验 MAC 再解密、定长时间比较。
- `etm-ciphertext-shape` 里 `ct=31 plain=31` 是 CTR 的特性（密钥流异或，不额外填充）；CBC 侧 `enc=32 plain=31` 正是分组填充的结果。两者都符合预期，不是矛盾。
- 对外表述纪律：**不得写成 AES-256**，如实写 128 位强度。
- 这些探针**不构成防回归**：`secret-bundle` 的正式实现要在 `core` 里按 §8.2 红先重写一遍，届时以 `core` 的 `*_test.cj` 用例为准；本文件只登记设计阶段选了哪条构造、以及为什么不是 GCM。
- 本文件不含任何口令/密钥材料：`etm-encKey`、`etm-tag` 等都是探针内**固定测试口令**派生出的值，测试口令本身不入库、不写在这里。

## 顺带修正的一处数字

规格里「Int64 微单位」的溢出上界原先写作「跨 10^13 元才溢出」。按 `Int64` 最大值
`9223372036854775807` 与 10^6 刻度算，真实上界是 **约 9.2234×10^12 元**（Node 复算：
`Number(9223372036854775807n)/1e6 = 9.2234e+12`），原先的写法把余量高估了约 8%。
B3 的溢出用例边界要以这个精确值取，不能拿 10^13 当上界——那会让边界值断言落在真实溢出点之外。
