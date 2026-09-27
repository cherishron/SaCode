/** SaCode 品牌资源 — 产品 SA 字标（深浅双版本） */
import { el } from './dom.ts';

/** 主题资源：深色主题用浅色字标，浅色主题用深色字标 */
const LOGO_DARK_THEME = '/sa-logo.png';      // 浅色笔画，适配深底
const LOGO_LIGHT_THEME = '/sa-logo-dark.png'; // 深色笔画，适配浅底

export function logoUrlForTheme(): string {
  const theme = document.documentElement.dataset.theme;
  if (theme === 'light' || (!theme && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-color-scheme: light)').matches)) {
    return LOGO_LIGHT_THEME;
  }
  return LOGO_DARK_THEME;
}

/** 品牌图片节点 */
export function brandLogo(options?: {
  className?: string;
  size?: number;
  alt?: string;
}): HTMLImageElement {
  const img = document.createElement('img');
  img.className = options?.className ? `sa-logo ${options.className}` : 'sa-logo';
  img.src = logoUrlForTheme();
  img.alt = options?.alt ?? 'SaCode';
  img.draggable = false;
  if (options?.size) {
    img.width = options.size;
    img.height = options.size;
  }
  return img;
}

/** 小尺寸品牌方块（侧栏 / 头像位） */
export function brandTile(size = 28, className = ''): HTMLElement {
  return el('span', {
    className: `sa-logo-tile ${className}`.trim(),
    style: `width:${size}px;height:${size}px`,
  }, [brandLogo({ size: Math.round(size * 0.72), className: 'rounded' })]);
}
