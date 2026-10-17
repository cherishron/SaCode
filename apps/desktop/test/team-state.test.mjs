import assert from 'node:assert/strict';
import { describe, it, beforeEach, afterEach } from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Ensure globalThis.window exists for IIFE scripts (Node test env)
if (typeof globalThis.window === 'undefined') globalThis.window = globalThis;

// Load the IIFE script into globalThis
const scriptPath = join(__dirname, '../renderer/team-state.js');
const scriptContent = readFileSync(scriptPath, 'utf8');
eval(scriptContent);

function makeDeps(overrides = {}) {
  const ref = (v) => ({ value: v });
  const api = {
    teamDescribe: async () => ({ members: [], tasks: [], messages: [] }),
    teamMemberCreate: async () => ({}),
    teamMessageSend: async () => ({}),
    teamTaskCreate: async () => ({}),
    teamTaskAssign: async () => ({}),
    teamMemberStop: async () => ({}),
  };
  return {
    api,
    ref,
    sideOpen: ref(true),
    sideTab: ref('agents'),
    pluginManagerOpen: ref(false),
    scrollSession: ref('sess-1'),
    teamSessionId: ref(''),
    teamSnapshot: ref(null),
    teamBusy: ref(false),
    teamError: ref(''),
    teamTimerRef: ref(null),
    teamGenerationRef: ref(0),
    teamNavigationIdRef: ref(''),
    teamDisposedRef: ref(false),
    getSelectedSession: () => 'other',
    selectSession: async () => {},
    ...overrides,
  };
}

describe('team-state', () => {
  it('stopTeamRefresh 清空 timer 并自增 generation', () => {
    const deps = makeDeps();
    const assembly = window.SaCodeTeamState.createTeamAssembly(deps);
    // 先启动一个 timer
    deps.teamTimerRef.value = setInterval(() => {}, 1000);
    assembly.stopTeamRefresh();
    assert.equal(deps.teamTimerRef.value, null);
    assert.equal(deps.teamGenerationRef.value, 1);
  });

  it('refreshTeam 守卫：非激活态不执行', async () => {
    const deps = makeDeps({ sideTab: { value: 'other' } });
    const assembly = window.SaCodeTeamState.createTeamAssembly(deps);
    await assembly.refreshTeam();
    assert.equal(deps.teamBusy.value, false);
  });

  it('refreshTeam 守卫：busy 时跳过', async () => {
    const deps = makeDeps({ teamBusy: { value: true } });
    const assembly = window.SaCodeTeamState.createTeamAssembly(deps);
    await assembly.refreshTeam();
    // 没有抛错即通过
  });

  it('refreshTeam 守卫：无 teamSessionId 时跳过', async () => {
    const deps = makeDeps({ teamSessionId: { value: '' } });
    const assembly = window.SaCodeTeamState.createTeamAssembly(deps);
    await assembly.refreshTeam();
    assert.equal(deps.teamBusy.value, false);
  });

  it('selectTeamSession 调用 selectSession 并在不匹配时写错', async () => {
    let selected = null;
    const deps = makeDeps({
      scrollSession: { value: 'other' },
      selectSession: async (id) => { selected = id; },
    });
    const assembly = window.SaCodeTeamState.createTeamAssembly(deps);
    await assembly.selectTeamSession('sess-xyz');
    assert.equal(selected, 'sess-xyz');
    assert.ok(deps.teamError.value.length > 0);
  });

  it('成员跳转以选中会话为准，不把尚未刷新的投影误判为失败', async () => {
    const deps = makeDeps({ getSelectedSession: () => 'member', scrollSession: { value: 'old' } });
    await window.SaCodeTeamState.createTeamAssembly(deps).selectTeamSession('member');
    assert.equal(deps.teamError.value, '');
    assert.equal(deps.teamNavigationIdRef.value, 'member');
  });

  it('addTeamMember/sendTeamMessage/createTeamTask/assignTeamTask/stopTeamMember 委托 writeTeam', async () => {
    const calls = [];
    const deps = makeDeps({ teamSessionId: { value: 'sess-1' } });
    for (const method of ['teamMemberCreate', 'teamMessageSend', 'teamTaskCreate', 'teamTaskAssign', 'teamMemberStop']) {
      deps.api[method] = async (...args) => { calls.push({ method, args }); };
    }
    const assembly = window.SaCodeTeamState.createTeamAssembly(deps);
    await assembly.addTeamMember({ name: 'n', role: 'r' });
    await assembly.sendTeamMessage({ target: 't', text: 'x' });
    await assembly.createTeamTask({ title: 't', dependencies: [] });
    await assembly.assignTeamTask({ taskId: 'tid', memberId: 'mid' });
    await assembly.stopTeamMember('mid');
    assert.equal(calls.length, 5);
    assert.equal(calls[0].method, 'teamMemberCreate');
    assert.equal(calls[1].method, 'teamMessageSend');
    assert.equal(calls[2].method, 'teamTaskCreate');
    assert.equal(calls[3].method, 'teamTaskAssign');
    assert.equal(calls[4].method, 'teamMemberStop');
  });
});
