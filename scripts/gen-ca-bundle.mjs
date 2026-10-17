// 把本机 Windows 信任根导出成 PEM，作为随包的 ca-bundle.pem。
//
// 为什么要随包锚（实测 2026-10-11，见 docs/evidence/2026-10-11-windows-tls-anchor-audit.md）：
// stdx 的默认校验走「运行时实际加载的那颗 libssl 自带的默认证书库」，随包 DLL 在干净机器上
// 那一份是空的；而 crypt32 的系统存储入口在仓颉进程里恒返回 NULL（同机 .NET 用同一个 API 能枚举
// 53 张），注册表 Blob 又是未文档复合结构。三条路只有「显式 PEM 锚」可测且确定，所以锚在打包机上
// 导出、随宿主 exe 同目录分发，核心只认 SACODE_CA_BUNDLE。
//
// 红线：一条锚都没有时拒绝产出文件——留下空 PEM 会让核心以为锚已配置。
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { spawnSync } from "node:child_process";

const USAGE =
  "用法: node scripts/gen-ca-bundle.mjs <输出pem路径> [--from-der-lines=<每行一条 base64 DER 的文件>]";

// PowerShell 侧只负责把两张存储里的证书原样吐成 base64 DER，一行一张；
// 去重与 PEM 封装都在这边做，方便离线入口共用同一条校验。
const PS_ENUMERATE = [
  "$ErrorActionPreference='Stop';",
  "foreach ($name in @('Root','AuthRoot')) {",
  "  $store = [System.Security.Cryptography.X509Certificates.X509Store]::new($name,'LocalMachine');",
  "  $store.Open('ReadOnly');",
  "  foreach ($cert in $store.Certificates) { [Convert]::ToBase64String($cert.RawData) };",
  "  $store.Close();",
  "}",
].join(" ");

function fromWindowsStores() {
  const r = spawnSync("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", PS_ENUMERATE], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (r.status !== 0) {
    console.error(`导出 Windows 信任根失败（rc=${r.status}）：${(r.stderr || r.stdout || "").trim()}`);
    process.exit(1);
  }
  return r.stdout;
}

const BASE64_LINE = /^[A-Za-z0-9+/]+={0,2}$/;

function toPem(lines) {
  const seen = new Set();
  const blocks = [];
  for (const line of lines) {
    if (!BASE64_LINE.test(line)) {
      console.error(`不是 base64 的 DER 记录，拒绝半截产出：[${line.slice(0, 24)}…]`);
      process.exit(1);
    }
    if (seen.has(line)) continue;
    seen.add(line);
    const body = [];
    for (let i = 0; i < line.length; i += 64) body.push(line.slice(i, i + 64));
    blocks.push(`-----BEGIN CERTIFICATE-----\n${body.join("\n")}\n-----END CERTIFICATE-----\n`);
  }
  if (blocks.length === 0) {
    console.error("没有可用的信任锚（0 张），拒绝产出空 PEM");
    process.exit(1);
  }
  return { pem: blocks.join(""), count: blocks.length };
}

const args = process.argv.slice(2);
const outPath = args.find((a) => !a.startsWith("--"));
if (!outPath) {
  console.error(USAGE);
  process.exit(2);
}
const offline = args.find((a) => a.startsWith("--from-der-lines="));
const raw = offline
  ? readFileSync(offline.slice("--from-der-lines=".length), "utf8")
  : fromWindowsStores();
const lines = raw.split(/\r?\n/).map((s) => s.trim()).filter((s) => s.length > 0);

const { pem, count } = toPem(lines);
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, pem);
console.log(`信任锚导出完成：${count} 张 → ${outPath}`);
