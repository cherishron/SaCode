// 指定技术栈中的 TypeScript 页面在构建期编译；运行时沿用唯一 Vue runtime。
import { createRequire } from 'node:module';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { assertStaticRendererBundle } from './renderer-bundle-guard.mjs';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const desktop = join(root, 'apps/desktop');
const require = createRequire(join(desktop, 'package.json'));
const work = mkdtempSync(join(desktop, '.pages-'));
try {
  const shim = join(work, 'vue.cjs');
  writeFileSync(shim, 'module.exports = globalThis.Vue;\n');
  const outfile = join(desktop, 'renderer/vendor/models-page.iife.js');
  const result = await require('esbuild').build({ entryPoints: [join(desktop, 'renderer/pages/models-page.ts')], bundle: true,
    alias: { vue: shim }, format: 'iife', globalName: 'SaCodeModels', outfile, target: 'chrome120', metafile: true, logLevel: 'warning' });
  const code = readFileSync(outfile, 'utf8');
  assertStaticRendererBundle(code, result.metafile);
  if (!code.includes('globalThis.Vue')) throw Error('页面未接入唯一 Vue runtime');
  console.log('TypeScript 模型页面编译完成');
} finally { rmSync(work, { recursive: true, force: true }); }
