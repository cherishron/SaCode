import assert from 'node:assert/strict';
import test from 'node:test';

/** 最小 DOM / localStorage 桩，让 preferences.ts 在 node:test 下可跑 */
function installDomStubs() {
  const store = new Map<string, string>();
  const attrs = new Map<string, string>();
  const html = {
    dataset: {} as Record<string, string>,
    lang: '',
    classList: { toggle() {} },
    setAttribute(k: string, v: string) {
      attrs.set(k, v);
    },
    getAttribute(k: string) {
      return attrs.get(k) ?? null;
    },
  };
  (globalThis as Record<string, unknown>).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => {
      store.set(k, v);
    },
    removeItem: (k: string) => {
      store.delete(k);
    },
  };
  (globalThis as Record<string, unknown>).document = {
    documentElement: html,
    querySelectorAll: () => [],
    querySelector: () => null,
  };
  (globalThis as Record<string, unknown>).window = {
    matchMedia: () => ({ matches: true, addEventListener() {} }),
  };
  // 清掉可能残留的 Tauri 全局
  delete (globalThis as Record<string, unknown>).__TAURI__;
  return { store, html };
}

test('密度偏好：保存后可读回，并立即写到 html[data-density]', async () => {
  const { html, store } = installDomStubs();
  const { loadDesktopPreferences, saveDesktopPreferences, applyInterfacePreferences } =
    await import('../src/ui/logic/preferences.ts');

  const base = loadDesktopPreferences();
  assert.equal(base.density, 'comfortable');

  saveDesktopPreferences({ ...base, density: 'compact' });
  assert.equal(loadDesktopPreferences().density, 'compact');
  assert.equal(html.dataset.density, 'compact');
  // 持久化：localStorage 里有 density 字段
  const raw = JSON.parse(store.get('sacode.desktop.preferences') || '{}');
  assert.equal(raw.density, 'compact');

  applyInterfacePreferences({ ...loadDesktopPreferences(), density: 'comfortable' });
  assert.equal(html.dataset.density, 'comfortable');
});

test('语言偏好：仅记录 + 写 html[lang]，不声称已翻译界面', async () => {
  const { html, store } = installDomStubs();
  const { loadDesktopPreferences, saveDesktopPreferences, applyInterfacePreferences } =
    await import('../src/ui/logic/preferences.ts');

  const base = loadDesktopPreferences();
  assert.equal(base.locale, 'zh-CN');

  // 启动路径：main.ts 调 applyInterfacePreferences → 写 html[lang]
  applyInterfacePreferences(base);
  assert.equal(html.lang, 'zh-CN');

  saveDesktopPreferences({ ...base, locale: 'en-US' });
  assert.equal(loadDesktopPreferences().locale, 'en-US');
  assert.equal(html.lang, 'en-US');
  const raw = JSON.parse(store.get('sacode.desktop.preferences') || '{}');
  assert.equal(raw.locale, 'en-US');
});

test('syncSystemIntegrations：非 Tauri 明确返回不支持，不假装生效', async () => {
  installDomStubs();
  const { syncSystemIntegrations, loadDesktopPreferences } =
    await import('../src/ui/logic/preferences.ts');

  const result = await syncSystemIntegrations(loadDesktopPreferences());
  assert.equal(result.tray, false);
  assert.equal(result.autostart, false);
  assert.ok(result.errors.some((e) => e.includes('暂不支持')));
});

test('syncSystemIntegrations：Tauri 下真实 invoke set_tray_enabled / set_autostart', async () => {
  installDomStubs();
  const calls: Array<{ cmd: string; args: Record<string, unknown> }> = [];
  (globalThis as Record<string, unknown>).__TAURI__ = {
    core: {
      invoke: async (cmd: string, args: Record<string, unknown>) => {
        calls.push({ cmd, args });
        if (cmd === 'set_tray_enabled') return Boolean(args.enabled);
        if (cmd === 'set_autostart') return Boolean(args.enabled);
        throw new Error(`unexpected ${cmd}`);
      },
    },
  };
  const { syncSystemIntegrations, loadDesktopPreferences } =
    await import('../src/ui/logic/preferences.ts');

  const prefs = { ...loadDesktopPreferences(), trayEnabled: true, autostart: true };
  const result = await syncSystemIntegrations(prefs);
  assert.equal(result.tray, true);
  assert.equal(result.autostart, true);
  assert.equal(result.errors.length, 0);
  assert.deepEqual(
    calls.map((c) => c.cmd).sort(),
    ['set_autostart', 'set_tray_enabled'],
  );
  assert.equal(calls.find((c) => c.cmd === 'set_tray_enabled')?.args.enabled, true);
  assert.equal(calls.find((c) => c.cmd === 'set_autostart')?.args.enabled, true);
  delete (globalThis as Record<string, unknown>).__TAURI__;
});

test('ABOUT_INFO 版本/许可/源码位齐全（关于页数据源）', async () => {
  installDomStubs();
  const { ABOUT_INFO } = await import('../src/ui/logic/preferences.ts');
  assert.equal(ABOUT_INFO.productName, 'SaCode');
  assert.equal(ABOUT_INFO.version, '1.1.1');
  assert.equal(ABOUT_INFO.license, 'MulanPSL-2.0');
  assert.ok(ABOUT_INFO.sourceUrl.startsWith('https://'));
  assert.ok(ABOUT_INFO.sourceLabel.length > 0);
});
