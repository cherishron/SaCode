// 把 Vue 3 的运行时构建落到渲染层的 vendor 目录。
// 两个约束决定了这一小步的存在：
// 1) 桌面渲染层是 file:// 下的经典脚本页，Chromium 会按 CORS 拦掉 file:// 的 ES module，
//    所以不能 <script type="module"> 直连 node_modules，也不能引打包器；
// 2) 渲染层带 `script-src 'self'` 的 CSP，不带运行时编译器的 global 构建会因
//    `unsafe-eval` 被拦而整页空白，所以取 runtime 构建，视图用 h() 写。
import { copyFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// 路径按脚本自身位置解析：npm 会把脚本生命周期（preui-smoke 等）的工作目录切成包目录，
// 用相对 cwd 的路径会在 apps/desktop 下找不到刚装好的 vue。
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = join(ROOT, "apps", "desktop", "node_modules", "vue", "package.json");
const src = join(ROOT, "apps", "desktop", "node_modules", "vue", "dist", "vue.runtime.global.prod.js");
const outDir = join(ROOT, "apps", "desktop", "renderer", "vendor");
const out = join(outDir, "vue.runtime.global.prod.js");

// 缺依赖就当场失败，不要让渲染层带着一个空 vendor 假装能用
if (!existsSync(src)) {
  console.error(`pack-vendor 失败：找不到 ${src}（先在 apps/desktop 跑 npm install）`);
  process.exit(2);
}
const version = JSON.parse(readFileSync(pkg, "utf8")).version;
mkdirSync(outDir, { recursive: true });
copyFileSync(src, out);
console.log(`vendor 就位：vue@${version} runtime → ${out}`);
