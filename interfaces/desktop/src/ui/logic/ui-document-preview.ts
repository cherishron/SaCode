import { el } from '../platform/dom.ts';
import type { UiDocument, UiNode, UiViewport } from '@cherishron/sacode-client-core';

const SAFE_STYLE_KEYS = new Set([
  'display', 'flexDirection', 'flexWrap', 'alignItems', 'justifyContent', 'gap',
  'gridTemplateColumns', 'gridColumn', 'width', 'height', 'minHeight', 'maxWidth',
  'padding', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
  'margin', 'marginTop', 'marginRight', 'marginBottom', 'marginLeft',
  'color', 'background', 'backgroundColor', 'border', 'borderColor', 'borderRadius',
  'boxShadow', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'textAlign',
  'opacity', 'overflow', 'objectFit',
]);

const STYLE_ALIASES: Record<string, string> = {
  'flex-direction': 'flexDirection',
  flex_direction: 'flexDirection',
  'flex-wrap': 'flexWrap',
  flex_wrap: 'flexWrap',
  'align-items': 'alignItems',
  align_items: 'alignItems',
  'justify-content': 'justifyContent',
  justify_content: 'justifyContent',
  'grid-template-columns': 'gridTemplateColumns',
  grid_template_columns: 'gridTemplateColumns',
  grid_column: 'gridColumn',
  min_height: 'minHeight',
  max_width: 'maxWidth',
  background_color: 'backgroundColor',
  border_color: 'borderColor',
  border_radius: 'borderRadius',
  box_shadow: 'boxShadow',
  font_size: 'fontSize',
  font_weight: 'fontWeight',
  line_height: 'lineHeight',
  letter_spacing: 'letterSpacing',
  text_align: 'textAlign',
  object_fit: 'objectFit',
};

const SAFE_NODE_TAGS: Record<string, keyof HTMLElementTagNameMap> = {
  container: 'div', section: 'section', card: 'article', text: 'p', heading: 'h2',
  button: 'button', input: 'input', textarea: 'textarea', badge: 'span', statistic: 'div',
  table: 'div', image: 'div', navigation: 'nav', divider: 'hr', spacer: 'div',
};

export interface PreviewRenderOptions {
  selectedNodeId?: string | null;
  onSelectNode?: (nodeId: string) => void;
  editable?: boolean;
  pageId?: string | null;
}

export interface ResolvedNodePresentation {
  layout: Record<string, unknown>;
  appearance: Record<string, unknown>;
  hidden: boolean;
}

export function resolveNodePresentation(node: UiNode, viewportWidth: number): ResolvedNodePresentation {
  const layout = { ...node.layout };
  const appearance = { ...node.appearance };
  let hidden = node.props.hidden === true;
  for (const candidate of node.responsive) {
    if (!isRecord(candidate)) continue;
    const min = numberValue(candidate.min_width ?? candidate.minWidth);
    const max = numberValue(candidate.max_width ?? candidate.maxWidth);
    if ((min !== null && viewportWidth < min) || (max !== null && viewportWidth > max)) continue;
    if (isRecord(candidate.layout)) Object.assign(layout, candidate.layout);
    if (isRecord(candidate.appearance)) Object.assign(appearance, candidate.appearance);
    if (typeof candidate.hidden === 'boolean') hidden = candidate.hidden;
  }
  return { layout, appearance, hidden };
}

export function renderUiDocumentPreview(
  document: UiDocument,
  viewport: UiViewport,
  options: PreviewRenderOptions = {},
): HTMLElement {
  const page = document.pages.find((candidate) => candidate.id === options.pageId) ?? document.pages[0];
  if (!page) {
    return el('div', { className: 'uidoc-empty' }, ['UIDocument 暂无页面']);
  }
  const root = el('div', { className: 'uidoc-preview-root' });
  root.dataset.viewportId = viewport.id;
  root.dataset.documentId = document.id;
  applyTokenStyles(root, document.tokens);
  root.append(renderNode(page.root, viewport.width, 0, options));
  return root;
}

