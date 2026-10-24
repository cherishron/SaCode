import { createApp } from 'vue';
import { createPinia } from 'pinia';
import App from './App.vue';
import { router } from './router';
// 自托管字体（variable，仅字重轴）：构建后 woff2 进 dist/client/assets，
// 由同源提供，满足 CSP `default-src 'self'`（外部字体 CDN 会被 CSP 阻止）。
// 只含拉丁字形，中文仍 fallback 到系统字体，避免引入数 MB 的中文字体。
import '@fontsource-variable/inter/wght.css';
import '@fontsource-variable/jetbrains-mono/wght.css';
import './styles/global.css';

createApp(App).use(createPinia()).use(router).mount('#app');
