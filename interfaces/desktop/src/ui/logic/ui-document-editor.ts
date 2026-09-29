import type { UiDocument, UiNode } from '@cherishron/sacode-client-core';

export type UICommand =
  | { type: 'move-node'; nodeId: string; parentId: string; index: number }
  | { type: 'resize-node'; nodeId: string; width?: string; height?: string }
  | { type: 'set-layout'; nodeId: string; patch: Record<string, unknown> }
  | { type: 'set-content'; nodeId: string; patch: Record<string, unknown> }
  | { type: 'set-appearance'; nodeId: string; patch: Record<string, unknown> }
  | { type: 'set-props'; nodeId: string; patch: Record<string, unknown> }
  | { type: 'set-interactions'; nodeId: string; interactions: unknown[] }
  | { type: 'set-token'; name: string; value: string }
  | { type: 'set-node-meta'; nodeId: string; name?: string; locked?: boolean }
  | { type: 'insert-node'; parentId: string; index: number; node: UiNode }
  | { type: 'duplicate-node'; nodeId: string; newNodeId: string }
  | { type: 'delete-node'; nodeId: string }
  | { type: 'restore-document'; document: UiDocument };

export interface CommandResult {
  document: UiDocument;
  inverse: UICommand;
  selectedNodeId: string | null;
}

export interface UiNodeLocation {
  node: UiNode;
  parent: UiNode | null;
  index: number;
}

export function executeUiCommand(document: UiDocument, command: UICommand): CommandResult {
  const before = structuredClone(document);
  const next = structuredClone(document);
  let selectedNodeId: string | null = commandNodeId(command);

  if (command.type === 'restore-document') {
    return {
      document: structuredClone(command.document),
      inverse: { type: 'restore-document', document: before },
      selectedNodeId: selectedNodeIdForDocument(command.document),
    };
  }

  if (command.type === 'move-node') {
    moveNode(next, command.nodeId, command.parentId, command.index);
  } else if (command.type === 'resize-node') {
    const node = requireEditableNode(next, command.nodeId);
    if (command.width !== undefined) setPatchValue(node.layout, 'width', command.width);
    if (command.height !== undefined) setPatchValue(node.layout, 'height', command.height);
  } else if (command.type === 'set-layout') {
    applyPatch(requireEditableNode(next, command.nodeId).layout, command.patch);
  } else if (command.type === 'set-content') {
    applyPatch(requireEditableNode(next, command.nodeId).content, command.patch);
  } else if (command.type === 'set-appearance') {
    applyPatch(requireEditableNode(next, command.nodeId).appearance, command.patch);
  } else if (command.type === 'set-props') {
    applyPatch(requireEditableNode(next, command.nodeId).props, command.patch);
  } else if (command.type === 'set-interactions') {
    requireEditableNode(next, command.nodeId).interactions = structuredClone(command.interactions);
  } else if (command.type === 'set-token') {
    setTokenValue(next.tokens, command.name, command.value);
    selectedNodeId = null;
  } else if (command.type === 'set-node-meta') {
    const node = requireNode(next, command.nodeId);
    if (command.name !== undefined) node.name = command.name;
    if (command.locked !== undefined) node.locked = command.locked;
  } else if (command.type === 'insert-node') {
    const parent = requireEditableNode(next, command.parentId);
    assertUniqueNodeIds(next, command.node);
    parent.children.splice(clampIndex(command.index, parent.children.length), 0, structuredClone(command.node));
    selectedNodeId = command.node.id;
  } else if (command.type === 'duplicate-node') {
    const location = requireLocation(next, command.nodeId);
    if (!location.parent) throw new Error('根节点不能复制');
    if (location.node.locked) throw new Error('锁定节点不能复制');
    if (location.parent.locked) throw new Error('锁定容器的结构不能修改');
    const duplicate = cloneNodeWithIds(location.node, command.newNodeId);
    assertUniqueNodeIds(next, duplicate);
    location.parent.children.splice(location.index + 1, 0, duplicate);
    selectedNodeId = duplicate.id;
  } else if (command.type === 'delete-node') {
    const location = requireLocation(next, command.nodeId);
    if (!location.parent) throw new Error('根节点不能删除');
    if (location.node.locked) throw new Error('锁定节点不能删除');
    if (location.parent.locked) throw new Error('锁定容器的结构不能修改');
    location.parent.children.splice(location.index, 1);
    selectedNodeId = location.parent.id;
  }

  touchDocument(next);
  return {
    document: next,
    inverse: { type: 'restore-document', document: before },
    selectedNodeId,
  };
}

export function findUiNode(document: UiDocument, nodeId: string): UiNode | null {
  return findUiNodeLocation(document, nodeId)?.node ?? null;
}

export function findUiPageId(document: UiDocument, nodeId: string): string | null {
  for (const page of document.pages) {
    if (findInTree(page.root, nodeId, null, 0)) return page.id;
  }
  return null;
}

export function findUiNodeLocation(document: UiDocument, nodeId: string): UiNodeLocation | null {
  for (const page of document.pages) {
    const found = findInTree(page.root, nodeId, null, 0);
    if (found) return found;
  }
  return null;
}

export function canContainChildren(node: UiNode): boolean {
  return !['input', 'textarea', 'divider', 'spacer', 'image', 'table'].includes(node.type);
}

