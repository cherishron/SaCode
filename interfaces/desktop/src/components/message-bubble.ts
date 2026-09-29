/** MessageBubble — 对话语义消息
 * user 气泡 / assistant 正文 / tool 折叠行 / system 细文本
 */
import { el } from '../dom.ts';
import type { TimelineItem } from '../app/service.ts';
import { buildToolCard, type ToolCardData } from './tool-card.ts';
import { buildThinkingBlock } from './thinking-block.ts';
import { brandLogo } from '../brand.ts';

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
    el('div', { className: 'msg-user-bubble' }, [text]),
  ]);
}

function buildAssistantMessage(text: string, detail?: string) {
  return el('div', { className: 'msg msg-assistant' }, [
    brandLogo({ className: 'msg-assistant-mark rounded', size: 28 }),
    el('div', { className: 'msg-assistant-body' }, [
      el('div', { className: 'msg-text' }, [text]),
      ...(detail ? [buildThinkingBlock(detail)] : []),
    ]),
  ]);
}

function buildToolMessage(text: string, detail?: string) {
  const arrowIdx = text.indexOf('→');
  const toolName = arrowIdx > 0 ? text.slice(0, arrowIdx).trim() : text.trim();
  const path = arrowIdx > 0 ? text.slice(arrowIdx + 1).trim() : '';

  const data: ToolCardData = {
    tool: toolName || 'tool',
    status: 'completed',
    ...(path ? { args: { path } } : {}),
  };

  return buildToolCard(data);
}

function buildErrorMessage(text: string, detail?: string) {
  return el('div', { className: 'msg msg-error' }, [
    el('div', { className: 'msg-error-row' }, [
      el('span', { className: 'msg-error-icon' }, ['!']),
      el('div', { className: 'msg-text' }, [text]),
    ]),
    ...(detail
      ? [el('pre', { className: 'msg-detail mono' }, [detail])]
      : []),
  ]);
}

function buildSystemMessage(text: string) {
  return el('div', { className: 'msg msg-system' }, [text]);
}

function buildApprovalNotice(text: string, detail?: string) {
  return el('div', { className: 'msg msg-approval' }, [
    el('div', { className: 'msg-approval-title' }, [text]),
    ...(detail
      ? [el('pre', { className: 'msg-detail mono' }, [detail])]
      : []),
  ]);
}

function buildChangeNotice(text: string, detail?: string) {
  return el('div', { className: 'msg msg-change' }, [
    el('div', { className: 'msg-text mono' }, [text]),
    ...(detail
      ? [el('pre', { className: 'msg-detail mono' }, [detail])]
      : []),
  ]);
}
