// 独立验收一份「同包服务交付」：清单说的每一件事都必须在盘上成立，反过来盘上的每个
// 可执行文件也必须在清单里。两个方向都要查——只查前者的话，包里混一颗旧产物照样绿。
// 输出是逐条 PASS/FAIL 加末行计数，退出码由「失败条数」决定而不是「第一条是否失败」决定，
// 免得一项红把后面几项的检查静默掉。
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, resolve, dirname, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";

// 清单里的路径一律用 / 分隔（跨平台可核对），所以这里的常量也必须是 /，
// 不能用 join 的结果——Windows 上 join 给的是反斜杠，会把清单自己当成「盘上有但没登记」。
const MANIFEST = "bin/service-manifest.json";
const REQUIRED_ROLES = ["cli", "host", "daemon", "extensionHost"];
// 运行态与秘密绝不进包：身份文件、审计日志、幂等账、私钥/证书。
// 按 basename 后缀判而不是按子串判，否则 sacode-daemon.exe 这种合法名字会被误杀。
const DENIED_SUFFIXES = [".pem", ".key", ".id", ".audit.log", ".ledger.jsonl", ".devices.json"];
const DENIED_BASENAMES = ["service-manifest.json.bak"];

function usage() {
  console.error("用法：node scripts/verify-service-package.mjs <包目录>");
  process.exit(2);
}
const target = process.argv[2];
if (!target) usage();
const rootDir = resolve(process.argv[2]);

const failures = [];
const notes = [];
let checksRun = 0;
function check(name, body) {
  checksRun += 1;
  const problems = body();
  if (problems.length === 0) {
    console.log(`PASS ${name}`);
    return true;
  }
  console.log(`FAIL ${name}: ${problems.join("; ")}`);
  failures.push(name);
  return false;
}
function p(msg) { return [msg]; }

const manifestPath = join(rootDir, MANIFEST);
let manifest = null;
if (!check("manifest-readable", () => {
  if (!existsSync(manifestPath)) return p(`缺清单 ${MANIFEST}`);
  try { manifest = JSON.parse(readFileSync(manifestPath, "utf8")); } catch (e) { return p(`清单不是合法 JSON：${e.message}`); }
  if (manifest.schemaVersion !== 1) return p(`不支持的 schemaVersion ${manifest.schemaVersion}`);
  if (!/^[0-9a-f]{40}$/.test(String(manifest.gitSha || ""))) return p(`gitSha 形状不对：${manifest.gitSha}`);
  if (!Array.isArray(manifest.files)) return p("files 不是数组");
  return [];
})) {
  // 清单读不出来，后面每一条检查都没有依据；但仍然是「执行过并判红」，不是静默退出。
  console.log(`checks=${checksRun} failed=${failures.length} files=${0}`);
  process.exit(1);
}

check("required-roles", () => REQUIRED_ROLES.filter(r => !manifest.roles?.[r]).map(r => `缺角色 ${r}`));
check("role-targets-listed", () => REQUIRED_ROLES
  .filter(r => manifest.roles?.[r])
  .filter(r => !manifest.files.some(f => f.path === manifest.roles[r]))
  .map(r => `角色 ${r} 指向的 ${manifest.roles[r]} 不在文件清单里`));
check("entry-paths-safe", () => manifest.files.flatMap(f => {
  const bad = [];
  if (isAbsolute(f.path) || /^[A-Za-z]:[\\/]/.test(f.path)) bad.push(`绝对路径 ${f.path}`);
  if (f.path.split(/[\\/]/).includes("..")) bad.push(`越出库根 ${f.path}`);
  if (f.path.includes("\\")) bad.push(`路径分隔符不是 /：${f.path}`);
  return bad;
}));
check("secret-and-state-denied", () => manifest.files.flatMap(f => {
  const base = f.path.split("/").pop();
  const bad = [];
  if (DENIED_SUFFIXES.some(s => base.endsWith(s))) bad.push(`清单带了运行态或密钥文件 ${f.path}`);
  if (DENIED_BASENAMES.includes(base)) bad.push(`清单带了 ${f.path}`);
  return bad;
}));
check("files-exist", () => manifest.files.filter(f => !existsSync(join(rootDir, f.path))).map(f => `缺文件 ${f.path}`));
check("file-sizes", () => manifest.files.flatMap(f => {
  const abs = join(rootDir, f.path);
  if (!existsSync(abs)) return [];
  const size = statSync(abs).size;
  return size === f.bytes ? [] : p(`${f.path} 字节数 ${size} 与清单 ${f.bytes} 不符`);
}));
check("file-digests", () => manifest.files.flatMap(f => {
  const abs = join(rootDir, f.path);
  if (!existsSync(abs)) return [];
  const digest = createHash("sha256").update(readFileSync(abs)).digest("hex");
  return digest === f.sha256 ? [] : p(`${f.path} 摘要 ${digest.slice(0, 12)} 与清单 ${f.sha256.slice(0, 12)} 不符`);
}));
check("runtime-library-present", () => manifest.files.some(f => f.kind === "runtime-library")
  ? [] : p("清单里没有任何运行期库，剥掉 SDK 后包起不来"));
check("executable-kinds-known", () => manifest.files.filter(f => f.kind === "other").map(f => `分类不明 ${f.path}`));

// 反方向：盘上有、清单没写 = 未登记的二进制。这是旧产物混进包的唯一静默通道。
function walk(dir, prefix) {
  const acc = [];
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const rel = `${prefix}/${entry.name}`;
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) acc.push(...walk(abs, rel));
    else acc.push(rel);
  }
  return acc;
}
check("no-unlisted-payload", () => {
  const listed = new Set(manifest.files.map(f => f.path));
  const onDisk = [];
  for (const sub of ["bin", "extjs"]) {
    const abs = join(rootDir, sub);
    if (existsSync(abs)) onDisk.push(...walk(abs, sub));
  }
  const extras = onDisk.filter(rel => rel !== MANIFEST && !listed.has(rel));
  return extras.map(rel => `盘上有但清单没登记：${rel}`);
});
notes.push(`platform=${manifest.platform} arch=${manifest.arch} gitSha=${String(manifest.gitSha).slice(0, 7)}`);

console.log(notes.map(n => `note ${n}`).join("\n"));
console.log(`checks=${checksRun} failed=${failures.length} files=${manifest.files.length}`);
process.exit(failures.length === 0 ? 0 : 1);
