import assert from 'node:assert/strict';
import test from 'node:test';

async function fixture() {
  const module = await import('../src/ui/logic/settings-focus.ts').catch(() => null);
  assert.ok(module?.activateSettingsFocus, 'settings focus lifecycle is implemented');
  const listeners = new Map<string, Function>();
  const doc: any = { activeElement: null, addEventListener: (name: string, fn: Function) => listeners.set(name, fn), removeEventListener: (name: string, fn: Function) => { if (listeners.get(name) === fn) listeners.delete(name); }, querySelectorAll: () => popupVisible ? [popup] : [] };
  let popupVisible = true;
  function control() { return { isConnected: true, tabIndex: 0, disabled: false, matches: () => false, getClientRects: () => [1], closest: () => null, focus() { doc.activeElement = this; } }; }
  const opener = control(), first = control(), last = control(), popupButton = control(), outside = control();
  const popup: any = { getClientRects: () => [1], contains: (el: any) => el === popupButton, querySelectorAll: () => [popupButton] };
  const root: any = { ownerDocument: doc, contains: (el: any) => el === first || el === last || el === root, querySelectorAll: () => [first, last], focus() { doc.activeElement = root; } };
  doc.activeElement = opener;
  let closed = 0;
  const cleanup = module.activateSettingsFocus(root, () => { closed++; });
  const key = (key: string, shiftKey = false, defaultPrevented = false) => { let prevented = false; listeners.get('keydown')?.({ key, shiftKey, defaultPrevented, preventDefault() { prevented = true; } }); return prevented; };
  return { doc, listeners, opener, first, last, popupButton, outside, cleanup, key, hidePopup: () => { popupVisible = false; }, closed: () => closed };
}

test('opening confines focus to settings and ignores background teleported popup controls', async () => {
  const h = await fixture();
  assert.equal(h.doc.activeElement, h.first);
  assert.equal(h.key('Tab', true), true);
  assert.equal(h.doc.activeElement, h.last);
  assert.equal(h.key('Tab'), true);
  assert.equal(h.doc.activeElement, h.first);
  h.doc.activeElement = h.popupButton;
  h.listeners.get('focusin')?.({ target: h.popupButton });
  assert.equal(h.doc.activeElement, h.first);
  h.doc.activeElement = h.outside;
  h.listeners.get('focusin')?.({ target: h.outside });
  assert.equal(h.doc.activeElement, h.first);
  h.cleanup();
});

test('Escape ignores unrelated popups; cleanup removes listeners and restores opener', async () => {
  const h = await fixture();
  h.key('Escape', false, true);
  assert.equal(h.closed(), 0);
  assert.equal(h.key('Escape'), true);
  assert.equal(h.closed(), 1);
  h.cleanup();
  assert.equal(h.listeners.size, 0);
  assert.equal(h.doc.activeElement, h.opener);
  h.cleanup();
  assert.equal(h.doc.activeElement, h.opener);
});
