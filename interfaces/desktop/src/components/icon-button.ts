/** IconButton — 图标按钮基础组件 */
import { el } from '../dom.ts';

export type IconButtonVariant = 'ghost' | 'accent' | 'danger' | 'ok';

export function buildIconButton(
  icon: string,
  title: string,
  variant: IconButtonVariant = 'ghost',
  onclick?: () => void,
) {
  return el('button', {
    className: `icon-btn icon-btn-${variant}`,
    title,
    ...(onclick ? { onclick } : {}),
  }, [icon]);
}