export function createUiNode(type: string, id: string): UiNode {
  const labels: Record<string, string> = {
    container: '容器', card: '卡片', heading: '标题', text: '文本', button: '按钮', input: '输入框', divider: '分隔线',
  };
  const text = type === 'heading' ? '新标题' : type === 'text' ? '新文本' : type === 'button' ? '按钮' : '';
  return {
    id,
    name: labels[type] ?? '节点',
    type,
    content: text ? { text } : {},
    props: type === 'input' ? { placeholder: '请输入内容', input_type: 'text' } : {},
    layout: type === 'container' ? { display: 'block', padding: '16px' } : type === 'card' ? { padding: '18px' } : {},
    appearance: {},
    responsive: [],
    states: {},
    interactions: [],
    children: [],
    locked: false,
  };
}

export function nextNodeId(document: UiDocument, type: string): string {
  const prefix = type.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'node';
  let sequence = 1;
  while (findUiNode(document, `${prefix}-${sequence}`)) sequence += 1;
  return `${prefix}-${sequence}`;
}

function moveNode(document: UiDocument, nodeId: string, parentId: string, index: number) {
  if (nodeId === parentId) throw new Error('节点不能移动到自身');
  const source = requireLocation(document, nodeId);
  if (!source.parent) throw new Error('根节点不能移动');
  if (source.node.locked) throw new Error('锁定节点不能移动');
  if (source.parent.locked) throw new Error('锁定容器的结构不能修改');
  if (containsNode(source.node, parentId)) throw new Error('节点不能移动到自己的子节点');
  const target = requireEditableNode(document, parentId);
  if (!canContainChildren(target)) throw new Error('目标节点不能包含子节点');

  source.parent.children.splice(source.index, 1);
  const adjustedIndex = source.parent.id === target.id && source.index < index ? index - 1 : index;
  target.children.splice(clampIndex(adjustedIndex, target.children.length), 0, source.node);
}

function findInTree(node: UiNode, nodeId: string, parent: UiNode | null, index: number): UiNodeLocation | null {
  if (node.id === nodeId) return { node, parent, index };
  for (let childIndex = 0; childIndex < node.children.length; childIndex += 1) {
    const found = findInTree(node.children[childIndex], nodeId, node, childIndex);
    if (found) return found;
  }
  return null;
}

function requireLocation(document: UiDocument, nodeId: string): UiNodeLocation {
  const location = findUiNodeLocation(document, nodeId);
  if (!location) throw new Error(`未找到 UI 节点: ${nodeId}`);
  return location;
}

function requireNode(document: UiDocument, nodeId: string): UiNode {
  return requireLocation(document, nodeId).node;
}

function requireEditableNode(document: UiDocument, nodeId: string): UiNode {
  const node = requireNode(document, nodeId);
  if (node.locked) throw new Error('锁定节点不能编辑');
  return node;
}

function applyPatch(target: Record<string, unknown>, patch: Record<string, unknown>) {
  for (const [key, value] of Object.entries(patch)) setPatchValue(target, key, value);
}

function setPatchValue(target: Record<string, unknown>, key: string, value: unknown) {
  if (value === null || value === '') delete target[key];
  else target[key] = value;
}

function setTokenValue(tokens: Record<string, unknown>, name: string, value: string) {
  const path = name.split('.').map((part) => part.trim()).filter(Boolean);
  if (path.length === 0) throw new Error('Token 名称不能为空');
  let target = tokens;
  for (const segment of path.slice(0, -1)) {
    const current = target[segment];
    if (typeof current !== 'object' || current === null || Array.isArray(current)) target[segment] = {};
    target = target[segment] as Record<string, unknown>;
  }
  if (value === '') delete target[path[path.length - 1]];
  else target[path[path.length - 1]] = value;
}

function cloneNodeWithIds(source: UiNode, rootId: string): UiNode {
  const duplicate = structuredClone(source);
  const rewrite = (node: UiNode, id: string) => {
    node.id = id;
    node.name = `${node.name} 副本`;
    node.locked = false;
    node.children.forEach((child, index) => rewrite(child, `${id}-${index + 1}`));
  };
  rewrite(duplicate, rootId);
  return duplicate;
}

function assertUniqueNodeIds(document: UiDocument, candidate: UiNode) {
  const ids: string[] = [];
  collectIds(candidate, ids);
  const duplicate = ids.find((id, index) => ids.indexOf(id) !== index || findUiNode(document, id));
  if (duplicate) throw new Error(`UI 节点 ID 已存在: ${duplicate}`);
}

function collectIds(node: UiNode, ids: string[]) {
  ids.push(node.id);
  node.children.forEach((child) => collectIds(child, ids));
}

function containsNode(node: UiNode, nodeId: string): boolean {
  return node.id === nodeId || node.children.some((child) => containsNode(child, nodeId));
}

function clampIndex(index: number, length: number): number {
  if (!Number.isFinite(index)) return length;
  return Math.max(0, Math.min(Math.trunc(index), length));
}

function touchDocument(document: UiDocument) {
  document.status = 'draft';
  document.updated_at = new Date().toISOString();
}

function commandNodeId(command: UICommand): string | null {
  if ('nodeId' in command) return command.nodeId;
  if (command.type === 'insert-node') return command.node.id;
  return null;
}

function selectedNodeIdForDocument(document: UiDocument): string | null {
  return document.pages[0]?.root.id ?? null;
}
