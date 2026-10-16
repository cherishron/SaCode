import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../renderer/app.js', import.meta.url), 'utf8');

test('原型首屏只保留会话搜索与树，日志完整性筛选位于目录弹窗', () => {
  const navStart = source.indexOf('const nav = el(');
  const navEnd = source.indexOf('const catalogDialog = h(');
  assert.ok(navStart >= 0 && navEnd > navStart);
  const nav = source.slice(navStart, navEnd);
  assert.match(nav, /id:'sidebar-search'/);
  assert.match(nav, /sidebar-session-list/);
  assert.doesNotMatch(nav, /sidebar-filter|data-sidebar-status|data-catalog-status|可正常回放|尾部不完整/);
  const catalog = source.slice(navEnd, source.indexOf('const workspaceDialog=', navEnd));
  assert.match(catalog, /catalog-filter/);
  assert.match(catalog, /data-catalog-status/);
  assert.match(catalog, /role:'group','aria-label':'按会话日志状态筛选'/);
  for (const label of ['全部', '可正常回放', '尾部不完整', '日志回放失败']) assert.ok(catalog.includes(label));
});

test('目录弹窗状态不会暗中过滤侧栏，真实会话异常说明保留', () => {
  const begin = source.indexOf('const sidebarQueryText =');
  const end = source.indexOf('const workspaceGroups =', begin);
  assert.ok(begin >= 0 && end > begin);
  const search = source.slice(begin, end);
  assert.match(search, /sidebarSearching = sidebarQueryText.length > 0/);
  assert.doesNotMatch(search, /catalogStatus|sidebarStatus/);
  assert.match(source, /self\.catalog\.entries\.filter\(item=>self\.catalogStatus/);
  assert.match(source, /日志回放失败，摘要不可用/);
  assert.match(source, /sessionLocked\s*\|\|\s*item\.current\s*\|\|\s*item\.status\s*===\s*"replay-rejected"/);
});

// 侧栏历史行的标题常被 ellipsis 截断，需要提示补全；但浏览器原生 title 的浮层直接盖在
// 列表上方，上下扫视找旧会话时会不断弹出遮住下一条。必须走自定义浮层（side:'right' 浮到
// 侧栏外侧、不压列表），title 只作降级保留，挂载时由 tooltip 自行摘除。
test('侧栏会话与工作区行的提示走右侧浮层，不依赖会遮挡列表的原生 title', () => {
  const sessionStart = source.indexOf('const renderSession');
  const sessionEnd = source.indexOf('const head = el(', sessionStart);
  assert.ok(sessionStart >= 0 && sessionEnd > sessionStart);
  const session = source.slice(sessionStart, sessionEnd);
  assert.match(session, /tooltip:\{[^}]*side:'right'/);
  const folderStart = source.indexOf("el('div','workspace-folder'");
  const folderEnd = source.indexOf('const catalogDialog = h(', folderStart);
  assert.ok(folderStart >= 0 && folderEnd > folderStart);
  const folder = source.slice(folderStart, folderEnd);
  assert.match(folder, /tooltip:\{[^}]*side:'right'/);
});

test('原型底栏为头像昵称与独立设置图标同排，不保留重复设置行', () => {
  const footerStart = source.indexOf("el('footer','sidebar-footer',[");
  const footerEnd = source.indexOf('], { "aria-label": "工作区与会话导航" });', footerStart);
  assert.ok(footerStart >= 0 && footerEnd > footerStart);
  const footer = source.slice(footerStart, footerEnd);
  assert.match(footer, /SaCodeSlots\.AccountMenu/);
  assert.match(footer, /sidebar-settings/);
  assert.match(footer, /id:'open-settings','aria-label':'SaCode 设置'/);
  assert.doesNotMatch(footer, /nav-settings-row|nav-label/);
  const account = readFileSync(new URL('../renderer/pages/account-menu.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(account, /无需官方账号/);
  assert.match(account, /本地用户/);
  assert.doesNotMatch(account, /settings\('general'\)/);
  assert.doesNotMatch(account, /h\('span',\{\},'设置'\)/);
  assert.match(account, /settings\('profile'\)/);
});
