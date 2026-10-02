const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]';

export function activateSettingsFocus(root: HTMLElement, onClose: () => void): () => void {
  const doc = root.ownerDocument;
  const opener = doc.activeElement as HTMLElement | null;
  const visible = (el: HTMLElement) => {
    const style = doc.defaultView?.getComputedStyle(el);
    return el.getClientRects().length > 0 && style?.visibility !== 'hidden' && style?.display !== 'none';
  };
  const controls = () => Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE))
    .filter(el => el.tabIndex >= 0 && !el.matches(':disabled') && !el.closest('[inert]') && visible(el));
  const focusFirst = () => (controls()[0] ?? root).focus();
  const inside = (target: Node | null) => !!target && root.contains(target);
  const keydown = (event: KeyboardEvent) => {
    if (event.defaultPrevented) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
    } else if (event.key === 'Tab') {
      const items = controls();
      const index = items.indexOf(doc.activeElement as HTMLElement);
      if (!items.length || index < 0 || (event.shiftKey ? index === 0 : index === items.length - 1)) {
        event.preventDefault();
        (event.shiftKey ? items[items.length - 1] ?? root : items[0] ?? root).focus();
      }
    }
  };
  const focusin = (event: FocusEvent) => { if (!inside(event.target as Node)) focusFirst(); };
  doc.addEventListener('keydown', keydown);
  doc.addEventListener('focusin', focusin);
  focusFirst();
  let disposed = false;
  return () => {
    if (disposed) return;
    disposed = true;
    doc.removeEventListener('keydown', keydown);
    doc.removeEventListener('focusin', focusin);
    if (opener?.isConnected) opener.focus();
  };
}
