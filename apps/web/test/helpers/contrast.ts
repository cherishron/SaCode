/**
 * 在浏览器内实测文本对比度（WCAG 公式），供 E2E 通过 page.evaluate 调用。
 * 单独成文件以便深色/浅色两个用例复用，且会被 Playwright 序列化到页面执行。
 */
export function measureContrast(sels: string[]): { sel: string; ratio: number }[] {
  const parse = (s: string): number[] | null => {
    const m = s.match(/[\d.]+/g);
    return m && m.length >= 3 ? [Number(m[0]), Number(m[1]), Number(m[2])] : null;
  };
  const alpha = (s: string): number => {
    const m = s.match(/[\d.]+/g);
    return m && m.length >= 4 ? Number(m[3]) : 1;
  };
  const lin = (c: number): number => {
    const v = c / 255;
    return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  const lum = (rgb: number[]): number => 0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2]);

  // 逐层向上找到第一个不透明背景
  const effectiveBg = (el: Element): number[] => {
    let e: Element | null = el;
    while (e) {
      const bs = getComputedStyle(e).backgroundColor;
      if (bs && bs !== 'transparent' && alpha(bs) > 0) {
        const c = parse(bs);
        if (c) return c;
      }
      e = e.parentElement;
    }
    return [21, 23, 28];
  };

  const out: { sel: string; ratio: number }[] = [];
  for (const sel of sels) {
    const el = document.querySelector(sel);
    if (!el) continue;
    const fg = parse(getComputedStyle(el).color);
    if (!fg) continue;
    const l1 = lum(fg);
    const l2 = lum(effectiveBg(el));
    const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
    out.push({ sel, ratio: Number(ratio.toFixed(2)) });
  }
  return out;
}
