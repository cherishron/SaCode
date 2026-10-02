import { reactive } from 'vue'

/**
 * 全局 UI 状态与交互动作。
 * 设计稿（desktop-ui-prototype-v2.html）中所有交互均映射到这里，
 * 组件只负责渲染 + 调用动作，不持有分散的状态。
 */

export type ThemeMode = 'system' | 'dark' | 'light'

export type SessionState = 'running' | 'failed' | 'unread' | 'loaded' | 'normal'

export interface Session {
  id: string
  name: string
  state: SessionState
}

const PREF_KEY = 'sacode.theme'

export const ui = reactive({
  // 外观：三态（跟随系统 / 深色 / 浅色）+ 持久化
  theme: (localStorage.getItem(PREF_KEY) || 'system') as ThemeMode,

  // 任务列
  collapsed: false, // 桌面端折叠为 56px
  navOpen: false, // 移动端抽屉开合
  selectedSession: 's1',
  runningBadge: 2, // 设计稿「2 运行中」静态角标
  archivedOpen: false,
  userPopper: false,

  // 右侧统一工具栏
  toolsOpen: true,
  activeTool: 'files',

  // 分格更多菜单
  paneMenu: false,

  // Composer
  plusMenu: false,
  modelMenu: false,
  mode: 'build', // plan | build | yolo
  model: 'deepseek-v4-flash',
  think: '中', // 关闭 | 低 | 中 | 高

  // 设置浮层
  showSettings: false,

  sessions: [
    { id: 's1', name: '重构 provider 配置读取', state: 'running' },
    { id: 's2', name: '协议类型 3 种改造', state: 'failed' },
    { id: 's3', name: 'daemon 预启动修复', state: 'unread' },
    { id: 's4', name: 'UI 视觉改版原型', state: 'loaded' },
    { id: 's5', name: '右键菜单 + 文本选择', state: 'normal' },
  ] as Session[],
})

let sessionSeq = 100

/* ── 主题：三态 + 持久化（对应规划 M3） ── */
const mq = window.matchMedia('(prefers-color-scheme: dark)')

function applyTheme(mode: ThemeMode) {
  const root = document.documentElement
  const useDark = mode === 'dark' || (mode === 'system' && mq.matches)
  root.classList.toggle('dark', useDark)
  root.setAttribute('theme-mode', useDark ? 'dark' : 'light')
}

export function applyInitialTheme() {
  applyTheme(ui.theme)
}

export function setTheme(mode: ThemeMode) {
  ui.theme = mode
  try {
    localStorage.setItem(PREF_KEY, mode)
  } catch {
    /* 忽略隐私模式下的写入失败 */
  }
  applyTheme(mode)
}

mq.addEventListener('change', () => {
  if (ui.theme === 'system') applyTheme('system')
})

/* ── 响应式判定 ── */
export function isMobile(): boolean {
  return window.matchMedia('(max-width: 720px)').matches
}

/* ── 交互动作 ── */
export function onSidebarToggle() {
  if (isMobile()) ui.navOpen = !ui.navOpen
  else ui.collapsed = !ui.collapsed
}

export function toggleTools() {
  ui.toolsOpen = !ui.toolsOpen
}

export function setTool(tab: string) {
  ui.activeTool = tab
  ui.toolsOpen = true
}

export function closeTools() {
  ui.toolsOpen = false
}

export function toggleUserPopper() {
  ui.userPopper = !ui.userPopper
}

export function togglePaneMenu() {
  ui.paneMenu = !ui.paneMenu
}

export function closePaneMenu() {
  ui.paneMenu = false
}

export function togglePlus() {
  ui.plusMenu = !ui.plusMenu
}

export function toggleModel() {
  ui.modelMenu = !ui.modelMenu
}

export function setThink(t: string) {
  ui.think = t
}

export function pickModel(m: string) {
  ui.model = m || '默认模型'
  ui.modelMenu = false
}

export function setMode(m: string) {
  ui.mode = m
}

export function openSettings() {
  ui.showSettings = true
  ui.userPopper = false
}

export function closeSettings() {
  ui.showSettings = false
}

export function selectSession(id: string) {
  ui.selectedSession = id
}

export function addSession() {
  sessionSeq += 1
  ui.sessions.push({
    id: 's' + sessionSeq,
    name: '新会话 ' + (sessionSeq - 99),
    state: 'normal',
  })
}

export function newTask() {
  addSession()
  const last = ui.sessions[ui.sessions.length - 1]
  ui.selectedSession = last.id
}

export function addProject() {
  /* 演示占位：实际项目会打开项目选择器 */
}
