/**
 * 轮次事件模型与卡片映射（契约 §2.2 / §2.3）。
 *
 * 真源：docs/plans/desktop-interface-contract.md
 * - `events[]` 由 Agent4 在 daemon 侧产出后直接消费。
 * - 旧帧（frames[]）通过 `framesToEvents` 兼容映射，保证未升级时卡片可用。
 * - 草稿 localStorage 兜底：`sacode.draft.<conversationId>`，Agent4
 *   `ConversationSettings.draft` API 就绪后可切换（见 loadDraft/saveDraft）。
 */

import type {
  TurnEvent,
  TurnUsage,
  TurnSettingsSnapshot,
  ReasoningEffort,
} from '@cherishron/sacode-client-core';

// 契约类型全部来自 client-core（dist 已重建，含灵枢四臂）
export type { TurnEvent, TurnUsage, TurnSettingsSnapshot, ReasoningEffort };

/** 自组织 — 角色驱动编排 */
export type RoleAssignmentEvent = Extract<TurnEvent, { type: 'role_assignment' }>;
export type RoleAssignmentRole = RoleAssignmentEvent['roles'][number];

/** 自防护 — 五维冲突检测 + 实时干预 */
export type ConflictEvent = Extract<TurnEvent, { type: 'conflict' }>;
export type ConflictStatus = ConflictEvent['status'];

/** 自愈合 — 故障转移路由 */
export type ModelRouteEvent = Extract<TurnEvent, { type: 'model_route' }>;
export type ModelRouteTarget = ModelRouteEvent['primary'];

/** 结构化摘要（编排收尾） */
export type SummaryEvent = Extract<TurnEvent, { type: 'summary' }>;

export type TurnEventKind = TurnEvent['type'];

/** 兼容旧 frames[] 的结构（daemon-client 的 DesktopConversationTurn.frames）。 */
export interface LegacyFrame {
  seq: number;
  kind: string;
  text: string;
  detail?: string | null;
}

/** 展示层条目：在 TurnEvent 基础上携带会话/任务归属。 */
export type DisplayItem = (TurnEvent & { id: string; taskId?: string }) | {
  type: 'user';
  id: string;
  taskId?: string;
  text: string;
} | {
  type: 'error';
  id: string;
  taskId?: string;
  text: string;
} | {
  type: 'system';
  id: string;
  taskId?: string;
  text: string;
};

// ---------------------------------------------------------------------------
// 灵枢四卡映射（契约 §2.3）— 纯逻辑，ChatCard 与测试共用
// ---------------------------------------------------------------------------

/** 灵枢四类事件的卡片形态标识 */
export type LingShuCardKind = 'role-assignment' | 'conflict' | 'model-route' | 'summary';

const LING_SHU_CARD_KINDS: Record<string, LingShuCardKind> = {
  role_assignment: 'role-assignment',
  conflict: 'conflict',
  model_route: 'model-route',
  summary: 'summary',
};

/** 事件类型 → 灵枢卡片形态；非灵枢事件返回 null */
export function lingShuCardKind(type: string): LingShuCardKind | null {
  return LING_SHU_CARD_KINDS[type] ?? null;
}

/**
 * 卡片是否有折叠交互。
 * 契约 §2.3：thinking / tool / subagent / role_assignment / model_route 可折叠；
 * conflict、summary 为非折叠卡（未决/收尾直接展开）。
 */
export function isCollapsibleCard(type: string): boolean {
  return type === 'thinking'
    || type === 'tool'
    || type === 'subagent'
    || type === 'role_assignment'
    || type === 'model_route';
}

/** 默认折叠（契约 §2.3）：可折叠卡默认收起，其余默认展开 */
export function defaultCollapsed(type: string): boolean {
  return isCollapsibleCard(type);
}

/** conflict.status → 色调：detected/intervening 警示、resolved 成功、ignored 弱化 */
export type ConflictTone = 'warning' | 'success' | 'muted';

export function conflictTone(status: string): ConflictTone {
  switch (status) {
    case 'resolved': return 'success';
    case 'ignored': return 'muted';
    default: return 'warning'; // detected / intervening / 未知状态按警示处理
  }
}

/** conflict.status → ChatCard 样式类 */
export function conflictToneClass(status: string): string {
  return `chat-card--conflict-${conflictTone(status)}`;
}

// ---------------------------------------------------------------------------
// 帧 → 事件映射（旧数据兼容）
// ---------------------------------------------------------------------------

