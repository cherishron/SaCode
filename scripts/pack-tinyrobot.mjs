// 把 TinyRobot 的 bubble 一族折叠成渲染层能用的一种形态：单个经典脚本 + 一份静态 CSS。
// 为什么必须有这一步（机制与 pack-tinyvue.mjs 同）：@opentiny/tiny-robot 是 ESM-only，
// 而桌面跑在 file:// + CSP script-src 'self' 上，既不能加载 ES module 也没有运行时模板
// 编译器，所以只在**构建期**折叠。关键一条：alias `vue` 指到只写
// `module.exports = globalThis.Vue` 的 shim，产物用的还是 pack-vendor.mjs 落进 vendor/
// 的那一份 Vue runtime——装进两份 Vue 会让组件的响应式系统跟应用的不是同一套实例。
//
// 不启用 Bubble 内部动态 import 的 Markdown 路径。现有 peerDependency markdown-it
// 显式折叠到同一经典脚本，由本仓 renderer/markdown.js 将 token 转成 Vue 节点；
// 不输出 innerHTML，也不在运行时加载解析器。
import { existsSync, mkdtempSync, writeFileSync, rmSync, statSync, readFileSync, copyFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assertStaticRendererBundle } from './renderer-bundle-guard.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DESKTOP = join(ROOT, "apps", "desktop");
// 依赖装在 apps/desktop 下，脚本在仓库根的 scripts/ 里，所以要按 desktop 的视角解析。
const requireFromDesktop = createRequire(join(DESKTOP, "package.json"));

const PKG = "@opentiny/tiny-robot";
const OUT_JS = join(DESKTOP, "renderer", "vendor", "tinyrobot.iife.js");
const OUT_CSS = join(DESKTOP, "renderer", "vendor", "tinyrobot.css");

function die(msg) {
  console.error(`pack-tinyrobot 失败：${msg}`);
  process.exit(2);
}

let esbuild;
try {
  esbuild = requireFromDesktop("esbuild");
} catch (e) {
  die(`esbuild 未安装（在 apps/desktop 跑 npm install）：${e.message}`);
}
for (const pkg of [PKG, "@opentiny/tiny-robot-svgs"]) {
  try {
    requireFromDesktop.resolve(join(pkg, "package.json"));
  } catch {
    die(`依赖包 ${pkg} 未安装（在 apps/desktop 跑 npm install）`);
  }
}
const vueRuntime = join(DESKTOP, "renderer", "vendor", "vue.runtime.global.prod.js");
if (!existsSync(vueRuntime)) die("缺 renderer/vendor/vue.runtime.global.prod.js，先跑 node scripts/pack-vendor.mjs");

// 入口与 shim 必须落在 apps/desktop 下面：esbuild 按 entry 所在目录向上找 node_modules，
// 放到系统临时目录会解析不到组件包（TinyVue 那条路实测过）。
const work = mkdtempSync(join(DESKTOP, ".tinyrobot-"));
try {
  const shim = join(work, "vue-global.cjs");
  writeFileSync(shim, "module.exports = globalThis.Vue;\n");
  const entry = join(work, "entry.js");
  writeFileSync(
    entry,
    'import { Bubble, BubbleList, BubbleProvider } from "@opentiny/tiny-robot/dist/bubble/index.js";\n' +
      'import MarkdownIt from "markdown-it";\n' +
      'import CodeHighlighter from "../renderer/highlight-source.mjs";\n' +
      "globalThis.TinyRobot = { Bubble: Bubble, BubbleList: BubbleList, BubbleProvider: BubbleProvider };\n" +
      "globalThis.SaCodeMarkdownIt = MarkdownIt;\n" +
      "globalThis.SaCodeCodeHighlighter = CodeHighlighter;\n"
  );

  const buildResult=await esbuild.build({
    entryPoints: [entry],
    bundle: true,
    format: "iife",
    alias: { vue: shim },
    outfile: OUT_JS,
    logLevel: "warning",
    target: ["chrome120"],
    metafile:true,
  });

  // 反证式自检：CSP 的生死线是产物里不能有运行时求值、不能有运行时模块加载，
  // 也不能残留裸 "vue" 说明符（那等于第二份 Vue）。
  const code = readFileSync(OUT_JS, "utf8");
  // TextMate 规则字符串含 import(?=...)；以构建器的实际输出依赖检查运行时模块，
  // 不能把语法数据误判为 import 表达式。所有输出均禁止动态或外部依赖。
  try {assertStaticRendererBundle(code,buildResult.metafile);} catch(e) {die(e.message);}
  if (/require\("vue"\)|from"vue"|from "vue"/.test(code)) die("折叠产物残留 vue 裸说明符，alias 没生效");
  if (!code.includes("globalThis.Vue")) die("折叠产物没接上 globalThis.Vue，会出现第二份 Vue");
  if (!code.includes("globalThis.TinyRobot")) die("折叠产物没挂上 globalThis.TinyRobot");

  // CSS 原样拷贝：dist/style.css 自带 :root 上的 513 个 --tr-* 定义，不依赖外部主题包，
  // 零转换零风险。按气泡子集裁剪延后（裁剪会切断选择器依赖，得不偿失）。
  const pkgRoot = dirname(requireFromDesktop.resolve(join(PKG, "package.json")));
  const srcCss = join(pkgRoot, "dist", "style.css");
  if (!existsSync(srcCss)) die(`找不到 ${srcCss}，组件包形态与 0.5.1 预期不符`);
  copyFileSync(srcCss, OUT_CSS);

  console.log(
    `tinyrobot 折叠完成：js=${statSync(OUT_JS).size} 字节、css=${statSync(OUT_CSS).size} 字节 → ${OUT_JS}`
  );
} finally {
  rmSync(work, { recursive: true, force: true });
}
