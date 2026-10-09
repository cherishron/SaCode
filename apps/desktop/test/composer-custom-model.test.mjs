// 输入区 → 自定义模型的接线用例。
// 背景：Host 的 task/start 只在带 customModelId 时才走 CustomModelRegistry 的路由与预算
// （apps/host/src/main.cj 里 centered 分支会 select() 并覆盖注册表默认指针）；不带时
// 退回 ProviderRegistry 默认指针。所以模型中心里配的自定义模型（绑定、权重、三项单价、
// 日/月预算）从不参与真实发送。
// app.js 是整个应用的闭包、无法在无 DOM 环境挂载，本仓对它的接线判据一直是源码形状
// （同类先例见 test/plugin-manager-adapter.test.mjs 末尾那条），这里沿用同一 seam，
// 但四件事各自独占一条断言。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const app = readFileSync(fileURLToPath(new URL('../renderer/app.js', import.meta.url)), 'utf8');

// 取 startTask 函数体：从它的声明到下一个同缩进的 async function 声明为止。
const startTaskBody = () => {
  const from = app.indexOf('async function startTask()');
  assert.notEqual(from, -1, 'app.js 里必须还有 startTask');
  const next = app.indexOf('\n    async function ', from + 1);
  return app.slice(from, next < 0 ? app.length : next);
};

test('起轮必须把会话选中的自定义模型带给 Host，不能永远发空参', () => {
  const call = startTaskBody().match(/window\.sacode\.taskStart\(([^)]*)\)/);
  assert.ok(call, 'startTask 里应能找到 taskStart 调用');
  assert.notEqual(call[1].trim(), '', 'taskStart 不能继续无参调用：Host 只在带 customModelId 时才按自定义模型路由');
  assert.match(call[1], /selectedCustomModel/, `调用参数应来自自定义模型选中态，实际是 ${call[1]}`);
});

test('自定义模型候选只从核心读，并且只列已启用的条目', () => {
  assert.match(app, /window\.sacode\.customsDescribe\(/, '候选必须来自 customsDescribe，不留前端第二份清单');
  assert.match(app, /customModels\.value[\s\S]{0,120}\.filter\([\s\S]{0,40}enabled/,
    '要按 enabled 过滤：未启用的自定义模型不该出现在发送入口');
});

test('自定义模型被删掉后要把拒绝码翻成人话，并把选中态清回默认指针', () => {
  assert.match(app, /"custom-model-not-found"[\s\S]{0,10}:/, '缺 custom-model-not-found 的用户可读文案');
  assert.match(startTaskBody(), /custom-model-not-found/, '拒绝发生在起轮时，清理也必须发生在起轮的 catch 里');
  assert.match(startTaskBody(), /selectedCustomModel\.value = ""/, '被拒后要清回默认指针，不能每次发送重复同一个拒绝');
});

test('启动与切换会话都要重读自定义模型清单', () => {
  const loads = (app.match(/loadCustomModels\(\)/g) || []).length;
  assert.ok(loads >= 3, `loadCustomModels 至少要被声明并调用 2 处（启动 + 切会话），实测 ${loads} 处`);
  assert.match(app, /selectedCustomModel\.value = ""[\s\S]*loadCustomModels\(\)/, '切会话要把选中态清回默认指针再重读');
});
