/**
 * 任务管理适配器
 *
 * 为 TaskScheduler 提供工具接口
 */

import type { ToolDefinition } from "../types";
import type { TaskCreateInput, TaskUpdateInput, TaskCapabilityConfig } from "../types";

/**
 * 模拟的任务存储
 */
const taskStore = new Map<string, {
  id: string;
  name: string;
  type: string;
  config: Record<string, unknown>;
  message: string;
  channel: string;
  chatId: string;
  enabled: boolean;
  maxRetries: number;
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}>();

/**
 * 创建 task_create_tool 工具
 */
export function createTaskCreateTool(config: TaskCapabilityConfig): ToolDefinition {
  return {
    name: "task_create_tool",
    description: "创建一个新的定时任务，支持 interval、once 和 cron 类型",
    inputSchema: {
      parse: (input: unknown) => {
        if (typeof input === "object" && input !== null && "name" in input && "type" in input) {
          const parsed = input as TaskCreateInput;

          if (typeof parsed.name !== "string" || parsed.name.length === 0) {
            throw new Error("Name must be a non-empty string");
          }

          if (!["interval", "once", "cron"].includes(parsed.type)) {
            throw new Error("Type must be one of: interval, once, cron");
          }

          if (parsed.type === "interval" && parsed.config.interval === undefined) {
            throw new Error("Interval type requires config.interval");
          }

          if (parsed.type === "once" && parsed.config.executeAt === undefined) {
            throw new Error("Once type requires config.executeAt");
          }

          if (parsed.type === "cron" && parsed.config.cronExpression === undefined) {
            throw new Error("Cron type requires config.cronExpression");
          }

          return parsed;
        }
        throw new Error("Invalid input: expected TaskCreateInput");
      },
    } as unknown as ToolDefinition["inputSchema"],
    execute: async (input: unknown) => {
      const typedInput = input as TaskCreateInput;

      // 检查任务数量限制
      if (config.maxTasks && taskStore.size >= config.maxTasks) {
        throw new Error(`Maximum number of tasks (${config.maxTasks}) reached`);
      }

      // 生成任务 ID
      const taskId = `task-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

      // 创建任务
      const task = {
        id: taskId,
        name: typedInput.name,
        type: typedInput.type,
        config: typedInput.config,
        message: typedInput.message,
        channel: typedInput.channel,
        chatId: typedInput.chatId,
        enabled: typedInput.enabled ?? true,
        maxRetries: typedInput.maxRetries ?? 3,
        metadata: typedInput.metadata ?? {},
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      // 存储任务
      taskStore.set(taskId, task);

      // 格式化输出
      let output = `# 任务已创建\n\n`;
      output += `**任务 ID**: ${taskId}\n`;
      output += `**名称**: ${task.name}\n`;
      output += `**类型**: ${task.type}\n`;
      output += `**状态**: ${task.enabled ? "已启用" : "已禁用"}\n`;
      output += `**消息**: ${task.message}\n`;
      output += `**渠道**: ${task.channel}\n`;
      output += `**聊天 ID**: ${task.chatId}\n`;
      output += `**最大重试**: ${task.maxRetries}\n`;
      output += `**创建时间**: ${task.createdAt.toISOString()}\n\n`;

      output += `## 配置\n\n`;
      output += JSON.stringify(task.config, null, 2);

      return output;
    },
    };
}

/**
 * 创建 cron_create_tool 工具
 */
