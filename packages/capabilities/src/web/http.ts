/**
 * HTTP 请求工具
 *
 * 通用 HTTP 客户端，支持所有 HTTP 方法和自定义配置
 */

import type { ToolDefinition } from "../types";
import type { HttpRequestInput, HttpRequestConfig } from "../types";

/**
 * 创建 http_request 工具
 */
export function createHttpRequestTool(_config: HttpRequestConfig): ToolDefinition {
  return {
    name: "http_request",
    description: "发送 HTTP 请求，支持所有标准 HTTP 方法（GET、POST、PUT、DELETE 等），适用于 API 调用",
    inputSchema: {
      parse: (input: unknown) => {
        if (typeof input === "object" && input !== null && "url" in input) {
          const parsed = input as HttpRequestInput;
          if (typeof parsed.url !== "string" || !parsed.url.startsWith("http")) {
            throw new Error("URL must be a valid HTTP/HTTPS URL");
          }
          if (
            parsed.method &&
            !["GET", "POST", "PUT", "DELETE", "PATCH", "HEAD", "OPTIONS"].includes(parsed.method)
          ) {
            throw new Error("Invalid HTTP method");
          }
          return parsed;
        }
        throw new Error("Invalid input: expected HttpRequestInput");
      },
    } as unknown as ToolDefinition["inputSchema"],
    execute: async (input: unknown) => {
      const typedInput = input as HttpRequestInput;

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
          headers: {
            "Content-Type": "application/json",
            ...headers,
          },
          redirect: followRedirects ? "follow" : "manual",
          signal: AbortSignal.timeout(timeout),
        };

        // 添加请求体
        if (body && ["POST", "PUT", "PATCH"].includes(method)) {
          if (typeof body === "string") {
            options.body = body;
          } else {
            options.body = JSON.stringify(body);
          }
        }

        // 发送请求
        const response = await fetch(url, options);

        // 获取响应
        const contentType = response.headers.get("content-type") || "";
        let responseData: unknown;

        if (contentType.includes("application/json")) {
          responseData = await response.json();
        } else {
          responseData = await response.text();
        }

        // 格式化输出
        let output = `# HTTP 请求结果\n\n`;
        output += `**请求**: ${method} ${url}\n`;
        output += `**状态**: ${response.status} ${response.statusText}\n`;
        output += `**成功**: ${response.ok ? "是" : "否"}\n\n`;

        // 请求详情
        output += `## 请求详情\n\n`;
        output += `**方法**: ${method}\n`;
        output += `**URL**: ${url}\n`;
        output += `**超时**: ${timeout}ms\n`;
        output += `**跟随重定向**: ${followRedirects ? "是" : "否"}\n`;

        if (Object.keys(headers).length > 0) {
          output += `\n**请求头**:\n`;
          Object.entries(headers).forEach(([key, value]) => {
            output += `${key}: ${value}\n`;
          });
        }

        if (body) {
          output += `\n**请求体**:\n`;
          output += typeof body === "string" ? body : JSON.stringify(body, null, 2);
        }

        // 响应详情
        output += `\n## 响应详情\n\n`;
        output += `**状态码**: ${response.status}\n`;
        output += `**状态文本**: ${response.statusText}\n`;
        output += `**Content-Type**: ${contentType}\n`;
        output += `**Content-Length**: ${response.headers.get("content-length") || "unknown"}\n\n`;

        output += `**响应头**:\n`;
        response.headers.forEach((value, key) => {
          output += `${key}: ${value}\n`;
        });

        // 响应数据
        output += `\n## 响应数据\n\n`;
        if (typeof responseData === "string") {
          output += responseData;
        } else {
          output += JSON.stringify(responseData, null, 2);
        }

        return output;
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") {
          throw new Error(`HTTP request timeout after ${typedInput.timeout}ms`);
        }
        throw error;
      }
    },
  };
}
