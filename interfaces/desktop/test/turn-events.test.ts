import assert from 'node:assert/strict';
import test from 'node:test';
import {
  framesToEvents,
  turnsToDisplayItems,
  resolveContextWindow,
  resolveTokenUsage,
  computeContextPercent,
  thinkLevelToReasoningEffort,
  loadDraft,
  saveDraft,
  clearDraft,
  FALLBACK_CONTEXT_WINDOW,
  lingShuCardKind,
  isCollapsibleCard,
  defaultCollapsed,
  conflictTone,
  conflictToneClass,
  type LegacyFrame,
} from '../src/ui/logic/turn-events.ts';

// ---- framesToEvents ----

test('framesToEvents maps assistant frames to text events', () => {
  const frames: LegacyFrame[] = [
    { seq: 0, kind: 'assistant', text: 'hello world', detail: null },
  ];
  const events = framesToEvents(frames);
  assert.equal(events.length, 1);
  assert.equal(events[0]!.type, 'text');
  assert.equal((events[0] as { text: string }).text, 'hello world');
});

test('framesToEvents maps thinking frames (detail=thinking) to thinking events', () => {
  const frames: LegacyFrame[] = [
    { seq: 0, kind: 'tool', text: 'let me think…', detail: 'thinking' },
  ];
  const events = framesToEvents(frames);
  assert.equal(events.length, 1);
  assert.equal(events[0]!.type, 'thinking');
  assert.equal((events[0] as { text: string }).text, 'let me think…');
  assert.equal((events[0] as { collapsed?: boolean }).collapsed, true);
});

test('framesToEvents maps tool_call_started + finished into a single tool event', () => {
  const frames: LegacyFrame[] = [
    { seq: 0, kind: 'tool', text: 'fs.read', detail: '{"path":"src/main.rs"}' },
    { seq: 1, kind: 'tool', text: 'fs.read ✓', detail: null },
  ];
  const events = framesToEvents(frames);
  // finished 合并进 started
  assert.equal(events.length, 1);
  const ev = events[0]!;
  assert.equal(ev.type, 'tool');
  if (ev.type === 'tool') {
    assert.equal(ev.tool, 'fs.read');
    assert.equal(ev.status, 'ok');
    assert.deepEqual(ev.input, { path: 'src/main.rs' });
  }
});

test('framesToEvents marks failed tool with err status', () => {
  const frames: LegacyFrame[] = [
    { seq: 0, kind: 'tool', text: 'shell.exec', detail: '{"command":"rm"}' },
    { seq: 1, kind: 'tool', text: 'shell.exec ✗', detail: null },
  ];
  const events = framesToEvents(frames);
  assert.equal(events.length, 1);
  if (events[0]!.type === 'tool') assert.equal(events[0]!.status, 'err');
});

test('framesToEvents maps approval frames to approval events', () => {
  const frames: LegacyFrame[] = [
    {
      seq: 0,
      kind: 'approval',
      text: 'fs.write',
      detail: '{"approval_id":"ap-1","tool_name":"fs.write","side_effect_level":"Medium","args":{"path":"x.rs"}}',
    },
  ];
  const events = framesToEvents(frames);
  assert.equal(events.length, 1);
  const ev = events[0]!;
  assert.equal(ev.type, 'approval');
  if (ev.type === 'approval') {
    assert.equal(ev.approval_id, 'ap-1');
    assert.equal(ev.tool, 'fs.write');
    assert.equal(ev.status, 'pending');
  }
});

test('framesToEvents maps resolved approval frames', () => {
  const frames: LegacyFrame[] = [
    {
      seq: 0,
      kind: 'approval',
      text: '审批通过: ap-1',
      detail: '{"approval_id":"ap-1","approved":true,"reason":null}',
    },
  ];
  const events = framesToEvents(frames);
  if (events[0]!.type === 'approval') assert.equal(events[0]!.status, 'approved');
});

// ---- turnsToDisplayItems ----

test('turnsToDisplayItems produces user + text + error items from events', () => {
  const items = turnsToDisplayItems([
    {
      task_id: 'task-1',
      prompt: 'do something',
      events: [
        { type: 'text', seq: 0, text: 'done' },
      ],
      error: 'something broke',
    },
  ]);
  const types = items.map((i) => i.type);
  assert.ok(types.includes('user'));
  assert.ok(types.includes('text'));
  assert.ok(types.includes('error'));
});

test('turnsToDisplayItems falls back to frames when events absent', () => {
  const items = turnsToDisplayItems([
    {
      task_id: 'task-1',
      prompt: 'run',
      frames: [
        { seq: 0, kind: 'tool', text: 'thinking hard', detail: 'thinking' },
        { seq: 1, kind: 'assistant', text: 'result', detail: null },
      ],
    },
  ]);
  const types = items.map((i) => i.type);
  assert.ok(types.includes('user'));
  assert.ok(types.includes('thinking'));
  assert.ok(types.includes('text'));
});

