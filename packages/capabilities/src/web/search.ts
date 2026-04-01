/**
 * Web 搜索工具
 *
 * 使用 DuckDuckGo Instant Answer API 进行 Web 搜索
 */

import type { ToolDefinition } from "../types";
import type { WebSearchInput, WebSearchConfig, WebSearchResult } from "../types";

/**
 * DuckDuckGo API URL
 */
const DUCKDUCKGO_API_URL = "https://api.duckduckgo.com/";

/**
 * 执行 Web 搜索
 */
async function searchDuckDuckGo(input: WebSearchInput): Promise<WebSearchResult> {
  const { query, numResults = 10, language = "zh-CN", timeRange } = input;

  // 构建请求参数
  const params = new URLSearchParams({
    q: query,
    format: "json",
    no_html: "1",
    skip_disambig: "1",
  });

  // 添加时间范围
  if (timeRange) {
    params.append("df", timeRange);
  }

  const url = `${DUCKDUCKGO_API_URL}?${params.toString()}`;

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        "Accept-Language": language,
        "Accept": "application/json",
      },
      signal: AbortSignal.timeout(10000), // 10 秒超时
    });

    if (!response.ok) {
      throw new Error(`DuckDuckGo API request failed: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();

    // 解析结果
    const results: WebSearchResult = {
      query,
      results: [],
      abstract: data.AbstractText || null,
      abstractUrl: data.AbstractURL || null,
      relatedTopics: [],
    };

    // 添加相关主题
    if (data.RelatedTopics && Array.isArray(data.RelatedTopics)) {
      for (const topic of data.RelatedTopics) {
        if (topic.FirstURL && topic.Text) {
          results.relatedTopics.push({
            title: topic.Text,
            url: topic.FirstURL,
          });
          if (results.relatedTopics.length >= numResults) {
            break;
          }
        }
      }
    }

    // 如果没有相关主题，尝试使用外部结果
    if (results.relatedTopics.length === 0 && data.Results && Array.isArray(data.Results)) {
      for (const result of data.Results) {
        if (result.FirstURL && result.Text) {
          results.relatedTopics.push({
            title: result.Text,
            url: result.FirstURL,
          });
          if (results.relatedTopics.length >= numResults) {
            break;
          }
        }
      }
    }

    return results;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("Web search timeout after 10 seconds");
    }
    throw error;
  }
}

/**
 * 创建 web_search 工具
 */
export function createWebSearchTool(config: WebSearchConfig): ToolDefinition {
  return {
    name: "web_search",
    description: "在互联网上搜索信息，支持多语言搜索和时间范围过滤",
    inputSchema: {
      parse: (input: unknown) => {
        if (typeof input === "object" && input !== null && "query" in input) {
          const parsed = input as WebSearchInput;
          if (typeof parsed.query !== "string" || parsed.query.length === 0) {
            throw new Error("Query must be a non-empty string");
          }
          return parsed;
        }
        throw new Error("Invalid input: expected WebSearchInput");
      },
    } as unknown as ToolDefinition["inputSchema"],
    execute: async (input: unknown) => {
      const typedInput = input as WebSearchInput;

      try {
        const result = await searchDuckDuckGo(typedInput);

        // 格式化输出
        let output = `# 搜索结果: ${result.query}\n\n`;

        if (result.abstract) {
          output += `## 摘要\n${result.abstract}\n`;
          if (result.abstractUrl) {
            output += `\n来源: ${result.abstractUrl}\n`;
          }
          output += "\n";
        }

        if (result.relatedTopics.length > 0) {
          output += `## 相关结果 (${result.relatedTopics.length})\n\n`;
          for (let i = 0; i < result.relatedTopics.length; i++) {
            const topic = result.relatedTopics[i];
            output += `${i + 1}. [${topic.title}](${topic.url})\n`;
          }
        } else {
          output += "未找到相关结果。\n";
        }

        return output;
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        throw new Error(`Web search failed: ${err.message}`);
      }
    },
  };
}