/**
 * 将 daemon 落盘的 frames[] 映射为 TurnEvent[]。
 *
 * 帧格式来自 runtime/src/daemon/events.rs + approval.rs：
 * - kind="assistant"              → text
 * - kind="tool", detail="thinking" → thinking
 * - kind="tool", detail=JSON args  → tool(running/ok 合并)
 * - kind="tool", detail="plan"     → tool（计划）
 * - kind="tool", detail=null       → tool 收尾（text 含 ✓/✗）
 * - kind="error"                   → error（走 DisplayItem）
 * - kind="approval", detail=JSON   → approval
 */
export function framesToEvents(frames: LegacyFrame[]): TurnEvent[] {
  const events: TurnEvent[] = [];
  /** tool 启动帧 seq → events 索引，便于合并收尾状态 */
  const toolStartIndex = new Map<number, number>();

  for (const frame of frames) {
    const seq = frame.seq;
    const detail = frame.detail ?? undefined;

    if (frame.kind === 'assistant') {
      events.push({ type: 'text', seq, text: frame.text });
      continue;
    }

    if (frame.kind === 'error') {
      // error 不属于 TurnEvent 联合，由调用方处理；此处跳过
      continue;
    }

    if (frame.kind === 'approval') {
      events.push(parseApprovalFrame(seq, frame.text, detail));
      continue;
    }

    // 灵枢四类帧（契约 §12.4）：detail JSON → 对应 TurnEvent；解析失败回退 text
    if (frame.kind === 'role_assignment' || frame.kind === 'conflict'
      || frame.kind === 'model_route' || frame.kind === 'summary') {
      const ev = parseLingShuFrame(seq, frame.kind, frame.text, detail);
      events.push(ev ?? { type: 'text', seq, text: frame.text });
      continue;
    }

    if (frame.kind === 'tool') {
      if (detail === 'thinking') {
        events.push({ type: 'thinking', seq, text: frame.text, collapsed: true });
        continue;
      }
      if (detail === 'plan') {
        events.push({
          type: 'tool',
          seq,
          tool: 'plan',
          output: frame.text,
          status: 'ok',
        });
        continue;
      }
      if (detail) {
        // tool_call_started：text=工具名，detail=JSON args
        let input: unknown;
        try {
          input = JSON.parse(detail);
        } catch {
          input = detail;
        }
        const idx = events.length;
        events.push({
          type: 'tool',
          seq,
          tool: frame.text,
          input,
          status: 'running',
        });
        toolStartIndex.set(seq, idx);
        continue;
      }
      // tool_call_finished：text="toolname ✓/✗"
      const match = frame.text.match(/^(.*?)\s*([✓✗])\s*$/);
      if (match) {
        const toolName = match[1]!.trim();
        const ok = match[2] === '✓';
        // 回填同名启动帧的状态
        const startIdx = findToolStart(events, toolName);
        if (startIdx >= 0) {
          const ev = events[startIdx]!;
          if (ev.type === 'tool') ev.status = ok ? 'ok' : 'err';
        } else {
          events.push({
            type: 'tool',
            seq,
            tool: toolName,
            status: ok ? 'ok' : 'err',
          });
        }
      } else {
        events.push({ type: 'tool', seq, tool: frame.text, status: 'ok' });
      }
      continue;
    }
  }
  return events;
}

function findToolStart(events: TurnEvent[], toolName: string): number {
  for (let i = events.length - 1; i >= 0; i--) {
    const ev = events[i]!;
    if (ev.type === 'tool' && ev.tool === toolName && ev.status === 'running') return i;
  }
  return -1;
}

function parseApprovalFrame(seq: number, text: string, detail?: string): TurnEvent {
  let approvalId = '';
  let tool = text;
  let summary = text;
  let status: 'pending' | 'approved' | 'rejected' = 'pending';
  let diff: string | undefined;
  if (detail) {
    try {
      const d = JSON.parse(detail) as Record<string, unknown>;
      approvalId = typeof d.approval_id === 'string' ? d.approval_id : '';
      if (typeof d.tool_name === 'string') tool = d.tool_name;
      if (typeof d.approved === 'boolean') status = d.approved ? 'approved' : 'rejected';
      if (d.args !== undefined) {
        summary = typeof d.args === 'string' ? d.args : JSON.stringify(d.args).slice(0, 200);
      }
    } catch { /* keep defaults */ }
  }
  return { type: 'approval', seq, approval_id: approvalId, tool, summary, diff, status };
}

/**
 * 灵枢帧 → TurnEvent（契约 §12.4）。
 * detail JSON 字段缺失时不伪造：必填字段补不齐则返回 null，由调用方回退 text。
 */
