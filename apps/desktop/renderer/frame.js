/* 整页列宽规则依据冻结官方 columns.ts（639ed01）；这里只保存布局偏好，不保存业务事实。 */
(function (root) {
  'use strict';
  const clamp = (value, min, max) => Math.min(max, Math.max(min, Math.round(value)));
  function columns(viewport, sidebar, rightbar) {
    const left = sidebar === 0 ? 56 : clamp(sidebar, 264, 420);
    const available = viewport - left - 400;
    const right = rightbar === 0 || available < 300 ? 0 : Math.min(available, clamp(rightbar, 300, viewport * .7));
    return { sidebar:left, center:Math.max(0, viewport-left-right), rightbar:right };
  }
  const api = Object.freeze({ columns, clamp });
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SaCodeFrame = api;
})(globalThis);
