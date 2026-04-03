/**
 * 代码高亮组件
 *
 * 参考 Gemini CLI 的代码高亮实现
 * 使用 highlight.js 进行语法高亮，映射到 Ink 颜色
 */

import React, { useMemo, memo } from "react";
import { Text, Box } from "ink";
import hljs from "highlight.js";
import { getThemeManager, toInkColor, type SyntaxColors } from "../theme/index.js";

// ============================================================================
// highlight.js token 类型到语义颜色的映射
// ============================================================================

/**
 * highlight.js 类名到语义颜色键的映射
 */
const hljsClassToSemantic: Record<string, keyof SyntaxColors> = {
  // 关键字
  "hljs-keyword": "keyword",
  "hljs-built_in": "builtin",
  "hljs-type": "builtin",
  "hljs-class": "class",

  // 字符串
  "hljs-string": "string",
  "hljs-char": "string",
  "hljs-subst": "string",
  "hljs-symbol": "string",
  "hljs-attribute": "attributeValue",

  // 数字
  "hljs-number": "number",
  "hljs-literal": "constant",

  // 注释
  "hljs-comment": "comment",
  "hljs-doctag": "comment",
  "hljs-quote": "comment",

  // 函数
  "hljs-function": "function",
  "hljs-title": "function",
  "hljs-section": "function",

  // 变量
  "hljs-variable": "variable",
  "hljs-params": "variable",
  "hljs-property": "property",

  // 操作符和标点
  "hljs-operator": "operator",
  "hljs-punctuation": "punctuation",
  "hljs-tag": "tag",

  // 正则
  "hljs-regexp": "regex",

  // 属性
  "hljs-attr": "attributeName",
  "hljs-name": "tag",

  // 其他
  "hljs-meta": "comment",
  "hljs-meta-keyword": "keyword",
  "hljs-meta-string": "string",
  "hljs-addition": "inserted",
  "hljs-deletion": "deleted",
  "hljs-emphasis": "variable",
  "hljs-strong": "keyword",
  "hljs-formula": "string",
  "hljs-link": "link",
  "hljs-selector-tag": "tag",
  "hljs-selector-id": "attributeName",
  "hljs-selector-class": "attributeName",
  "hljs-selector-attr": "attributeName",
  "hljs-selector-pseudo": "attributeName",
  "hljs-template-tag": "tag",
  "hljs-template-variable": "variable",
};

// ============================================================================
// Token 类型
// ============================================================================

export interface HighlightToken {
  /** 文本内容 */
  content: string;
  /** 颜色 */
  color: string | undefined;
  /** 是否粗体 */
  bold?: boolean;
  /** 是否斜体 */
  italic?: boolean;
}

// ============================================================================
// 高亮处理
// ============================================================================

/**
 * 从 highlight.js 结果中提取 tokens
 */
function extractTokens(
  highlighted: string,
  syntaxColors: SyntaxColors
): HighlightToken[] {
  const tokens: HighlightToken[] = [];

  // 解析 HTML 高亮结果
  // highlight.js 返回的是 HTML，格式如: <span class="hljs-keyword">const</span>
  const regex = /<span class="([^"]+)">([^<]*)<\/span>|([^<]+)/g;
  let match;

  while ((match = regex.exec(highlighted)) !== null) {
    if (match[3] !== undefined) {
      // 纯文本（无高亮）
      if (match[3]) {
        tokens.push({
          content: match[3],
          color: undefined,
        });
      }
    } else if (match[1] !== undefined && match[2] !== undefined) {
      // 高亮文本
      const className = match[1];
      const content = match[2];

      // 解析多个类名
      const classes = className.split(" ");
      let color: string | undefined;
      let bold = false;
      let italic = false;

      for (const cls of classes) {
        const semanticKey = hljsClassToSemantic[cls];
        if (semanticKey) {
          color = syntaxColors[semanticKey];
        }
        if (cls.includes("strong")) bold = true;
        if (cls.includes("emphasis")) italic = true;
      }

      tokens.push({
        content,
        color,
        bold,
        italic,
      });
    }
  }

  return tokens;
}

/**
 * 简单的代码高亮（不使用 highlight.js 的 HTML 输出）
 * 直接使用 highlight.js 的 token 分析
 */
function highlightCodeSimple(
  code: string,
  language: string | undefined,
  syntaxColors: SyntaxColors
): HighlightToken[] {
  // 如果没有语言或语言不支持，返回纯文本
  if (!language) {
    return [{ content: code, color: undefined }];
  }

  try {
    // 检查语言是否支持
    const lang = hljs.getLanguage(language);
    if (!lang) {
      return [{ content: code, color: undefined }];
    }

    // 使用 highlight.js 高亮
    const result = hljs.highlight(code, { language, ignoreIllegals: true });
    return extractTokens(result.value, syntaxColors);
  } catch {
    // 出错时返回纯文本
    return [{ content: code, color: undefined }];
  }
}

