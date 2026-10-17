// 发布载荷完整性守卫（2026-10-17）：
// 检查一个 electron-builder unpacked 目录是否带齐运行所需资源——
// 缺 CA 锚、缺启动 DLL、缺 computer-use 载荷、缺 zoneinfo 等问题
// 在「发布前」机械可查，不靠用户打开后踩到。
//
// 与 check_artifact_placement.cjs 的区别：那个查「仓内产物落点」，这个查「分发载荷闭包」。
// 这个守卫按需运行（--dir=<unpacked> 或默认候选），无候选时 SKIP 而非红——
// 不像放置守卫那样默认必跑。
//
// 用法：
//   node scripts/check-release-manifest.mjs                  # 检查默认候选 apps/desktop/dist/electron/win-unpacked
//   node scripts/check-release-manifest.mjs --dir=<路径>     # 检查指定 unpacked 目录
//   node scripts/check-release-manifest.mjs --selftest      # 反证：fixture 注入缺件看能否抓到
const { existsSync, statSync, mkdirSync, writeFileSync, rmSync, mkdtempSync } = require("node:fs");
const { join } = require("node:path");
const os = require("node:os");

// Windows 启动必需 DLL 闭包（来自 AGENTS.md「issue #725 自研绕过」与 docs/plans/windows-dependency-and-compatibility §3）。
// 缺任一 → 剥掉 SDK PATH 后入口 0xC0000135。
const REQUIRED_WIN_DLLS = [
  "libboundscheck.dll",
  "libcangjie-runtime.dll",
  "libwinpthread-1.dll",
  "libcrypto-3-x64.dll",
  "libssl-3-x64.dll",
];

const checks = [];
function check(name, ok, detail) { checks.push({ name, ok, detail }); }

function platformOf(resourcesDir) {
  const hostBin = join(resourcesDir, "host", "bin");
  if (existsSync(join(hostBin, "sacode-host.exe"))) return "win32";
  if (existsSync(join(hostBin, "sacode-host"))) return "posix";
  return "unknown";
}

function audit(unpackedDir) {
  const resources = join(unpackedDir, "resources");
  if (!existsSync(resources)) {
    check("resources-dir", false, `resources/ 不存在（${resources}）——这不是 unpacked 目录？`);
    return;
  }
  check("resources-dir", true, "resources/ 存在");

  // app.asar：渲染层打包产物，缺失或过小说明打包不完整。
  const asar = join(resources, "app.asar");
  {
    const ok = existsSync(asar) && statSync(asar).size > 1024 * 1024;
    check("app.asar", ok, ok ? `${Math.round(statSync(asar).size / 1024 / 1024 * 10) / 10}MB` : "缺失或 <1MB（打包不完整）");
  }

  const hostBin = join(resources, "host", "bin");
  const plat = platformOf(resources);
  if (plat === "unknown") {
    check("host-exe", false, "host/bin 下既无 sacode-host.exe 也无 sacode-host——Host 未随包");
    return;
  }
  const hostName = plat === "win32" ? "sacode-host.exe" : "sacode-host";
  {
    const p = join(hostBin, hostName);
    const ok = existsSync(p);
    check("host-exe", ok, ok ? `${hostName} (${Math.round(statSync(p).size / 1024 / 1024 * 100) / 100}MB)` : `${hostName} 缺失`);
  }

  // CA 信任锚：随包 libssl 默认证书库为空，不带锚时 HTTPS 可能塌成 http-request-error
  // （10-11 TLS audit）。这台机器巧合能通不等于干净机器能通。
  {
    const ca = join(hostBin, "ca-bundle.pem");
    const ok = existsSync(ca) && statSync(ca).size > 1024;
    check("ca-bundle", ok, ok ? `${Math.round(statSync(ca).size / 1024)}KB` : "缺失或 <1KB（干净机器 HTTPS 可能全挂）");
  }

  // Windows 启动必需 DLL 闭包
  if (plat === "win32") {
    for (const dll of REQUIRED_WIN_DLLS) {
      const ok = existsSync(join(hostBin, dll));
      check(`dll:${dll}`, ok, ok ? "在" : "缺失（剥 SDK PATH 后 0xC0000135）");
    }
  }

  // 命名时区：Windows 无 zoneinfo 系统数据，不带 628 TZif 则 Asia/Shanghai 保存被拒
  {
    const ok = existsSync(join(hostBin, "zoneinfo", "Asia", "Shanghai"));
    check("zoneinfo-asia-shanghai", ok, ok ? "在" : "缺失（命名时区保存被拒）");
  }

  // 电脑控制载荷：F14 页面工具执行依赖；缺则 computer-use 不能宣称可用
  {
    const provider = join(resources, "computer-use", "provider.mjs");
    const nodeName = plat === "win32" ? "node.exe" : "node";
    const node = join(resources, "computer-use", nodeName);
    const okP = existsSync(provider);
    const okN = existsSync(node);
    check("computer-use-provider", okP, okP ? "在" : "缺失（F14 电脑控制不可用）");
    check(`computer-use-${nodeName}`, okN, okN ? "在" : "缺失（F14 电脑控制不可用）");
  }
}

