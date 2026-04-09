/**
 * Markdown 渲染组件
 *
 * 参考 Gemini CLI 的 MarkdownDisplay 实现
 * 支持标题、代码块、列表、表格等元素
 */

import React, { memo, useMemo } from "react";
import { Text, Box } from "ink";
import { CodeHighlight } from "./CodeHighlight.js";
import { getThemeManager, toInkColor } from "../theme/index.js";

// ============================================================================
// Markdown 解析
// ============================================================================

export type MarkdownNodeType =
  | "text"
  | "heading"
  | "paragraph"
  | "code"
  | "inlineCode"
  | "bold"
  | "italic"
  | "link"
  | "list"
  | "listItem"
  | "blockquote"
  | "hr"
  | "table";

export interface MarkdownNode {
  type: MarkdownNodeType;
  content?: string;
  children?: MarkdownNode[];
  level?: number; // for heading
  language?: string; // for code
  href?: string; // for link
  ordered?: boolean; // for list
  index?: number; // for list item
  isPending?: boolean; // for streaming
}

/**
 * 简单的 Markdown 解析器
 * 注意：这是一个简化实现，不支持完整的 Markdown 语法
 */
export function parseMarkdown(text: string): MarkdownNode[] {
  const nodes: MarkdownNode[] = [];
  const lines = text.split("\n");
  let i = 0;

  while (i < lines.length) {
    const line = lines[i]!;

    // 空行
    if (line.trim() === "") {
      i++;
      continue;
    }

    // 标题
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      nodes.push({
        type: "heading",
        level: headingMatch[1]!.length,
        children: parseInline(headingMatch[2]!),
      });
      i++;
      continue;
    }

    // 代码块
    const codeBlockMatch = line.match(/^```(\w*)$/);
    if (codeBlockMatch) {
      const language = codeBlockMatch[1] || undefined;
      const codeLines: string[] = [];
      i++;

      while (i < lines.length && !lines[i]!.startsWith("```")) {
        codeLines.push(lines[i]!);
        i++;
      }

      nodes.push({
        type: "code",
        ...(language != null ? { language } : {}),
        content: codeLines.join("\n"),
      });
      i++; // skip closing ```
      continue;
    }

    // 列表（无序）
    const ulMatch = line.match(/^(\s*)[-*+]\s+(.+)$/);
    if (ulMatch) {
      const indent = ulMatch[1]!.length;
      const items: MarkdownNode[] = [];

      while (i < lines.length) {
        const itemMatch = lines[i]!.match(/^(\s*)[-*+]\s+(.+)$/);
        if (!itemMatch || itemMatch[1]!.length !== indent) break;

        items.push({
          type: "listItem",
          children: parseInline(itemMatch[2]!),
          index: items.length,
        });
        i++;
      }

      nodes.push({
        type: "list",
        ordered: false,
        children: items,
      });
      continue;
    }

    // 列表（有序）
    const olMatch = line.match(/^(\s*)\d+\.\s+(.+)$/);
    if (olMatch) {
      const indent = olMatch[1]!.length;
      const items: MarkdownNode[] = [];

      while (i < lines.length) {
        const itemMatch = lines[i]!.match(/^(\s*)\d+\.\s+(.+)$/);
        if (!itemMatch || itemMatch[1]!.length !== indent) break;

        items.push({
          type: "listItem",
          children: parseInline(itemMatch[2]!),
          index: items.length,
        });
        i++;
      }

      nodes.push({
        type: "list",
        ordered: true,
        children: items,
      });
      continue;
    }

    // 引用
    if (line.startsWith("> ")) {
      const quoteLines: string[] = [line.slice(2)];
      i++;

      while (i < lines.length && lines[i]!.startsWith("> ")) {
        quoteLines.push(lines[i]!.slice(2));
        i++;
      }

      nodes.push({
        type: "blockquote",
        children: parseMarkdown(quoteLines.join("\n")),
      });
      continue;
    }

    // 水平线
    if (/^[-*_]{3,}$/.test(line.trim())) {
      nodes.push({ type: "hr" });
      i++;
      continue;
    }

    // 普通段落
    const paragraphLines: string[] = [line];
    i++;

    while (
      i < lines.length &&
      lines[i]!.trim() !== "" &&
      !lines[i]!.match(/^(#{1,6}|```|[-*+]|\d+\.|>)/)
    ) {
      paragraphLines.push(lines[i]!);
      i++;
    }

    nodes.push({
      type: "paragraph",
      children: parseInline(paragraphLines.join("\n")),
    });
  }

  return nodes;
}

/**
 * 解析内联元素
 */