// ---- context window / usage ----

test('resolveContextWindow finds context_window from latest turn', () => {
  const w = resolveContextWindow([
    { usage: { context_window: 128_000 } },
    { usage: { context_window: 200_000 } },
  ]);
  assert.equal(w, 200_000);
});

test('resolveContextWindow returns null when absent', () => {
  assert.equal(resolveContextWindow([{}]), null);
  assert.equal(resolveContextWindow([]), null);
});

test('resolveTokenUsage sums input + output from latest turn', () => {
  const usage = resolveTokenUsage([
    { usage: { input_tokens: 100, output_tokens: 50 } },
  ]);
  assert.deepEqual(usage, { input: 100, output: 50, total: 150 });
});

test('computeContextPercent clamps to 0–100', () => {
  assert.equal(computeContextPercent(50_000, 100_000), 50);
  assert.equal(computeContextPercent(200_000, 100_000), 100);
  assert.equal(computeContextPercent(0, 100_000), 0);
  assert.equal(computeContextPercent(100, 0), 0);
});

// ---- thinkLevel → reasoning_effort ----

test('thinkLevelToReasoningEffort maps off to null', () => {
  assert.equal(thinkLevelToReasoningEffort('off'), null);
  assert.equal(thinkLevelToReasoningEffort('low'), 'low');
  assert.equal(thinkLevelToReasoningEffort('medium'), 'medium');
  assert.equal(thinkLevelToReasoningEffort('high'), 'high');
});

// ---- draft persistence ----

test('draft save/load/clear roundtrip per conversation', () => {
  // 模拟 localStorage
  const store = new Map<string, string>();
  const origGet = globalThis.localStorage?.getItem;
  const origSet = globalThis.localStorage?.setItem;
  const origRemove = globalThis.localStorage?.removeItem;
  // 注入 mock
  (globalThis as Record<string, unknown>).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, v); },
    removeItem: (k: string) => { store.delete(k); },
  };
  try {
    assert.equal(loadDraft('conv-1'), '');
    saveDraft('conv-1', 'hello draft');
    assert.equal(loadDraft('conv-1'), 'hello draft');
    saveDraft('conv-2', 'other draft');
    assert.equal(loadDraft('conv-2'), 'other draft');
    assert.equal(loadDraft('conv-1'), 'hello draft'); // 隔离
    clearDraft('conv-1');
    assert.equal(loadDraft('conv-1'), '');
    assert.equal(loadDraft('conv-2'), 'other draft'); // 不受影响
  } finally {
    if (origGet) (globalThis as Record<string, unknown>).localStorage = { getItem: origGet, setItem: origSet, removeItem: origRemove };
    else delete (globalThis as Record<string, unknown>).localStorage;
  }
});

test('FALLBACK_CONTEXT_WINDOW is 200k', () => {
  assert.equal(FALLBACK_CONTEXT_WINDOW, 200_000);
});

// ---- 灵枢四卡：卡片类型分类（§2.3）----

test('lingShuCardKind classifies the four ling-shu event types', () => {
  assert.equal(lingShuCardKind('role_assignment'), 'role-assignment');
  assert.equal(lingShuCardKind('conflict'), 'conflict');
  assert.equal(lingShuCardKind('model_route'), 'model-route');
  assert.equal(lingShuCardKind('summary'), 'summary');
});

test('lingShuCardKind returns null for non-ling-shu types', () => {
  for (const t of ['text', 'thinking', 'tool', 'approval', 'ask', 'subagent', 'user', 'error', 'system']) {
    assert.equal(lingShuCardKind(t), null, `type=${t}`);
  }
});

// ---- 灵枢四卡：折叠默认值（§2.3）----

test('isCollapsibleCard matches contract collapsible set', () => {
  // 可折叠：thinking / tool / subagent / role_assignment / model_route
  for (const t of ['thinking', 'tool', 'subagent', 'role_assignment', 'model_route']) {
    assert.equal(isCollapsibleCard(t), true, `type=${t}`);
    assert.equal(defaultCollapsed(t), true, `type=${t}`);
  }
  // 非折叠：conflict（未决警示）、summary（收尾）及普通卡
  for (const t of ['conflict', 'summary', 'text', 'user', 'error', 'system', 'approval', 'ask']) {
    assert.equal(isCollapsibleCard(t), false, `type=${t}`);
    assert.equal(defaultCollapsed(t), false, `type=${t}`);
  }
});

// ---- 灵枢四卡：conflict 状态 → 样式类映射 ----

