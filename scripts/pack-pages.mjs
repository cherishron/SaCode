// 指定技术栈中的 TypeScript 页面在构建期编译；运行时沿用唯一 Vue runtime。
import { createRequire } from 'node:module';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { assertStaticRendererBundle } from './renderer-bundle-guard.mjs';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const desktop = join(root, 'apps/desktop');
const require = createRequire(join(desktop, 'package.json'));
// 虚拟模块路径固定：临时目录随机名不能进入产物，否则同一源码重复构建会改变哈希。
const vueRuntime = { name: 'sacode-vue-runtime', setup(build) {
  build.onResolve({ filter: /^vue$/ }, () => ({ path: 'vue', namespace: 'sacode-runtime' }));
  build.onLoad({ filter: /^vue$/, namespace: 'sacode-runtime' }, () => ({ contents: 'module.exports = globalThis.Vue;', loader: 'js' }));
} };
for (const [page, globalName] of [['models-page', 'SaCodeModels'], ['plugins-page', 'SaCodePlugins'], ['plugin-configuration', 'SaCodeConfiguration']]) {
  const outfile = join(desktop, `renderer/vendor/${page}.iife.js`);
  const result = await require('esbuild').build({ absWorkingDir: root, entryPoints: [join(desktop, `renderer/pages/${page}.ts`)], bundle: true,
    plugins: [vueRuntime], format: 'iife', globalName, outfile, target: 'chrome120', metafile: true, logLevel: 'warning' });
  const code = readFileSync(outfile, 'utf8');
  assertStaticRendererBundle(code, result.metafile);
  if (!code.includes('globalThis.Vue')) throw Error('页面未接入唯一 Vue runtime');
  console.log(`TypeScript 页面编译完成：${page}`);
}
