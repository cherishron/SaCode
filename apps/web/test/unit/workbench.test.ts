// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils';
import { reactive } from 'vue';
import Workbench from '../../src/pages/WorkbenchPage.vue';

const fixture = vi.hoisted(() => ({ getStore: (() => null) as () => unknown }));
vi.mock('../../src/stores/sessions', () => ({ useSessionsStore: () => fixture.getStore() }));
let view: VueWrapper | undefined;
function setup() {
  const store = reactive({
    targets: [{ id: 'sim-1', label: '测试服务' }],
    selectedTargetId: 'sim-1',
    sessions: [
      { id: 's1', title: '界面优化', status: 'active', updatedAt: '2026-10-24T01:00:00Z' },
      { id: 's2', title: '检查测试', status: 'idle', updatedAt: '2026-10-23T01:00:00Z' },
    ],
    selectedSessionId: null as string | null,
    detail: null as null | {
      title: string;
      status: string;
      workspaceId: string;
      createdAt: string;
      updatedAt: string;
    },
    workspaceId: 'ws-test',
    error: null,
    cursor: null,
    loadingEvents: false,
    events: [] as { id: string; kind: string; at: string; summary: string }[],
    streamStatus: 'idle',
    refilling: false,
    loadTargets: vi.fn(async () => {}),
    selectTarget: vi.fn(async () => {}),
    disconnectStream: vi.fn(),
    selectSession: vi.fn(async (id: string) => {
      store.selectedSessionId = id;
      store.detail = {
        title: '界面优化',
        status: 'active',
        workspaceId: 'ws-test',
        createdAt: '',
        updatedAt: '',
      };
      store.events = [{ id: 'e1', kind: 'message', at: '', summary: '真实历史摘要' }];
    }),
    returnHome: vi.fn(() => {
      store.disconnectStream();
      store.selectedSessionId = null;
      store.detail = null;
      store.events = [];
    }),
    loadMoreEvents: vi.fn(),
    hasMore: false,
    loadingMore: false,
  });
  fixture.getStore = () => store;
  view = mount(Workbench);
  return { store, view };
}
afterEach(() => view?.unmount());
describe('桌面风格工作台首页', () => {
  it('首页使用原品牌欢迎语，发送明确禁用且不自动进入会话', async () => {
    const { view, store } = setup();
    await flushPromises();
    expect(view.get('h1').text()).toBe('让灵感，有迹可循。');
    expect(view.get('.hero-heading img').attributes('src')).toBe('/sacode-logo.png');
    expect(view.get('#web-composer').attributes('disabled')).toBeDefined();
    expect(view.get('.send-preview').attributes('disabled')).toBeDefined();
    expect(store.selectSession).not.toHaveBeenCalled();
  });
  it('会话搜索过滤侧栏，不改变实际会话数据', async () => {
    const { view, store } = setup();
    await flushPromises();
    await view.get('[aria-label="搜索会话"]').setValue('界面');
    expect(view.findAll('[data-sessions] .link')).toHaveLength(1);
    expect(store.sessions).toHaveLength(2);
  });
  it('选择会话显示历史，返回首页关闭流且清空旧内容', async () => {
    const { view, store } = setup();
    await flushPromises();
    await view.get('[data-sessions] .link').trigger('click');
    await flushPromises();
    expect(view.get('[data-events]').text()).toContain('真实历史摘要');
    await view.get('[data-home]').trigger('click');
    expect(store.disconnectStream).toHaveBeenCalled();
    expect(store.selectedSessionId).toBeNull();
    expect(view.get('[data-workbench-home]').exists()).toBe(true);
  });
  it('侧栏支持收起和恢复', async () => {
    const { view } = setup();
    await flushPromises();
    await view.get('[aria-label="收起侧栏"]').trigger('click');
    expect(view.classes()).toContain('sidebar-hidden');
    await view.get('[aria-label="展开侧栏"]').trigger('click');
    expect(view.classes()).not.toContain('sidebar-hidden');
  });
});
