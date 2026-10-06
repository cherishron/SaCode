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
const slotsOutput = join(desktop, 'renderer/vendor/client-slots.iife.js');
const generalOutput = join(desktop, 'renderer/vendor/general-settings.iife.js');
const generalBuild = await require('esbuild').build({ absWorkingDir: root, entryPoints: [join(desktop, 'renderer/pages/general-settings.ts')], bundle: true,
  plugins: [vueRuntime], format: 'iife', globalName: 'SaCodeGeneralSettings', outfile: generalOutput, target: 'chrome120', metafile: true, logLevel: 'warning' });
assertStaticRendererBundle(readFileSync(generalOutput, 'utf8'), generalBuild.metafile);
const slotsBuild = await require('esbuild').build({ absWorkingDir: root, entryPoints: [join(desktop, 'renderer/pages/client-slots.ts')], bundle: true,
  plugins: [vueRuntime], format: 'iife', globalName: 'SaCodeSlots', outfile: slotsOutput, target: 'chrome120', metafile: true, logLevel: 'warning' });
assertStaticRendererBundle(readFileSync(slotsOutput, 'utf8'), slotsBuild.metafile);
if (!readFileSync(slotsOutput, 'utf8').includes('globalThis.Vue')) throw Error('槽位渲染器未接入唯一 Vue runtime');
for (const [page, globalName] of [['models-page', 'SaCodeModels'], ['plugins-page', 'SaCodePlugins'], ['plugin-configuration', 'SaCodeConfiguration'], ['subagent-settings','SaCodeSubagent'], ['plugin-manager','SaCodePluginManager'], ['model-select','SaCodeModelSelect'], ['composer-attachments','SaCodeAttachments'], ['queue-dock','SaCodeQueue'], ['context-meter','SaCodeContextMeter'], ['todo-panel','SaCodeTodo'], ['goal-bar','SaCodeGoal']]) {
  const outfile = join(desktop, `renderer/vendor/${page}.iife.js`);
  const result = await require('esbuild').build({ absWorkingDir: root, entryPoints: [join(desktop, `renderer/pages/${page}.ts`)], bundle: true,
    plugins: [vueRuntime], format: 'iife', globalName, outfile, target: 'chrome120', metafile: true, logLevel: 'warning' });
  const code = readFileSync(outfile, 'utf8');
  assertStaticRendererBundle(code, result.metafile);
  if (!code.includes('globalThis.Vue')) throw Error('页面未接入唯一 Vue runtime');
  console.log(`TypeScript 页面编译完成：${page}`);
}
