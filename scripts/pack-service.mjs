// 组装「同包服务交付」：一份目录里同时带 CLI、Host、daemon、扩展宿主与运行期库，
// 并产出一份可独立核验的清单（scripts/verify-service-package.mjs 读它）。
//
// 为什么运行期库不是这里说了算：哪几颗 DLL 进包、哪几颗是编译期专用，
// scripts/pack-cli.mjs 已经用「删掉能跑 / 删掉真依赖就炸」反证定过档。
// 这里只消费它的产物，不重抄一套规则——两份规则迟早会漂。
import { cpSync, mkdirSync, readdirSync, rmSync, existsSync, statSync, writeFileSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { selectedPlatform } from './platform.mjs';
const spec = selectedPlatform();

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MANIFEST = "bin/service-manifest.json";
const EXE_SUFFIX = spec.suffix;

function fail(msg) {
  console.error(`pack-service: ${msg}`);
  process.exit(2);
}

function opt(name, dflt) {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) return dflt;
  const value = process.argv[i + 1];
  if (!value || value.startsWith("--")) fail(`--${name} 缺值`);
  return resolve(ROOT, value);
}

const out = opt("out", null);
if (!out) fail("缺 --out <目录>：服务包必须显式给落点，不允许默认往仓库里写");
const base = opt("base", join(ROOT, "npm", `sacode-cli-${spec.target}`));

// 三个可执行文件与扩展宿主的来源。cli 与 extjs 取平台包（pack-cli 的产物），
// host 与 daemon 取各自的 cjpm 构建产物——同一个 workspace 里的同一批源码。
const inputs = {
  cli: opt("cli", join(base, "bin", `sacode${EXE_SUFFIX}`)),
  host: opt("host", join(ROOT, "apps", "host", "target", "release", "bin", `main${EXE_SUFFIX}`)),
  daemon: opt("daemon", join(ROOT, "apps", "daemon", "target", "release", "bin", `main${EXE_SUFFIX}`)),
  extjs: opt("extjs", join(base, "extjs")),
};
for (const [role, src] of Object.entries(inputs)) {
  if (!existsSync(src)) fail(`缺 ${role} 输入 ${src}（host/daemon 先跑对应目录的 cjpm build，cli 与 extjs 先跑 node scripts/pack-cli.mjs）`);
}
if (!statSync(inputs.extjs).isDirectory()) fail(`扩展宿主来源不是目录：${inputs.extjs}`);

const binDir = join(out, "bin");
const extOut = join(out, "extjs");
const dllSourceDir = join(base, "bin");
if (!existsSync(dllSourceDir)) fail(`缺运行期库来源目录 ${dllSourceDir}`);
const dllNames = readdirSync(dllSourceDir).filter(f => /\.dll$|\.so(?:\.|$)|\.dylib$/.test(f));
if (dllNames.length === 0) fail(`${dllSourceDir} 里一颗运行期库都没有，装出来的包剥掉 SDK 就起不来；先跑 node scripts/pack-cli.mjs`);

function copyInto(src, dst) {
  // out === base 的发布用法里，同一路径的复制是自毁（cpSync 会先截断源）；跳过即可。
  if (resolve(src) === resolve(dst)) return false;
  cpSync(src, dst, { recursive: true });
  return true;
}

// 只有自己不是平台包时才清场：清平台包的 bin 等于把刚抄好的运行期库删掉。
if (resolve(out) !== resolve(base)) {
  rmSync(binDir, { recursive: true, force: true });
  rmSync(extOut, { recursive: true, force: true });
}
mkdirSync(binDir, { recursive: true });
mkdirSync(extOut, { recursive: true });

const roles = {
  cli: `bin/sacode${EXE_SUFFIX}`,
  host: `bin/sacode-host${EXE_SUFFIX}`,
  daemon: `bin/sacode-daemon${EXE_SUFFIX}`,
  extensionHost: "extjs/server.cjs",
};
copyInto(inputs.cli, join(out, roles.cli));
copyInto(inputs.host, join(out, roles.host));
copyInto(inputs.daemon, join(out, roles.daemon));
for (const dll of dllNames) copyInto(join(dllSourceDir, dll), join(binDir, dll));
let extFiles = 0;
for (const entry of readdirSync(inputs.extjs, { withFileTypes: true })) {
  if (entry.isDirectory() && !entry.name.startsWith(".")) {
    mkdirSync(join(extOut, entry.name), { recursive: true });
    for (const child of readdirSync(join(inputs.extjs, entry.name))) {
      if (child.endsWith(".cjs") && copyInto(join(inputs.extjs, entry.name, child), join(extOut, entry.name, child))) extFiles += 1;
    }
    if (!readdirSync(join(inputs.extjs, entry.name)).some(f => f.endsWith(".cjs"))) fail(`扩展宿主样例目录 ${entry.name} 里没有 .cjs`);
  } else if (entry.isFile() && entry.name.endsWith(".cjs")) {
    if (copyInto(join(inputs.extjs, entry.name), join(extOut, entry.name))) extFiles += 1;
  }
}
for (const role of Object.values(roles)) {
  if (!existsSync(join(out, role))) fail(`声称装了 ${role}，盘上却没有`);
}

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
function kindOf(rel) {
  if (rel === roles.cli || rel === roles.host || rel === roles.daemon) return "executable";
  if (/\.dll$|\.so(?:\.|$)|\.dylib$/.test(rel)) return "runtime-library";
  if (rel.startsWith("extjs/")) return "extension-source";
  return "other";
}

let gitSha = "";
try {
  gitSha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim();
} catch (e) {
  fail(`取不到 gitSha（清单必须能反查到源码）：${e.message}`);
}
if (!/^[0-9a-f]{40}$/.test(gitSha)) fail(`gitSha 形状不对：${gitSha}`);

const files = [];
for (const rel of [...walk(binDir, "bin"), ...walk(extOut, "extjs")]) {
  if (rel === MANIFEST) continue;   // 清单不给自己算摘要：那是循环定义
  const abs = join(out, rel);
  const bytes = statSync(abs).size;
  files.push({ path: rel, bytes, sha256: createHash("sha256").update(readFileSync(abs)).digest("hex"), kind: kindOf(rel) });
}
files.sort((a, b) => a.path.localeCompare(b.path));
if (files.some(f => f.kind === "other")) fail(`包里出现了分类不明的文件，kind 判定要补：${JSON.stringify(files.filter(f => f.kind === "other").map(f => f.path))}`);

const manifest = { schemaVersion: 1, platform: process.platform, arch: process.arch, gitSha, roles, files };
writeFileSync(join(out, MANIFEST), JSON.stringify(manifest, null, 2) + "\n");
const countOf = (kind) => files.filter(f => f.kind === kind).length;
console.log(`packed ${files.length + 1} 个文件到 ${out}（可执行 ${countOf("executable")} + 运行期库 ${countOf("runtime-library")} + 扩展宿主 ${countOf("extension-source")}），清单 ${MANIFEST} 对 gitSha ${gitSha.slice(0, 7)}`);
