// 断言 31：前端只能比核心更严，不能更宽。断言 60：目录项已添加一份后仍可选（号池）。
// 桌面测试栈没有 jsdom，node --test 也吃不了 .ts：用仓库现成的 esbuild 只转译不打包
// （bundle:false 是硬要求——打包会把 vue 折进来得到第二份 runtime，与 vendor 那份
// 不是同一套响应式系统；这里只借两个纯函数）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSync } from 'esbuild';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
buildSync({
  entryPoints: [resolve(here, '../renderer/pages/models-page.ts')],
  outfile: resolve(here, '../dist/ts/modules/models-page.mjs'),
  format: 'esm', target: 'es2022', bundle: false,
});
const { validateDraft, selectableCatalogEntries } = await import(pathToFileURL(resolve(here, '../dist/ts/modules/models-page.mjs')).href);

const base = { id: 'p', name: 'P', protocol: 'openai-completions', key: '', declared: true,
  models: [{ id: 'm', name: '', contextWindow: '', maxTokens: '', image: false }] };

test('非回环 http 地址在前端就被拒', () => {
  assert.notEqual(validateDraft({ ...base, baseUrl: 'http://api.example.com/v1' }, [], false), '');
  assert.notEqual(validateDraft({ ...base, baseUrl: 'http://10.0.0.5:8080/v1' }, [], false), '');
});

test('本机回环 http 与 https 被接受', () => {
  assert.equal(validateDraft({ ...base, baseUrl: 'http://127.0.0.1:8000/v1' }, [], false), '');
  assert.equal(validateDraft({ ...base, baseUrl: 'http://localhost:8000/v1' }, [], false), '');
  assert.equal(validateDraft({ ...base, baseUrl: 'https://api.example.com/v1' }, [], false), '');
});

test('带凭据/查询/片段的地址被拒（与核心同判据）', () => {
  for (const u of ['https://u:p@api.example.com/v1', 'https://api.example.com/v1?x=1', 'https://api.example.com/v1#f']) {
    assert.notEqual(validateDraft({ ...base, baseUrl: u }, [], false), '', u);
  }
});

test('非回环 http 的拒法与核心一致：https 或 127.0.0.1/localhost 才活', () => {
  // 这条钉的是「子集」方向：核心 provider_registry.cj checkBaseUrl 拒的形态，前端必须也拒
  for (const u of ['http://example.com', 'ftp://a.example.com/v1', 'https://a.example.com/v1/x?y=1#z']) {
    assert.notEqual(validateDraft({ ...base, baseUrl: u }, [], false), '', u);
  }
});

test('目录项已添加一份后仍然可选（号池，断言 60）', () => {
  const catalog = [{ id: 'stepfun', name: 'StepFun' }, { id: 'other', name: 'Other' }];
  const providers = [{ id: 'stepfun', name: 'StepFun' }];      // 已经加过一份 stepfun
  const got = selectableCatalogEntries(catalog, providers);
  assert.ok(got.some((e) => e.id === 'stepfun'), '已添加过的目录项不得从选项里消失');
  assert.equal(got.length, 2, '目录条目一条都不该被藏起来');
});
