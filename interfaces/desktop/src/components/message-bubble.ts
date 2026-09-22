/** MessageBubble — 用户/AI/系统消息气泡
 * Phase 5: tool 消息接入 ToolCard，assistant 思考内容接入 ThinkingBlock
 * kind: user | assistant | tool | system | error | approval | change
 */
import { el } from '../dom.ts';
import type { TimelineItem } from '../app/service.ts';
import { buildToolCard, type ToolCardData } from './tool-card.ts';
import { buildThinkingBlock } from './thinking-block.ts';

export function buildMessage(item: TimelineItem) {
  const { kind, text, detail } = item;

  switch (kind) {
    case 'user':
      return buildUserMessage(text);
    case 'assistant':
      return buildAssistantMessage(text, detail);
    case 'tool':
      return buildToolMessage(text, detail);
    case 'error':
      return buildErrorMessage(text, detail);
    case 'system':
      return buildSystemMessage(text);
    case 'approval':
      return buildApprovalNotice(text, detail);
    case 'change':
      return buildChangeNotice(text, detail);
    default:
      return buildSystemMessage(text);
  }
}

function buildUserMessage(text: string) {
  return el('div', { className: 'msg msg-user' }, [
    el('div', { className: 'msg-bubble' }, [
      el('span', { className: 'msg-role' }, ['你']),
      el('div', { className: 'msg-text' }, [text]),
    ]),
  ]);
}

function buildAssistantMessage(text: string, detail?: string) {
  return el('div', { className: 'msg msg-assistant' }, [
    el('span', { className: 'msg-role' }, ['AI']),
    // 正文
    el('div', { className: 'msg-text' }, [text]),
    // 思考内容用 ThinkingBlock 折叠展示
    ...(detail ? [buildThinkingBlock(detail)] : []),
  ]);
}

/** tool 消息：结构化为 ToolCard */
function buildToolMessage(text: string, detail?: string) {
  // 从 text 解析 "tool → path" 格式
  const arrowIdx = text.indexOf('→');
  const toolName = arrowIdx > 0 ? text.slice(0, arrowIdx).trim() : text.trim();
  const path = arrowIdx > 0 ? text.slice(arrowIdx + 1).trim() : '';

  const data: ToolCardData = {
    tool: toolName || 'tool',
    status: 'completed',
    ...(path ? { args: { path } } : {}),
  };

  return el('div', { className: 'msg msg-tool' }, [
    buildToolCard(data),
  ]);
}

function buildErrorMessage(text: string, detail?: string) {
  return el('div', { className: 'msg msg-error' }, [
    el('div', { className: 'msg-tool-header' }, [
      el('span', { className: 'msg-tool-icon' }, ['✕']),
      el('span', { className: 'msg-kind' }, ['error']),
    ]),
    el('div', { className: 'msg-text' }, [text]),
    ...(detail
      ? [el('pre', { className: 'msg-detail mono' }, [detail])]
      : []),
  ]);
}

function buildSystemMessage(text: string) {
  return el('div', { className: 'msg msg-system' }, [
    el('span', { className: 'msg-kind' }, ['system']),
    el('span', { className: 'msg-system-text' }, [text]),
  ]);
}

function buildApprovalNotice(text: string, detail?: string) {
  return el('div', { className: 'msg msg-approval' }, [
    el('span', { className: 'msg-tool-icon' }, ['⚠']),
    el('span', { className: 'msg-kind' }, ['approval']),
    el('div', { className: 'msg-text' }, [text]),
    ...(detail
      ? [el('pre', { className: 'msg-detail mono' }, [detail])]
      : []),
  ]);
}

function buildChangeNotice(text: string, detail?: string) {
  return el('div', { className: 'msg msg-change' }, [
    el('div', { className: 'msg-tool-header' }, [
      el('span', { className: 'msg-tool-icon' }, ['📝']),
      el('span', { className: 'msg-kind' }, ['change']),
    ]),
    el('div', { className: 'msg-text mono' }, [text]),
    ...(detail
      ? [el('pre', { className: 'msg-detail mono' }, [detail])]
      : []),
  ]);
}