function parseLingShuFrame(
  seq: number,
  kind: 'role_assignment' | 'conflict' | 'model_route' | 'summary',
  text: string,
  detail?: string,
): TurnEvent | null {
  let d: Record<string, unknown> = {};
  if (detail) {
    try {
      const parsed: unknown = JSON.parse(detail);
      if (Array.isArray(parsed)) {
        // role_assignment 帧允许直接落 roles[]
        if (kind === 'role_assignment') d = { roles: parsed };
        else return null;
      } else if (parsed && typeof parsed === 'object') {
        d = parsed as Record<string, unknown>;
      } else {
        return null;
      }
    } catch {
      return null;
    }
  }

  if (kind === 'role_assignment') {
    const rawRoles = Array.isArray(d.roles) ? d.roles : [];
    const roles = rawRoles
      .filter((r): r is Record<string, unknown> => !!r && typeof r === 'object')
      .map((r) => ({
        role_id: typeof r.role_id === 'string' ? r.role_id : '',
        ...(typeof r.role_name === 'string' ? { role_name: r.role_name } : {}),
        ...(typeof r.score === 'number' ? { score: r.score } : {}),
        ...(typeof r.reason === 'string' ? { reason: r.reason } : {}),
        ...(typeof r.model_provider === 'string' ? { model_provider: r.model_provider } : {}),
        ...(typeof r.model_name === 'string' ? { model_name: r.model_name } : {}),
      }));
    return { type: 'role_assignment', seq, roles };
  }

  if (kind === 'conflict') {
    const summary = typeof d.summary === 'string' ? d.summary : text;
    if (!summary) return null;
    const statusRaw = typeof d.status === 'string' ? d.status : 'detected';
    const status: ConflictStatus = statusRaw === 'intervening' || statusRaw === 'resolved' || statusRaw === 'ignored'
      ? statusRaw
      : 'detected';
    const details = Array.isArray(d.details)
      ? d.details.filter((x): x is string => typeof x === 'string')
      : undefined;
    let intervention: ConflictEvent['intervention'] | undefined;
    if (d.intervention && typeof d.intervention === 'object') {
      const iv = d.intervention as Record<string, unknown>;
      intervention = {
        ...(typeof iv.target_role === 'string' ? { target_role: iv.target_role } : {}),
        ...(typeof iv.action === 'string' ? { action: iv.action } : {}),
      };
    }
    return {
      type: 'conflict',
      seq,
      ...(typeof d.conflict_id === 'string' ? { conflict_id: d.conflict_id } : {}),
      kind: typeof d.kind === 'string' ? d.kind : 'unknown',
      summary,
      ...(details ? { details } : {}),
      status,
      ...(intervention ? { intervention } : {}),
    };
  }

  if (kind === 'model_route') {
    const p = d.primary;
    if (!p || typeof p !== 'object') return null;
    const primary = p as Record<string, unknown>;
    if (typeof primary.provider !== 'string' || typeof primary.model !== 'string') return null;
    const fallbacks = Array.isArray(d.fallbacks)
      ? d.fallbacks
        .filter((f): f is Record<string, unknown> => !!f && typeof f === 'object')
        .map((f) => ({
          provider: typeof f.provider === 'string' ? f.provider : '',
          model: typeof f.model === 'string' ? f.model : '',
          ...(typeof f.score === 'number' ? { score: f.score } : {}),
        }))
      : undefined;
    return {
      type: 'model_route',
      seq,
      ...(typeof d.role_id === 'string' ? { role_id: d.role_id } : {}),
      primary: {
        provider: primary.provider,
        model: primary.model,
        ...(typeof primary.score === 'number' ? { score: primary.score } : {}),
        ...(typeof primary.needs_thinking === 'boolean' ? { needs_thinking: primary.needs_thinking } : {}),
      },
      ...(fallbacks ? { fallbacks } : {}),
      ...(typeof d.reason === 'string' ? { reason: d.reason } : {}),
      ...(typeof d.failed_over === 'boolean' ? { failed_over: d.failed_over } : {}),
    };
  }

  // summary
  const task = typeof d.task === 'string' ? d.task : text;
  if (!task) return null;
  return {
    type: 'summary',
    seq,
    task,
    ...(Array.isArray(d.roles)
      ? { roles: d.roles.filter((x): x is string => typeof x === 'string') }
      : {}),
    ...(typeof d.conclusion === 'string' ? { conclusion: d.conclusion } : {}),
    ...(Array.isArray(d.key_risks)
      ? { key_risks: d.key_risks.filter((x): x is string => typeof x === 'string') }
      : {}),
    ...(typeof d.next_action === 'string' ? { next_action: d.next_action } : {}),
    ...(Array.isArray(d.conflicts)
      ? { conflicts: d.conflicts.filter((x): x is string => typeof x === 'string') }
      : {}),
  };
}

// ---------------------------------------------------------------------------
// 轮次 → 展示条目
// ---------------------------------------------------------------------------

