import type { SlashCommand } from './composer-commands'

export interface SlashCommand {
  name: string
  label: string
  help: string
  section: string
  frontendOnly?: boolean
}

export const BUILTIN_COMMANDS: SlashCommand[] = [
  { name: 'help', label: '帮助', help: '显示可用命令列表', section: 'commands', frontendOnly: true },
  { name: 'review', label: '代码审查', help: '只读审查当前工作区的 Git 变更', section: 'commands' },
  { name: 'compress', label: '压缩上下文', help: '手动触发上下文压缩', section: 'commands' },
  { name: 'init', label: '初始化', help: '初始化项目配置与工作区', section: 'commands' },
  { name: 'clear', label: '清空对话', help: '清空当前会话历史（保留会话标题与设置）', section: 'commands' }
]

export function getCommands(): SlashCommand[] {
  return [...BUILTIN_COMMANDS]
}
