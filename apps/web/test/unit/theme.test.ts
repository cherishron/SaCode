// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount, type VueWrapper } from '@vue/test-utils';
import { nextTick } from 'vue';
import App from '../../src/App.vue';

vi.mock('../../src/stores/auth', () => ({
  useAuthStore: () => ({ authenticated: false, owner: null, logout: vi.fn() }),
}));
vi.mock('vue-router', () => ({ useRouter: () => ({ push: vi.fn() }), useRoute: () => ({ name: 'login' }) }));

let wrapper: VueWrapper | undefined;
function render(): VueWrapper {
  wrapper = mount(App, { global: { stubs: { 'router-view': true } } });
  return wrapper;
}

beforeEach(() => {
  localStorage.clear();
  delete document.documentElement.dataset.theme;
});
afterEach(() => {
  wrapper?.unmount();
  wrapper = undefined;
  vi.restoreAllMocks();
});

describe('主题偏好初始化与切换', () => {
  it('无保存值时默认深色，登录前也提供切换按钮', () => {
    const view = render();
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(view.get('[data-theme-toggle]').attributes('aria-label')).toBe('切换到浅色主题');
  });

  it('初始化先读取浅色，不被默认深色覆盖（刷新回归）', async () => {
    localStorage.setItem('sacode-theme', 'light');
    render();
    await nextTick();
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(localStorage.getItem('sacode-theme')).toBe('light');
  });

  it('双向切换保存当前偏好，重新挂载后仍恢复', async () => {
    const view = render();
    await view.get('[data-theme-toggle]').trigger('click');
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(localStorage.getItem('sacode-theme')).toBe('light');
    view.unmount();
    const reloaded = render();
    expect(document.documentElement.dataset.theme).toBe('light');
    await reloaded.get('[data-theme-toggle]').trigger('click');
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(localStorage.getItem('sacode-theme')).toBe('dark');
  });

  it('非法保存值回退深色', () => {
    localStorage.setItem('sacode-theme', 'invalid');
    render();
    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  it('存储读取失败不阻止页面与本次切换', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('不可读');
    });
    const view = render();
    expect(document.documentElement.dataset.theme).toBe('dark');
    await view.get('[data-theme-toggle]').trigger('click');
    expect(document.documentElement.dataset.theme).toBe('light');
  });

  it('存储写入失败仍允许双向切换', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('不可写');
    });
    const view = render();
    await view.get('[data-theme-toggle]').trigger('click');
    expect(document.documentElement.dataset.theme).toBe('light');
    await view.get('[data-theme-toggle]').trigger('click');
    expect(document.documentElement.dataset.theme).toBe('dark');
  });
});