test('conflictTone maps status to warning/success/muted', () => {
  assert.equal(conflictTone('detected'), 'warning');
  assert.equal(conflictTone('intervening'), 'warning');
  assert.equal(conflictTone('resolved'), 'success');
  assert.equal(conflictTone('ignored'), 'muted');
  // 未知状态按警示处理
  assert.equal(conflictTone('unknown'), 'warning');
});

test('conflictToneClass emits chat-card tone class', () => {
  assert.equal(conflictToneClass('detected'), 'chat-card--conflict-warning');
  assert.equal(conflictToneClass('intervening'), 'chat-card--conflict-warning');
  assert.equal(conflictToneClass('resolved'), 'chat-card--conflict-success');
  assert.equal(conflictToneClass('ignored'), 'chat-card--conflict-muted');
});

// ---- 灵枢四卡：framesToEvents 旧帧映射（§12.4）----

test('framesToEvents maps role_assignment frames (detail=roles[])', () => {
  const frames: LegacyFrame[] = [
    {
      seq: 0,
      kind: 'role_assignment',
      text: '',
      detail: JSON.stringify([
        { role_id: 'coder', role_name: '编码', score: 0.9, reason: '匹配实现', model_name: 'm1' },
      ]),
    },
  ];
  const events = framesToEvents(frames);
  assert.equal(events.length, 1);
  const ev = events[0]!;
  assert.equal(ev.type, 'role_assignment');
  if (ev.type === 'role_assignment') {
    assert.equal(ev.roles.length, 1);
    assert.equal(ev.roles[0]!.role_id, 'coder');
    assert.equal(ev.roles[0]!.score, 0.9);
    assert.equal(ev.roles[0]!.model_name, 'm1');
  }
});

test('framesToEvents maps conflict frames with status and details', () => {
  const frames: LegacyFrame[] = [
    {
      seq: 0,
      kind: 'conflict',
      text: 'fallback',
      detail: JSON.stringify({
        conflict_id: 'c-1',
        kind: 'validation_conflict',
        summary: '校验冲突',
        details: ['d1', 'd2'],
        status: 'intervening',
        intervention: { target_role: 'coder', action: 'dispatch_fix_loop' },
      }),
    },
  ];
  const events = framesToEvents(frames);
  assert.equal(events[0]!.type, 'conflict');
  if (events[0]!.type === 'conflict') {
    assert.equal(events[0]!.summary, '校验冲突');
    assert.equal(events[0]!.status, 'intervening');
    assert.deepEqual(events[0]!.details, ['d1', 'd2']);
    assert.equal(events[0]!.intervention?.action, 'dispatch_fix_loop');
  }
});

test('framesToEvents maps model_route frames with failed_over', () => {
  const frames: LegacyFrame[] = [
    {
      seq: 0,
      kind: 'model_route',
      text: '',
      detail: JSON.stringify({
        role_id: 'coder',
        primary: { provider: 'openai', model: 'gpt-5', score: 0.8 },
        fallbacks: [{ provider: 'anthropic', model: 'claude' }],
        failed_over: true,
        reason: '主模型超时',
      }),
    },
  ];
  const events = framesToEvents(frames);
  assert.equal(events[0]!.type, 'model_route');
  if (events[0]!.type === 'model_route') {
    assert.equal(events[0]!.primary.model, 'gpt-5');
    assert.equal(events[0]!.fallbacks?.length, 1);
    assert.equal(events[0]!.failed_over, true);
  }
});

test('framesToEvents maps summary frames with conclusion/risks/next', () => {
  const frames: LegacyFrame[] = [
    {
      seq: 0,
      kind: 'summary',
      text: '修 bug',
      detail: JSON.stringify({
        task: '修 bug',
        conclusion: '已修复',
        key_risks: ['并发风险'],
        next_action: '补测试',
      }),
    },
  ];
  const events = framesToEvents(frames);
  assert.equal(events[0]!.type, 'summary');
  if (events[0]!.type === 'summary') {
    assert.equal(events[0]!.conclusion, '已修复');
    assert.deepEqual(events[0]!.key_risks, ['并发风险']);
    assert.equal(events[0]!.next_action, '补测试');
  }
});

test('framesToEvents falls back to text when ling-shu detail is unparseable', () => {
  const frames: LegacyFrame[] = [
    { seq: 0, kind: 'conflict', text: 'raw conflict', detail: 'not-json' },
    { seq: 1, kind: 'model_route', text: 'raw route', detail: '{"no_primary":true}' },
  ];
  const events = framesToEvents(frames);
  assert.equal(events.length, 2);
  assert.equal(events[0]!.type, 'text');
  assert.equal(events[1]!.type, 'text');
});
