/**
 * Web 获取工具
 *
 * 使用 fetch API 获取 Web 内容
 */

import type { ToolDefinition } from "../types";
import type { WebFetchInput, WebFetchConfig } from "../types";

/**
 * 创建 web_fetch 工具
 */
export function createWebFetchTool(_config: WebFetchConfig): ToolDefinition {
  return {
    name: "web_fetch",
    description: "获取指定 URL 的内容，支持多种响应格式（JSON、HTML、文本）",
    inputSchema: {
      parse: (input: unknown) => {
        if (typeof input === "object" && input !== null && "url" in input) {
          const parsed = input as WebFetchInput;
          if (typeof parsed.url !== "string" || !parsed.url.startsWith("http")) {
            throw new Error("URL must be a valid HTTP/HTTPS URL");
          }
          return parsed;
        }
        throw new Error("Invalid input: expected WebFetchInput");
      },
    } as unknown as ToolDefinition["inputSchema"],
    execute: async (input: unknown) => {
      const typedInput = input as WebFetchInput;

      try {
        const {
          url,
          method = "GET",
          headers = {},
          body,
          timeout = 30000,
          followRedirects = true,
        } = typedInput;

        // 构建请求选项
        const options: RequestInit = {
          method,
          headers,
          redirect: followRedirects ? "follow" : "manual",
          signal: AbortSignal.timeout(timeout),
        };

        if (body && ["POST", "PUT", "PATCH"].includes(method)) {
          options.body = body;
        }

        // 发送请求
        const response = await fetch(url, options);

        // 获取响应内容
        const contentType = response.headers.get("content-type") || "";
        let content: string;

        if (contentType.includes("application/json")) {
          const json = await response.json();
          content = JSON.stringify(json, null, 2);
        } else if (contentType.includes("text/html")) {
          content = await response.text();
        } else {
          content = await response.text();
        }

        // 格式化输出
        let output = `# Web Fetch 结果\n\n`;
        output += `**URL**: ${url}\n`;
        output += `**状态**: ${response.status} ${response.statusText}\n`;
        output += `**方法**: ${method}\n`;
        output += `**Content-Type**: ${contentType}\n`;
        output += `**Content-Length**: ${response.headers.get("content-length") || "unknown"}\n\n`;

        // 添加响应头
        output += `## 响应头\n\n`;
        response.headers.forEach((value, key) => {
          output += `${key}: ${value}\n`;
        });
        output += "\n";

        // 添加响应内容
        output += `## 响应内容\n\n`;
        output += content;

        return output;
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") {
          throw new Error(`Web fetch timeout after ${typedInput.timeout}ms`);
        }
        throw error;
      }
    },
  };
}
