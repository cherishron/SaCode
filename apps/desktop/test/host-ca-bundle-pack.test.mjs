import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, existsSync, readFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { caBundleSidecar } = require("../paths.cjs");

// 批次 A 只把「读锚」这条路打通（core/src/tls_roots.cj 按 SACODE_CA_BUNDLE → SSL_CERT_FILE → ~/.sacode 找锚，
// 壳层 paths.cjs 负责把 sidecar 路径写进宿主环境）。但没人产出那颗文件，
// 干净机器上随包 libssl 的默认证书库是空的，https 供应商仍会整批塌成传输错误。
// 所以打包链必须把锚放到宿主 exe 同目录，且放的位置只能由 paths.cjs 的查找规则定义——
// 两边各写各的字面量，早晚会漂。

const script = fileURLToPath(new URL("../../../scripts/pack-host.mjs", import.meta.url));
const ANCHOR = "-----BEGIN CERTIFICATE-----\nhVBM\n-----END CERTIFICATE-----\n";

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "sacode-pack-host-"));
  const exe = join(root, "main.exe");
  writeFileSync(exe, "MZ fake host binary");
  const dlls = join(root, "dlls");
  mkdirSync(dlls);
  // pack-host 只认 .dll 后缀，并硬要求这三颗运行库到位，否则拒绝出自包含包
  for (const f of ["libcrypto-3-x64.dll", "libssl-3-x64.dll", "libwinpthread-1.dll", "libcangjie-runtime.dll"]) {
    writeFileSync(join(dlls, f), "fake dll");
  }
  const anchor = join(root, "ca-bundle.pem");
  writeFileSync(anchor, ANCHOR);
  return { root, exe, dlls, anchor, out: join(root, "host") };
}

function pack({ exe, dlls, out }, extra = []) {
  return spawnSync(process.execPath, [script, exe, out, dlls, ...extra], { encoding: "utf8" });
}

test("给了 --ca-bundle 就把锚落到宿主 exe 同目录，位置与壳层查找规则一致", () => {
  const fx = fixture();
  const r = pack(fx, [`--ca-bundle=${fx.anchor}`]);
  assert.equal(r.status, 0, r.stderr);
  const packedExe = join(fx.out, "bin", "sacode-host.exe");
  // 断言的是「壳层会去哪儿找」而不是硬编码第二个文件名：两边一旦漂开这条就红
  assert.equal(caBundleSidecar(packedExe), join(fx.out, "bin", "ca-bundle.pem"));
  assert.ok(existsSync(caBundleSidecar(packedExe)), "sidecar 必须真的在壳层查找的那个位置");
  assert.equal(readFileSync(caBundleSidecar(packedExe), "utf8"), ANCHOR, "锚正文不能被打扰");
});

test("不传 --ca-bundle 时不凭空造锚文件", () => {
  const fx = fixture();
  const r = pack(fx);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(
    !existsSync(caBundleSidecar(join(fx.out, "bin", "sacode-host.exe"))),
    "造一个空的/假的锚会让核心以为锚已配置"
  );
});

// 这条是「先校验再动手」的钉子：pack-host 会整片 rmSync 输出目录，
// 要是锚路径写错了才失败，上一轮还能跑的宿主就被顺手删了。
test("锚路径不存在时立即失败，且不许先把上一轮产物清掉", () => {
  const fx = fixture();
  mkdirSync(join(fx.out, "bin"), { recursive: true });
  const sentinel = join(fx.out, "bin", "sacode-host.exe");
  writeFileSync(sentinel, "上一轮还能跑的宿主");

  const r = pack(fx, [`--ca-bundle=${join(fx.root, "nope.pem")}`]);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /信任锚/, `报错要指名是锚的问题，实际输出：${r.stderr}`);
  assert.ok(existsSync(sentinel), "校验必须发生在清理输出目录之前");
});
