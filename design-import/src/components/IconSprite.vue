<script setup lang="ts">
/**
 * 图标精灵：所有 SVG symbol 集中定义一次，组件内用 <use href="#i-xxx" /> 引用。
 * 与设计稿 desktop-ui-prototype-v2.html 中的 symbol 定义一致（去掉了原型注入属性）。
 */
</script>

<template>
  <svg width="0" height="0" aria-hidden="true" style="position: absolute; overflow: hidden">
    <defs>
      <symbol id="i-search" viewBox="0 0 24 24"><circle cx="11" cy="11" r="7" /><line x1="16.5" y1="16.5" x2="21" y2="21" /></symbol>
      <symbol id="i-add" viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></symbol>
      <symbol id="i-settings" viewBox="0 0 24 24"><circle cx="12" cy="12" r="3" /><path d="M19 12a7 7 0 0 0-.1-1.2l2-1.5-2-3.4-2.3 1a7 7 0 0 0-2-1.2L14.2 3h-4l-.4 2.5a7 7 0 0 0-2 1.2l-2.3-1-2 3.4 2 1.5A7 7 0 0 0 5 12c0 .4 0 .8.1 1.2l-2 1.5 2 3.4 2.3-1a7 7 0 0 0 2 1.2l.4 2.5h4l.4-2.5a7 7 0 0 0 2-1.2l2.3 1 2-3.4-2-1.5c.1-.4.1-.8.1-1.2Z" /></symbol>
      <symbol id="i-folder" viewBox="0 0 24 24"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" /></symbol>
      <symbol id="i-file" viewBox="0 0 24 24"><path d="M6 3h8l4 4v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z" /><path d="M14 3v4h4" /></symbol>
      <symbol id="i-chat" viewBox="0 0 24 24"><path d="M4 5h16v11H9l-5 4Z" /></symbol>
      <symbol id="i-term" viewBox="0 0 24 24"><path d="M5 7l4 4-4 4" /><line x1="12" y1="16" x2="19" y2="16" /></symbol>
      <symbol id="i-preview" viewBox="0 0 24 24"><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" /></symbol>
      <symbol id="i-close" viewBox="0 0 24 24"><line x1="6" y1="6" x2="18" y2="18" /><line x1="18" y1="6" x2="6" y2="18" /></symbol>
      <symbol id="i-more" viewBox="0 0 24 24"><circle cx="5" cy="12" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="19" cy="12" r="1.6" /></symbol>
      <symbol id="i-mic" viewBox="0 0 24 24"><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0" /><line x1="12" y1="18" x2="12" y2="21" /></symbol>
      <symbol id="i-book" viewBox="0 0 24 24"><path d="M4 5a2 2 0 0 1 2-2h5v16H6a2 2 0 0 0-2 2Z" /><path d="M20 5a2 2 0 0 0-2-2h-5v16h5a2 2 0 0 1 2 2Z" /></symbol>
      <symbol id="i-cal" viewBox="0 0 24 24"><rect x="4" y="5" width="16" height="16" rx="2" /><line x1="4" y1="9" x2="20" y2="9" /><line x1="8" y1="3" x2="8" y2="6" /><line x1="16" y1="3" x2="16" y2="6" /></symbol>
      <symbol id="i-chevron" viewBox="0 0 24 24"><path d="M9 6l6 6-6 6" /></symbol>
      <symbol id="i-collapse" viewBox="0 0 24 24"><path d="M14 6l-6 6 6 6" /></symbol>
      <symbol id="i-sidebar" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="2" /><line x1="9" y1="4" x2="9" y2="20" /><line x1="12.5" y1="9" x2="17" y2="9" /><line x1="12.5" y1="13" x2="17" y2="13" /></symbol>
      <symbol id="i-bot" viewBox="0 0 24 24"><rect x="5" y="8" width="14" height="10" rx="2" /><circle cx="9" cy="13" r="1.3" /><circle cx="15" cy="13" r="1.3" /><line x1="12" y1="4" x2="12" y2="8" /><line x1="9" y1="18" x2="9" y2="21" /><line x1="15" y1="18" x2="15" y2="21" /></symbol>
    </defs>
  </svg>
</template>