function renderNode(node: UiNode, viewportWidth: number, depth: number, options: PreviewRenderOptions): HTMLElement {
  const presentation = resolveNodePresentation(node, viewportWidth);
  const tag = SAFE_NODE_TAGS[node.type] ?? 'div';
  const element = el(tag, {
    className: `uidoc-node uidoc-${cssIdentifier(node.type)} uidoc-depth-${Math.min(depth, 8)}`,
  });
  element.dataset.nodeId = node.id;
  element.dataset.nodeType = node.type;
  if (presentation.hidden) element.hidden = true;
  if (options.selectedNodeId === node.id) element.classList.add('uidoc-selected');
  if (options.onSelectNode) {
    element.tabIndex = options.editable === false ? -1 : 0;
    element.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      options.onSelectNode?.(node.id);
    });
  }
  applyStyles(element, presentation.layout);
  applyStyles(element, presentation.appearance);
  applySemanticProps(element, node);

  const text = typeof node.content.text === 'string' ? node.content.text : '';
  if (node.type === 'image') {
    const label = text || (typeof node.content.assetId === 'string' ? node.content.assetId : '图片占位');
    element.append(el('span', { className: 'uidoc-image-label' }, [label]));
  } else if (node.type === 'table') {
    renderTable(element, node);
  } else if (tag === 'input') {
    const input = element as HTMLInputElement;
    input.type = safeInputType(node.props.input_type);
    input.placeholder = typeof node.props.placeholder === 'string' ? node.props.placeholder : text;
    input.disabled = node.props.disabled === true;
  } else if (tag === 'textarea') {
    const textarea = element as HTMLTextAreaElement;
    textarea.placeholder = typeof node.props.placeholder === 'string' ? node.props.placeholder : text;
    textarea.disabled = node.props.disabled === true;
  } else if (text) {
    element.append(document.createTextNode(text));
  }

  for (const child of node.children) element.append(renderNode(child, viewportWidth, depth + 1, options));
  return element;
}

function renderTable(element: HTMLElement, node: UiNode) {
  const columns = stringList(node.props.columns);
  const rows = Array.isArray(node.props.rows) ? node.props.rows.filter(Array.isArray) as unknown[][] : [];
  if (columns.length === 0) {
    element.append(el('div', { className: 'uidoc-table-empty' }, ['表格']));
    return;
  }
  element.style.setProperty('--uidoc-table-columns', `repeat(${columns.length}, minmax(96px, 1fr))`);
  const header = el('div', { className: 'uidoc-table-row uidoc-table-header' },
    columns.map((column) => el('strong', {}, [column])));
  element.append(header);
  for (const row of rows.slice(0, 8)) {
    element.append(el('div', { className: 'uidoc-table-row' }, columns.map((_, index) =>
      el('span', {}, [scalarText(row[index])]),
    )));
  }
}

function applySemanticProps(element: HTMLElement, node: UiNode) {
  if (typeof node.props.aria_label === 'string') element.setAttribute('aria-label', node.props.aria_label);
  if (node.locked) element.dataset.locked = 'true';
  if (node.type === 'button') (element as HTMLButtonElement).type = 'button';
}

function applyTokenStyles(root: HTMLElement, tokens: Record<string, unknown>) {
  const colors = isRecord(tokens.colors) ? tokens.colors : {};
  const radius = isRecord(tokens.radius) ? tokens.radius : {};
  const primary = safeCssValue(colors.primary);
  const surface = safeCssValue(colors.surface);
  const text = safeCssValue(colors.text);
  const cardRadius = safeCssValue(radius.card);
  if (primary) root.style.setProperty('--uidoc-primary', primary);
  if (surface) root.style.setProperty('--uidoc-surface', surface);
  if (text) root.style.setProperty('--uidoc-text', text);
  if (cardRadius) root.style.setProperty('--uidoc-radius', cardRadius);
}

function applyStyles(element: HTMLElement, values: Record<string, unknown>) {
  for (const [rawKey, rawValue] of Object.entries(values)) {
    const key = STYLE_ALIASES[rawKey] ?? rawKey;
    if (!SAFE_STYLE_KEYS.has(key)) continue;
    const value = safeCssValue(rawValue);
    if (!value) continue;
    element.style.setProperty(camelToKebab(key), value);
  }
}

function safeCssValue(value: unknown): string | null {
  if (typeof value === 'number') return String(value);
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || /url\s*\(|expression\s*\(|javascript:|@import/i.test(trimmed)) return null;
  return trimmed.slice(0, 240);
}

function safeInputType(value: unknown): string {
  return typeof value === 'string' && ['text', 'search', 'email', 'number', 'password'].includes(value)
    ? value
    : 'text';
}

function cssIdentifier(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'unknown';
}

function camelToKebab(value: string): string {
  return value.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}

function scalarText(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' ? String(value) : '—';
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function numberValue(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