export function createCronCreateTool(config: TaskCapabilityConfig): ToolDefinition {
      return {
        name: "cron_create_tool",
        description: "创建一个基于 Cron 表达式的定时任务，提供预设模板（每小时、每天、每周、每月）",
        inputSchema: {
          parse: (input: unknown) => {
            if (typeof input === "object" && input !== null && "name" in input && "cronExpression" in input) {
              const parsed = input as CronCreateInput;
    
              if (typeof parsed.name !== "string" || parsed.name.length === 0) {
                throw new Error("Name must be a non-empty string");
              }
    
              if (typeof parsed.cronExpression !== "string" || parsed.cronExpression.length === 0) {
                throw new Error("CronExpression must be a non-empty string");
              }
    
              return parsed;
            }
            throw new Error("Invalid input: expected CronCreateInput");
          },
        } as unknown as ToolDefinition["inputSchema"],
        execute: async (input: unknown) => {
          const typedInput = input as CronCreateInput;
    
          // 检查任务数量限制
          if (config.maxTasks && taskStore.size >= config.maxTasks) {
            throw new Error(`Maximum number of tasks (${config.maxTasks}) reached`);
          }
    
          // 生成任务 ID
          const taskId = `cron-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    
          // 创建任务
          const task = {
            id: taskId,
            name: typedInput.name,
            type: "cron" as const,
            config: {
              cronExpression: typedInput.cronExpression,
            },
            message: typedInput.message,
            channel: typedInput.channel,
            chatId: typedInput.chatId,
            enabled: typedInput.enabled ?? true,
            maxRetries: 3,
            metadata: {
              timezone: typedInput.timezone,
              template: typedInput.template,
            },
            createdAt: new Date(),
            updatedAt: new Date(),
          };
    
          // 存储任务
          taskStore.set(taskId, task);
    
          // 格式化输出
          let output = `# Cron 任务已创建\n\n`;
          output += `**任务 ID**: ${taskId}\n`;
          output += `**名称**: ${task.name}\n`;
          output += `**类型**: Cron\n`;
          output += `**状态**: ${task.enabled ? "已启用" : "已禁用"}\n`;
          output += `**消息**: ${task.message}\n`;
          output += `**渠道**: ${task.channel}\n`;
          output += `**聊天 ID**: ${task.chatId}\n`;
          output += `**时区**: ${typedInput.timezone}\n`;
          output += `**创建时间**: ${task.createdAt.toISOString()}\n\n`;
    
          output += `## Cron 表达式\n\n`;
          output += `\`\`\`\n${typedInput.cronExpression}\n\`\`\`\n\n`;
    
          if (typedInput.template) {
            output += `## 预设模板\n\n`;
            output += `${typedInput.template}\n\n`;
          }
    
          return output;
        },
      };
}

// 添加 CronCreateInput 类型
interface CronCreateInput {
  name: string;
  cronExpression: string;
  message: string;
  channel: string;
  chatId: string;
  enabled?: boolean;
  template?: "hourly" | "daily" | "weekly" | "monthly";
  timezone?: string;
}

/**
 * 创建 task_update_tool 工具
 */
export function createTaskUpdateTool(_config: TaskCapabilityConfig): ToolDefinition {
  return {
    name: "task_update_tool",
    description: "更新现有任务的配置和状态",
    inputSchema: {
      parse: (input: unknown) => {
        if (typeof input === "object" && input !== null && "taskId" in input) {
          const parsed = input as TaskUpdateInput;

          if (typeof parsed.taskId !== "string" || parsed.taskId.length === 0) {
            throw new Error("TaskId must be a non-empty string");
          }

          return parsed;
        }
        throw new Error("Invalid input: expected TaskUpdateInput");
      },
    } as unknown as ToolDefinition["inputSchema"],
    execute: async (input: unknown) => {
      const typedInput = input as TaskUpdateInput;

      // 查找任务
      const task = taskStore.get(typedInput.taskId);
      if (!task) {
        throw new Error(`Task not found: ${typedInput.taskId}`);
      }

      // 更新任务
      if (typedInput.name !== undefined) {
        task.name = typedInput.name;
      }
      if (typedInput.message !== undefined) {
        task.message = typedInput.message;
      }
      if (typedInput.enabled !== undefined) {
        task.enabled = typedInput.enabled;
      }
      if (typedInput.config !== undefined) {
        task.config = { ...task.config, ...typedInput.config };
      }
      task.updatedAt = new Date();

      // 格式化输出
      let output = `# 任务已更新\n\n`;
      output += `**任务 ID**: ${task.id}\n`;
      output += `**名称**: ${task.name}\n`;
      output += `**状态**: ${task.enabled ? "已启用" : "已禁用"}\n`;
      output += `**更新时间**: ${task.updatedAt.toISOString()}\n\n`;

      output += `## 配置\n\n`;
      output += JSON.stringify(task.config, null, 2);

      return output;
    },
  };
}