// ============================================================================
// 组件
// ============================================================================

export interface CodeHighlightProps {
  /** 代码内容 */
  code: string;
  /** 语言 */
  language?: string;
  /** 是否显示行号 */
  showLineNumbers?: boolean;
  /** 起始行号 */
  startLine?: number;
  /** 最大高度（行数） */
  maxLines?: number;
  /** 是否处于流式输出状态 */
  isPending?: boolean;
}

/**
 * 代码高亮组件
 */
export const CodeHighlight: React.FC<CodeHighlightProps> = memo(
  ({ code, language, showLineNumbers = false, startLine = 1, maxLines, isPending }) => {
    const syntaxColors = getThemeManager().getSemanticColors().syntax;

    // 高亮处理
    const tokens = useMemo(() => {
      return highlightCodeSimple(code, language, syntaxColors);
    }, [code, language, syntaxColors]);

    // 行处理
    const lines = useMemo(() => {
      const codeLines = code.split("\n");
      const displayLines = maxLines ? codeLines.slice(0, maxLines) : codeLines;
      const truncated = maxLines && codeLines.length > maxLines;

      return {
        lines: displayLines,
        truncated,
        totalLines: codeLines.length,
      };
    }, [code, maxLines]);

    // 行号宽度
    const lineNumberWidth = useMemo(() => {
      if (!showLineNumbers) return 0;
      return String(lines.totalLines + startLine - 1).length + 1;
    }, [showLineNumbers, lines.totalLines, startLine]);

    // 渲染单行
    const renderLine = (line: string, lineNumber: number) => {
      // 简单高亮：对整行应用颜色
      const lineTokens = highlightCodeSimple(line, language, syntaxColors);

      return (
        <Box key={lineNumber}>
          {showLineNumbers && (
            <Text dimColor>
              {String(lineNumber).padStart(lineNumberWidth)}{" "}
            </Text>
          )}
          {lineTokens.map((token, idx) => (
            <Text
              key={idx}
              color={token.color ? toInkColor(token.color) : undefined}
              bold={token.bold}
              italic={token.italic}
            >
              {token.content}
            </Text>
          ))}
        </Box>
      );
    };

    return (
      <Box flexDirection="column">
        {lines.lines.map((line, idx) => renderLine(line, startLine + idx))}

        {/* 截断提示 */}
        {lines.truncated && (
          <Text dimColor color="gray">
            ... ({lines.totalLines - maxLines!} more lines)
          </Text>
        )}

        {/* 流式输出提示 */}
        {isPending && (
          <Text dimColor color="gray">
            ... generating more ...
          </Text>
        )}
      </Box>
    );
  }
);

CodeHighlight.displayName = "CodeHighlight";

// ============================================================================
// 内联代码高亮
// ============================================================================

export interface InlineCodeProps {
  /** 代码内容 */
  code: string;
  /** 语言（可选） */
  language?: string;
}

/**
 * 内联代码高亮组件
 */
export const InlineCode: React.FC<InlineCodeProps> = memo(({ code, language }) => {
  const syntaxColors = getThemeManager().getSemanticColors().syntax;

  // 简单处理：只高亮第一行
  const tokens = useMemo(() => {
    // 移除换行符，作为内联代码显示
    const inlineCode = code.replace(/\n/g, " ");
    return highlightCodeSimple(inlineCode, language, syntaxColors);
  }, [code, language, syntaxColors]);

  return (
    <Text backgroundColor={syntaxColors.string} color="black">
      {" "}
      {tokens.map((token, idx) => (
        <Text
          key={idx}
          color={token.color ? toInkColor(token.color) : "black"}
          bold={token.bold}
        >
          {token.content}
        </Text>
      ))}{" "}
    </Text>
  );
});

InlineCode.displayName = "InlineCode";

// ============================================================================
// 工具函数
// ============================================================================

/**
 * 检测代码语言
 */
export function detectLanguage(code: string): string | undefined {
  try {
    const result = hljs.highlightAuto(code);
    if (result.language && result.relevance > 5) {
      return result.language;
    }
  } catch {
    // ignore
  }
  return undefined;
}

/**
 * 获取支持的语言列表
 */
export function getSupportedLanguages(): string[] {
  return hljs.listLanguages();
}

export default CodeHighlight;