export interface TurnLike {
  task_id?: string;
  prompt?: string;
  status?: string;
  output?: string | null;
  error?: string | null;
  frames?: LegacyFrame[];
  events?: TurnEvent[];
  usage?: TurnUsage;
  settings_snapshot?: TurnSettingsSnapshot;
}

/**
 * 将轮次列表展开为按时间排序的 DisplayItem[]。
 * 优先消费 events[]；缺失时从 frames[] 映射；最后补 output / error。
 */
export function turnsToDisplayItems(turns: TurnLike[]): DisplayItem[] {
  const items: DisplayItem[] = [];
  for (const turn of turns) {
    const taskId = turn.task_id ?? '';
    items.push({
      type: 'user',
      id: `${taskId}-user`,
      taskId,
      text: turn.prompt ?? '',
    });

    const events: TurnEvent[] = turn.events?.length
      ? turn.events
      : framesToEvents(turn.frames ?? []);

    for (const ev of events) {
      items.push({ ...ev, id: `${taskId}-ev-${ev.seq}`, taskId });
    }

    // error 不在 TurnEvent 联合中，单独追加
    if (turn.error && !turn.frames?.some((f) => f.kind === 'error' && f.text === turn.error)) {
      items.push({
        type: 'error',
        id: `${taskId}-err`,
        taskId,
        text: turn.error,
      });
    }
    if (
      turn.output
      && !events.some((e) => e.type === 'text' && e.text === turn.output)
      && !turn.frames?.some((f) => f.kind === 'assistant' && f.text === turn.output)
    ) {
      items.push({
        type: 'text',
        id: `${taskId}-out`,
        taskId,
        text: turn.output,
        seq: -1,
      });
    }
  }
  return items;
}

// ---------------------------------------------------------------------------
// 草稿持久化（§6.1）— localStorage 兜底
// ---------------------------------------------------------------------------

const DRAFT_PREFIX = 'sacode.draft.';

function draftKey(conversationId: string): string {
  return `${DRAFT_PREFIX}${conversationId}`;
}

export function loadDraft(conversationId: string | null | undefined): string {
  if (!conversationId) return '';
  try {
    return localStorage.getItem(draftKey(conversationId)) ?? '';
  } catch {
    return '';
  }
}

export function saveDraft(conversationId: string | null | undefined, text: string): void {
  if (!conversationId) return;
  try {
    if (text) localStorage.setItem(draftKey(conversationId), text);
    else localStorage.removeItem(draftKey(conversationId));
  } catch { /* storage may be unavailable */ }
}

export function clearDraft(conversationId: string | null | undefined): void {
  if (!conversationId) return;
  try {
    localStorage.removeItem(draftKey(conversationId));
  } catch { /* ignore */ }
}

// ---------------------------------------------------------------------------
// 上下文窗口（§1.3）
// ---------------------------------------------------------------------------

/** 契约允许的兜底窗口；仅当响应缺 context_window 时使用。 */
export const FALLBACK_CONTEXT_WINDOW = 200_000;

/**
 * 从轮次中提取真实 context_window（优先取最近一轮 usage）。
 * 返回 null 表示无法确定，调用方再决定是否兜底。
 */
export function resolveContextWindow(turns: TurnLike[]): number | null {
  for (let i = turns.length - 1; i >= 0; i--) {
    const w = turns[i]?.usage?.context_window;
    if (typeof w === 'number' && w > 0) return w;
  }
  return null;
}

/** 从轮次中取最近一轮 token 用量（input+output 或已有 total）。 */
export function resolveTokenUsage(turns: TurnLike[]): { input: number; output: number; total: number } | null {
  for (let i = turns.length - 1; i >= 0; i--) {
    const u = turns[i]?.usage;
    if (!u) continue;
    const input = u.input_tokens ?? 0;
    const output = u.output_tokens ?? 0;
    const total = input + output;
    if (total > 0) return { input, output, total };
  }
  return null;
}

export function computeContextPercent(tokens: number, windowSize: number): number {
  if (windowSize <= 0) return 0;
  return Math.round(Math.min(100, Math.max(0, (tokens / windowSize) * 100)));
}

// ---------------------------------------------------------------------------
// 发送扩展字段（§1.2）
// ---------------------------------------------------------------------------

export interface SendExtras {
  /** 思考深度；null=跟随 provider 默认 */
  reasoningEffort?: ReasoningEffort;
  /** 技能多选；空数组=不注入技能 */
  skills?: string[];
  /** 幂等去重 */
  clientMsgId?: string;
}

/** thinkLevel UI 值 → 契约 reasoning_effort。'off' 映射为 null（跟随 provider 默认）。 */
export function thinkLevelToReasoningEffort(
  level: 'off' | 'low' | 'medium' | 'high',
): ReasoningEffort {
  return level === 'off' ? null : level;
}