function parseInline(text: string): MarkdownNode[] {
  const nodes: MarkdownNode[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    // 内联代码
    const codeMatch = remaining.match(/`([^`]+)`/);
    if (codeMatch && codeMatch.index !== undefined) {
      if (codeMatch.index > 0) {
        nodes.push(...parseInlineSimple(remaining.slice(0, codeMatch.index)));
      }
      nodes.push({
        type: "inlineCode",
        content: codeMatch[1] ?? "",
      });
      remaining = remaining.slice(codeMatch.index + codeMatch[0].length);
      continue;
    }

    // 链接
    const linkMatch = remaining.match(/\[([^\]]+)\]\(([^)]+)\)/);
    if (linkMatch && linkMatch.index !== undefined) {
      if (linkMatch.index > 0) {
        nodes.push(...parseInlineSimple(remaining.slice(0, linkMatch.index)));
      }
      nodes.push({
        type: "link",
        content: linkMatch[1] ?? "",
        href: linkMatch[2] ?? "",
      });
      remaining = remaining.slice(linkMatch.index + linkMatch[0].length);
      continue;
    }

    // 粗体
    const boldMatch = remaining.match(/\*\*([^*]+)\*\*|__([^_]+)__/);
    if (boldMatch && boldMatch.index !== undefined) {
      if (boldMatch.index > 0) {
        nodes.push(...parseInlineSimple(remaining.slice(0, boldMatch.index)));
      }
      nodes.push({
        type: "bold",
        children: [{ type: "text", content: boldMatch[1] || boldMatch[2] || "" }],
      });
      remaining = remaining.slice(boldMatch.index + boldMatch[0]!.length);
      continue;
    }

    // 斜体
    const italicMatch = remaining.match(/\*([^*]+)\*|_([^_]+)_/);
    if (italicMatch && italicMatch.index !== undefined) {
      if (italicMatch.index > 0) {
        nodes.push(...parseInlineSimple(remaining.slice(0, italicMatch.index)));
      }
      nodes.push({
        type: "italic",
        children: [{ type: "text", content: italicMatch[1] || italicMatch[2] || "" }],
      });
      remaining = remaining.slice(italicMatch.index + italicMatch[0]!.length);
      continue;
    }

    // 没有特殊格式，作为纯文本处理
    nodes.push({ type: "text", content: remaining });
    break;
  }

  return nodes;
}

/**
 * 解析简单内联（只处理粗体和斜体）
 */
function parseInlineSimple(text: string): MarkdownNode[] {
  // 简化处理，返回纯文本
  return [{ type: "text", content: text }];
}

// ============================================================================
// 渲染组件
// ============================================================================

export interface MarkdownDisplayProps {
  /** Markdown 内容 */
  content: string;
  /** 最大宽度 */
  width?: number;
  /** 是否处于流式输出状态 */
  isPending?: boolean;
}

/**
 * Markdown 渲染组件
 */
export const MarkdownDisplay: React.FC<MarkdownDisplayProps> = memo(
  ({ content, width, isPending }) => {
    const colors = getThemeManager().getSemanticColors();

    // 解析 Markdown
    const nodes = useMemo(() => parseMarkdown(content), [content]);

    // 渲染节点
    const renderNode = (node: MarkdownNode, key?: number): React.ReactNode => {
      switch (node.type) {
        case "text":
          return <Text key={key}>{node.content}</Text>;

        case "heading": {
          const headingColors = [
            colors.text.accent,
            colors.text.primary,
            colors.text.primary,
            colors.text.secondary,
            colors.text.secondary,
            colors.text.comment,
          ];
          const color = headingColors[Math.min((node.level ?? 1) - 1, 5)] ?? colors.text.primary;
          const prefix = "##".repeat(node.level ?? 1);

          return (
            <Box key={key} marginTop={1} marginBottom={0}>
              <Text bold color={toInkColor(color)}>
                {prefix}{" "}
              </Text>
              <Text bold color={toInkColor(color)}>
                {renderChildren(node.children)}
              </Text>
            </Box>
          );
        }

        case "paragraph":
          return (
            <Box key={key} marginTop={0} marginBottom={0}>
              <Text>{renderChildren(node.children)}</Text>
            </Box>
          );

        case "code":
          return (
            <Box key={key} flexDirection="column" marginTop={1} marginBottom={1} paddingX={1}>
              {node.language && (
                <Text dimColor color="gray">
                  {node.language}
                </Text>
              )}
              <CodeHighlight
                code={node.content ?? ""}
                {...(node.language != null ? { language: node.language } : {})}
                showLineNumbers={(node.content?.split("\n").length ?? 0) > 5}
                {...(isPending ? { isPending: true } : {})}
              />
            </Box>
          );

        case "inlineCode":
          return (
            <Text key={key} backgroundColor={colors.syntax.string} color="black">
              {" "}
              {node.content}{" "}
            </Text>
          );

        case "bold":
          return (
            <Text key={key} bold>
              {renderChildren(node.children)}
            </Text>
          );

        case "italic":
          return (
            <Text key={key} italic>
              {renderChildren(node.children)}
            </Text>
          );

        case "link":
          return (
            <Text key={key} color={toInkColor(colors.text.link)}>
              {node.content}
              <Text dimColor color="gray">
                {" "}
                ({node.href})
              </Text>
            </Text>
          );

        case "list":
          return (
            <Box key={key} flexDirection="column" marginTop={0}>
              {node.children?.map((item, idx) => (
                <Box key={idx}>
                  <Text color={toInkColor(colors.text.primary)}>
                    {node.ordered ? `${(item.index ?? idx) + 1}. ` : "• "}
                  </Text>
                  <Text>{renderChildren(item.children)}</Text>
                </Box>
              ))}
            </Box>
          );

        case "blockquote":
          return (
            <Box key={key} flexDirection="column" paddingX={1}>
              <Text dimColor italic>
                {node.children?.map((child, idx) => renderNode(child, idx))}
              </Text>
            </Box>
          );

        case "hr":
          return (
            <Text key={key} dimColor color="gray">
              {"─".repeat(width ?? 40)}
            </Text>
          );

        default:
          return null;
      }
    };

    const renderChildren = (children?: MarkdownNode[]): React.ReactNode => {
      if (!children) return null;
      return children.map((child, idx) => renderNode(child, idx));
    };

    return (
      <Box flexDirection="column" width={width}>
        {nodes.map((node, idx) => renderNode(node, idx))}
        {isPending && (
          <Text dimColor color="gray">
            ... generating more ...
          </Text>
        )}
      </Box>
    );
  }
);

MarkdownDisplay.displayName = "MarkdownDisplay";

export default MarkdownDisplay;
