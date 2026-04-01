/**
 * Web 工具模块
 *
 * 提供 Web 搜索、Web 获取和 HTTP 请求能力
 */

import type { ToolDefinition } from "../types";
import type { WebCapabilityConfig } from "../types";
import { createWebSearchTool } from "./search";
import { createWebFetchTool } from "./fetch";
import { createHttpRequestTool } from "./http";

/**
 * 创建 Web 工具
 */
export function createWebTools(config: WebCapabilityConfig): ToolDefinition[] {
  const tools: ToolDefinition[] = [];

  if (!config.enabled) {
    return tools;
  }

  // web_search
  if (config.search?.enabled) {
    tools.push(createWebSearchTool(config.search));
  }

  // web_fetch
  if (config.fetch?.enabled) {
    tools.push(createWebFetchTool(config.fetch));
  }

  // http_request
  if (config.http?.enabled) {
    tools.push(createHttpRequestTool(config.http));
  }

  return tools;
}