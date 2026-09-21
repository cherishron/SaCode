/** Shared DOM helper for Desktop UI. */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> & { className?: string } = {},
  children: (Node | string)[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  Object.assign(node, props);
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
