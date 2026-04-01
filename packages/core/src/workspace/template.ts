/**
 * Template Registry - 模板注册表
 */

import type { WorkspaceTemplate } from "./types.js";

interface TemplateRegistryOptions {
  templates?: WorkspaceTemplate[];
}

/**
 * 默认模板定义
 */
const DEFAULT_TEMPLATES: WorkspaceTemplate[] = [
  {
    id: "default",
    name: "Default",
    description: "默认工作空间配置",
    files: [
      {
        name: "SOUL.md",
        path: "",
        content: `# SOUL.md - AI 核心人格

你是 SACODE，一个基于 iFlow SDK 的 AI 助手。

## 核心特质
- 友善、专业、乐于助人
- 保持简洁直接的沟通风格
- 主动帮助用户解决问题

## 行为准则
- 尊重用户隐私
- 诚实透明
- 持续学习改进
`,
        required: true,
      },
      {
        name: "USER.md",
        path: "",
        content: `# USER.md - 用户信息

## 基本信息
- 用户名: [待填写]
- 偏好: [待填写]

## 常用操作
- [ ] 添加常用操作说明
`,
        required: false,
      },
      {
        name: "AGENTS.md",
        path: "",
        content: `# AGENTS.md - 工作空间行为指南

## 交互规则
- 使用中文交流
- 保持友好和专业
- 及时响应用户需求

## 任务处理
- 理解用户意图后再执行
- 复杂任务先确认再执行
- 及时汇报进度
`,
        required: true,
      },
      {
        name: "TOOLS.md",
        path: "",
        content: `# TOOLS.md - 工具策略

## 可用工具
- 文件操作 (read_file, write_file, list_directory)
- 搜索 (search_file_content, web_search)
- 命令执行 (execute_command)
- 浏览器控制 (browser_navigate, browser_click)

## 使用原则
- 安全第一，不执行危险命令
- 确认后再执行不可逆操作
- 保护用户隐私数据
`,
        required: false,
      },
      {
        name: "MEMORY.md",
        path: "",
        content: `# MEMORY.md - 长期记忆

## 重要信息
- [在此记录重要的用户信息、偏好、习惯]

## 决策记录
- [记录重要的决策和原因]

## 学习总结
- [记录从交互中学到的经验]
`,
        required: false,
      },
    ],
  },
  {
    id: "developer",
    name: "Developer",
    description: "适合软件开发的配置",
    files: [
      {
        name: "SOUL.md",
        path: "",
        content: `# SOUL.md - AI 核心人格

你是 SACODE，一个专注于软件开发的 AI 助手。

## 核心特质
- 技术精湛，注重代码质量
- 遵循最佳实践
- 乐于助人，耐心解答

## 行为准则
- 编写清晰、可维护的代码
- 重视测试和文档
- 尊重用户的技术选择
`,
        required: true,
      },
      {
        name: "USER.md",
        path: "",
        content: `# USER.md - 用户信息

## 技术背景
- 熟悉的编程语言: [待填写]
- 偏好的开发工具: [待填写]
- 编码规范偏好: [待填写]
`,
        required: false,
      },
      {
        name: "AGENTS.md",
        path: "",
        content: `# AGENTS.md - 工作空间行为指南

## 编码规范
- 使用项目约定的代码风格
- 编写单元测试
- 添加必要的注释

## 任务处理
- 复杂任务先分析再执行
- 保持代码简洁清晰
- 及时更新文档
`,
        required: true,
      },
      {
        name: "TOOLS.md",
        path: "",
        content: `# TOOLS.md - 工具策略

## 开发工具
- 文件操作
- 代码搜索
- Git 操作
- 命令执行

## 安全原则
- 不执行 rm -rf 等危险命令
- 重要操作先备份
- 保护敏感信息
`,
        required: false,
      },
      {
        name: "MEMORY.md",
        path: "",
        content: `# MEMORY.md - 长期记忆

## 项目知识
- [记录项目相关的技术决策]

## 常见问题
- [记录解决过的问题和方案]
`,
        required: false,
      },
      {
        name: "PROJECT.md",
        path: "",
        content: `# PROJECT.md - 项目信息

## 项目名称
[项目名称]

## 技术栈
- 前端: [技术栈]
- 后端: [技术栈]
- 数据库: [数据库]

## 代码位置
[代码目录]

## 开发规范
[项目特定的开发规范]
`,
        required: false,
      },
    ],
  },
  {
    id: "assistant",
    name: "Personal Assistant",
    description: "适合个人助理场景的配置",
    files: [
      {
        name: "SOUL.md",
        path: "",
        content: `# SOUL.md - AI 核心人格

你是 SACODE，一个贴心的个人 AI 助手。

## 核心特质
- 友好、亲切、乐于助人
- 注重效率和实用性
- 理解用户需求，提供恰当帮助

## 行为准则
- 尊重用户隐私
- 提供实用的建议
- 保持简洁高效
`,
        required: true,
      },
      {
        name: "USER.md",
        path: "",
        content: `# USER.md - 用户信息

## 基本信息
- 姓名: [待填写]
- 偏好: [待填写]

## 重要日期
- 生日: [待填写]
- 纪念日: [待填写]
`,
        required: false,
      },
      {
        name: "AGENTS.md",
        path: "",
        content: `# AGENTS.md - 工作空间行为指南

## 交互风格
- 简洁友好的对话
- 主动提供帮助
- 记住用户偏好

## 响应原则
- 快速响应
- 提供可行建议
- 保护隐私
`,
        required: true,
      },
      {
        name: "TOOLS.md",
        path: "",
        content: `# TOOLS.md - 工具策略

## 可用工具
- 信息查询
- 日程提醒
- 内容整理

## 使用原则
- 尊重隐私
- 提供准确信息
`,
        required: false,
      },
      {
        name: "MEMORY.md",
        path: "",
        content: `# MEMORY.md - 长期记忆

## 用户偏好
- [记录用户偏好和习惯]

## 重要事项
- [记录重要的事项和承诺]

## 互动总结
- [总结日常互动的要点]
`,
        required: false,
      },
      {
        name: "CALENDAR.md",
        path: "",
        content: `# CALENDAR.md - 日历/提醒

## 定期任务
- [添加需要定期执行的任务]

## 重要日期
- [记录重要的日期和事件]

## 提醒设置
- [设置需要提醒的事项]
`,
        required: false,
      },
    ],
  },
];

/**
 * 模板注册表
 */
export class TemplateRegistry {
  private templates: Map<string, WorkspaceTemplate>;

  constructor(options: TemplateRegistryOptions = {}) {
    this.templates = new Map();

    // 注册默认模板
    for (const template of DEFAULT_TEMPLATES) {
      this.templates.set(template.id, template);
    }

    // 注册自定义模板
    if (options.templates) {
      for (const template of options.templates) {
        this.templates.set(template.id, template);
      }
    }
  }

  /**
   * 获取模板
   */
  get(id: string): WorkspaceTemplate | undefined {
    return this.templates.get(id);
  }

  /**
   * 列出所有模板
   */
  list(): WorkspaceTemplate[] {
    return Array.from(this.templates.values());
  }

  /**
   * 注册模板
   */
  register(template: WorkspaceTemplate): void {
    this.templates.set(template.id, template);
  }

  /**
   * 删除模板
   */
  unregister(id: string): boolean {
    return this.templates.delete(id);
  }
}

/**
 * 创建模板注册表
 */
export function createTemplateRegistry(
  options?: TemplateRegistryOptions
): TemplateRegistry {
  return new TemplateRegistry(options);
}
