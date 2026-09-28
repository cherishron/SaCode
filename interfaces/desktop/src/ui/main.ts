import { createApp } from 'vue';
import TDesign from 'tdesign-vue-next';
import TDesignChat from '@tdesign-vue-next/chat';
import 'tdesign-vue-next/es/style/index.css';
import '@tdesign-vue-next/chat/es/style/index.css';

// TDesign 自定义主题（官方变量表）→ 壳令牌桥接 → 布局
import './styles/tdesign-theme.css';
import './styles/theme.css';
import './styles/layout-contract.css';
import './styles/shell.css';

import { applyInterfacePreferences, loadDesktopPreferences } from '../app/settings.ts';
import App from './App.vue';

// 主题跟随设置：系统 / 深色 / 浅色（不写死深色）
applyInterfacePreferences(loadDesktopPreferences());

const app = createApp(App);
app.use(TDesign);
app.use(TDesignChat);
app.mount('#app');