function report() {
  const failed = checks.filter((c) => !c.ok);
  for (const c of checks) console.log(`${c.ok ? "OK  " : "FAIL"} ${c.name}: ${c.detail}`);
  const skipped = checks.length === 0;
  if (skipped) {
    console.log("MANIFEST: SKIP（无 unpacked 目录可查；用 --dir=<路径> 指定）");
    return 0;
  }
  console.log(`MANIFEST: ${failed.length ? "FAIL" : "PASS"} (${checks.length} checks, fail=${failed.length})`);
  return failed.length ? 1 : 0;
}

function buildGoodFixture(base) {
  // 构造一个「齐全」的 unpacked 骨架；selftest 在此基础上逐项删件看能否被抓。
  const r = join(base, "resources");
  const hostBin = join(r, "host", "bin");
  const dirs = [r, hostBin, join(hostBin, "zoneinfo", "Asia"), join(r, "computer-use")];
  for (const d of dirs) mkdirSync(d, { recursive: true });
  writeFileSync(join(r, "app.asar"), Buffer.alloc(2 * 1024 * 1024));
  writeFileSync(join(hostBin, "sacode-host.exe"), Buffer.alloc(1024));
  writeFileSync(join(hostBin, "ca-bundle.pem"), Buffer.alloc(4096));
  for (const dll of REQUIRED_WIN_DLLS) writeFileSync(join(hostBin, dll), Buffer.alloc(1024));
  writeFileSync(join(hostBin, "zoneinfo", "Asia", "Shanghai"), Buffer.alloc(64));
  writeFileSync(join(r, "computer-use", "provider.mjs"), "export{}");
  writeFileSync(join(r, "computer-use", "node.exe"), Buffer.alloc(1024));
}

function selftest() {
  const probes = [
    ["app.asar", (b) => { try { rmSync(join(b, "resources", "app.asar")); } catch {} }],
    ["ca-bundle", (b) => { try { rmSync(join(b, "resources", "host", "bin", "ca-bundle.pem")); } catch {} }],
    ["dll:libwinpthread-1.dll", (b) => { try { rmSync(join(b, "resources", "host", "bin", "libwinpthread-1.dll")); } catch {} }],
    ["zoneinfo-asia-shanghai", (b) => { try { rmSync(join(b, "resources", "host", "bin", "zoneinfo", "Asia", "Shanghai")); } catch {} }],
    ["computer-use-provider", (b) => { try { rmSync(join(b, "resources", "computer-use", "provider.mjs")); } catch {} }],
    ["computer-use-node.exe", (b) => { try { rmSync(join(b, "resources", "computer-use", "node.exe")); } catch {} }],
  ];
  let missed = 0;
  for (const [target, mutate] of probes) {
    const base = mkdtempSync(join(os.tmpdir(), "release-manifest-selftest-"));
    try {
      buildGoodFixture(base);
      mutate(base);
      checks.length = 0;
      audit(base);
      const hit = checks.filter((c) => !c.ok).map((c) => c.name);
      if (hit.includes(target)) console.log(`CAUGHT ${target} -> ${hit.join(",")}`);
      else { console.log(`MISSED ${target} -> FAIL 集为 [${hit.join(",")}]`); missed++; }
    } catch (e) {
      console.log(`MISSED ${target} (异常: ${e.message})`); missed++;
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  }
  // 基线：齐全 fixture 应全绿
  const base = mkdtempSync(join(os.tmpdir(), "release-manifest-selftest-"));
  let baselineGreen = false;
  try {
    buildGoodFixture(base);
    checks.length = 0;
    audit(base);
    baselineGreen = checks.every((c) => c.ok);
  } catch (e) {
    console.log(`基线异常: ${e.message}`);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
  console.log(`SELFTEST: ${missed === 0 && baselineGreen ? "PASS" : "FAIL"} (probes=${probes.length}, missed=${missed}, baseline=${baselineGreen ? "green" : "RED"})`);
  return missed === 0 && baselineGreen ? 0 : 1;
}

const args = process.argv.slice(2);
if (args.includes("--selftest")) {
  process.exitCode = selftest();
} else {
  const dirArg = args.find((a) => a.startsWith("--dir="));
  const candidate = dirArg ? dirArg.slice("--dir=".length) : join(__dirname, "..", "apps", "desktop", "dist", "electron", "win-unpacked");
  if (!existsSync(candidate)) {
    console.log(`MANIFEST: SKIP（候选 ${candidate} 不存在；用 --dir=<unpacked 路径> 指定）`);
  } else {
    try { audit(candidate); } catch (e) {
      console.log(`MANIFEST: FAIL (取数失败: ${e.message})`);
      process.exitCode = 1;
    }
    if (checks.length) process.exitCode = report();
  }
}
