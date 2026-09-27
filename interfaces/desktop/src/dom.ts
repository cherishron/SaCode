/** Shared DOM helper for Desktop UI. */
export function html(markup: string): Node {
  const template = document.createElement('template');
  template.innerHTML = markup.trim();
  return template.content.cloneNode(true);
}

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props?: Omit<Partial<HTMLElementTagNameMap[K]>, 'style' | 'className'> & { className?: string; dataset?: Record<string, string>; style?: string; 'aria-label'?: string },
  children: (Node | string)[] = [],
): HTMLElementTagNameMap[K] {
  const resolvedProps = props ?? {};
  const node = document.createElement(tag);
  const { dataset, className, style, ...rest } = resolvedProps as Record<string, unknown>;
  if (className !== undefined) node.className = String(className);
  if (typeof style === 'string') node.setAttribute('style', style);
  if (dataset) {
    for (const [key, value] of Object.entries(dataset)) {
      node.dataset[key] = value;
    }
  }
  for (const [key, value] of Object.entries(rest)) {
    if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value as EventListener);
    } else if (key === 'innerHTML' && typeof value === 'string') {
      node.innerHTML = value;
    } else if (key in node) {
      try {
        (node as unknown as Record<string, unknown>)[key] = value;
      } catch {
        node.setAttribute(key, String(value));
      }
    } else if (value !== undefined && value !== null) {
      node.setAttribute(key, String(value));
    }
  }
  for (const child of children) {
    node.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return node;
}

export function setText(id: string, text: string) {
  const node = document.getElementById(id);
  if (node) node.textContent = text;
}

export function getValue(id: string): string {
  return (document.getElementById(id) as HTMLInputElement | HTMLTextAreaElement | null)?.value ?? '';
}

export function setValue(id: string, value: string) {
  const node = document.getElementById(id) as HTMLInputElement | HTMLTextAreaElement | null;
  if (node) node.value = value;
}
