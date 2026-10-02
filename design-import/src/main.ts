import { createApp } from 'vue'
import App from './App.vue'
import { applyInitialTheme } from './store'

// 设计令牌与全部组件样式（直接移植自设计稿 desktop-ui-prototype-v2.html）
import './styles/prototype.css'
// 自适应增强（响应式断点 / 移动端抽屉）
import './styles/app.css'

applyInitialTheme()
createApp(App).mount('#app')
