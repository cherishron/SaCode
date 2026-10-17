// 把 TinyVue 的组件折叠成渲染层能用的一种形态：单个经典脚本。
// 为什么必须有这一步（2026-10-03 实测，别再重新发现一遍）：
// @opentiny/vue 是 ESM-only —— main 与 module 都指向 index.js，全文是裸说明符 import，
// 包里没有 dist/、没有 unpkg、没有 global/UMD 构建。而桌面渲染层跑在 file:// 上，
// ES module 会被 CORS 拦，CSP 又是 script-src 'self'（禁 unsafe-eval），
// 所以组件库只能在**构建期**折叠，运行时不带模块加载器、也不带 Vue 模板编译器。
//
// 关键一条：alias `vue` 指到一个只写 `module.exports = globalThis.Vue` 的 shim，
// 折叠产物用的还是 pack-vendor.mjs 落进 vendor/ 的那一份 Vue runtime ——
// 装进两份 Vue 会让组件的响应式系统跟应用的不是同一个实例，界面上表现为「组件点了不更新」。
//
// esbuild 与组件库都只在构建期存在（apps/desktop 的 devDependencies），运行时零 npm 依赖。
import { existsSync, mkdtempSync, writeFileSync, rmSync, statSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DESKTOP = join(ROOT, "apps", "desktop");
// 依赖装在 apps/desktop 下，脚本在仓库根的 scripts/ 里，所以要按 desktop 的视角解析。
const requireFromDesktop = createRequire(join(DESKTOP, "package.json"));

// 只折叠真正用到的组件：整包 import 会拖进 60+ 个包的 CSS 与图标集。
const COMPONENTS = [
  ["Button", "@opentiny/vue-button"],
];

const OUT = join(DESKTOP, "renderer", "vendor", "tinyvue.iife.js");

function die(msg) {
  console.error(`pack-tinyvue 失败：${msg}`);
  process.exit(2);
}

let esbuild;
try {
  esbuild = requireFromDesktop("esbuild");
} catch (e) {
  die(`esbuild 未安装（在 apps/desktop 跑 npm install）：${e.message}`);
}
for (const [, pkg] of COMPONENTS) {
  try {
    requireFromDesktop.resolve(join(pkg, "package.json"));
  } catch {
    die(`组件包 ${pkg} 未安装（在 apps/desktop 跑 npm install）`);
  }
}
const vueRuntime = join(DESKTOP, "renderer", "vendor", "vue.runtime.global.prod.js");
if (!existsSync(vueRuntime)) die("缺 renderer/vendor/vue.runtime.global.prod.js，先跑 node scripts/pack-vendor.mjs");

// 入口与 shim 必须落在 apps/desktop 下面：esbuild 按 entry 所在目录向上找 node_modules，
// 放到系统临时目录会解析不到组件包（实测报 Could not resolve "@opentiny/vue-button"）。
const work = mkdtempSync(join(DESKTOP, ".tinyvue-"));
try {
  const shim = join(work, "vue-global.cjs");
  writeFileSync(shim, "module.exports = globalThis.Vue;\n");
  const lines = [];
  COMPONENTS.forEach(([local, pkg], i) => lines.push(`import ${local}$${i} from ${JSON.stringify(pkg)};`));
  lines.push(
    `globalThis.TinyVue = { ${COMPONENTS.map(([local], i) => `${local}: ${local}$${i}`).join(", ")} };`
  );
  const entry = join(work, "entry.js");
  writeFileSync(entry, lines.join("\n") + "\n");

  await esbuild.build({
    entryPoints: [entry],
    bundle: true,
    format: "iife",
    alias: { vue: shim },
    outfile: OUT,
    logLevel: "warning",
    target: ["chrome120"],
  });

  // 反证式自检：CSP 的生死线是产物里不能有运行时求值，也不能残留裸 "vue" 说明符。
  const code = readFileSync(OUT, "utf8");
  if (/new Function\(|\beval\(/.test(code)) die("折叠产物含运行时求值，会撞 CSP script-src 'self'");
  if (/require\("vue"\)|from"vue"|from "vue"/.test(code)) die("折叠产物残留 vue 裸说明符，alias 没生效");
  if (!code.includes("globalThis.Vue")) die("折叠产物没接上 globalThis.Vue，会出现第二份 Vue");

  console.log(
    `tinyvue 折叠完成：${COMPONENTS.length} 个组件（${COMPONENTS.map(([l]) => l).join(", ")}）/ ${statSync(OUT).size} 字节 → ${OUT}`
  );
} finally {
  rmSync(work, { recursive: true, force: true });
}
