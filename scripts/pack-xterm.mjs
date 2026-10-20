// 把 xterm.js + addon-fit 折叠成渲染层能用的一种形态：单个经典脚本 + 一份静态 CSS。
// 机制与 pack-tinyvue.mjs / pack-tinyrobot.mjs 同：@xterm/xterm 是 ESM-only，
// 而桌面跑在 file:// + CSP script-src 'self' 上，既不能加载 ES module 也没有运行时
// 模板编译器，所以只在**构建期**折叠。关键一条：alias `vue` 指到只写
// `module.exports = globalThis.Vue` 的 shim——虽然 xterm 不依赖 Vue，但保持与
// 其他 pack 脚本一致，避免 esbuild 解析路径差异。
//
// 产物：
//   renderer/vendor/xterm.iife.js  — globalThis.Xterm = { Terminal, FitAddon }
//   renderer/vendor/xterm.css     — xterm 样式原样拷贝
//
// 反证式自检（与 pack-tinyrobot.mjs 同）：
//   - 无 new Function / eval
//   - 无残留 import()（运行时模块加载）
//   - 无裸 "vue" 说明符
//   - 产物包含 globalThis.Xterm
import { existsSync, mkdtempSync, writeFileSync, rmSync, statSync, readFileSync, copyFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assertStaticRendererBundle } from './renderer-bundle-guard.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DESKTOP = join(ROOT, "apps", "desktop");
// 依赖装在 apps/desktop 下，脚本在仓库根的 scripts/ 里，所以要按 desktop 的视角解析。
const requireFromDesktop = createRequire(join(DESKTOP, "package.json"));

const PKG_XTERM = "@xterm/xterm";
const PKG_FIT = "@xterm/addon-fit";
const OUT_JS = join(DESKTOP, "renderer", "vendor", "xterm.iife.js");
const OUT_CSS = join(DESKTOP, "renderer", "vendor", "xterm.css");

function die(msg) {
  console.error(`pack-xterm 失败：${msg}`);
  process.exit(2);
}

let esbuild;
try {
  esbuild = requireFromDesktop("esbuild");
} catch (e) {
  die(`esbuild 未安装（在 apps/desktop 跑 npm install）：${e.message}`);
}

// 检查依赖包已安装
for (const pkg of [PKG_XTERM, PKG_FIT]) {
  try {
    requireFromDesktop.resolve(join(pkg, "package.json"));
  } catch {
    die(`依赖包 ${pkg} 未安装（在 apps/desktop 跑 npm install ${pkg}）`);
  }
}

// Vue runtime 必须先就位（xterm 不依赖 Vue，但保持与其他 pack 脚本一致的 alias 链）
const vueRuntime = join(DESKTOP, "renderer", "vendor", "vue.runtime.global.prod.js");
if (!existsSync(vueRuntime)) die("缺 renderer/vendor/vue.runtime.global.prod.js，先跑 node scripts/pack-vendor.mjs");

// 入口与 shim 必须落在 apps/desktop 下面：esbuild 按 entry 所在目录向上找 node_modules，
// 放到系统临时目录会解析不到组件包（TinyVue 那条路实测过）。
const work = mkdtempSync(join(DESKTOP, ".xterm-"));
try {
  const shim = join(work, "vue-global.cjs");
  writeFileSync(shim, "module.exports = globalThis.Vue;\n");
  const entry = join(work, "entry.js");
  writeFileSync(
    entry,
    'import { Terminal } from "@xterm/xterm";\n' +
      'import { FitAddon } from "@xterm/addon-fit";\n' +
      "globalThis.Xterm = { Terminal: Terminal, FitAddon: FitAddon };\n"
  );

  const buildResult = await esbuild.build({
    entryPoints: [entry],
    bundle: true,
    format: "iife",
    alias: { vue: shim },
    outfile: OUT_JS,
    logLevel: "warning",
    target: ["chrome120"],
    metafile: true,
  });

  // 反证式自检：CSP 的生死线是产物里不能有运行时求值、不能有运行时模块加载，
  // 也不能残留裸 "vue" 说明符。
  const code = readFileSync(OUT_JS, "utf8");
  try { assertStaticRendererBundle(code, buildResult.metafile); } catch (e) { die(e.message); }
  if (/require\("vue"\)|from"vue"|from "vue"/.test(code)) die("折叠产物残留 vue 裸说明符，alias 没生效");
  if (!code.includes("globalThis.Xterm")) die("折叠产物没挂上 globalThis.Xterm");

  // CSS 原样拷贝：@xterm/xterm/css/xterm.css 是 xterm 的全部样式，零转换零风险。
  const xtermPkgRoot = dirname(requireFromDesktop.resolve(join(PKG_XTERM, "package.json")));
  const srcCss = join(xtermPkgRoot, "css", "xterm.css");
  if (!existsSync(srcCss)) die(`找不到 ${srcCss}，xterm 包形态与预期不符`);
  copyFileSync(srcCss, OUT_CSS);

  console.log(
    `xterm 折叠完成：js=${statSync(OUT_JS).size} 字节、css=${statSync(OUT_CSS).size} 字节 → ${OUT_JS}`
  );
} finally {
  rmSync(work, { recursive: true, force: true });
}
