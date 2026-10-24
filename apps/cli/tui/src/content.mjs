// SaCode 的安全展示适配；不执行模型文本、链接、HTML 或终端转义。
// 代码高亮为自行实现的轻量 tokenizer，不引入 highlight.js / lowlight 依赖。
import React from "react";
import { Box, Text, useStdout } from "ink";
import stringWidth from "string-width";
import { displayText } from "./commands.mjs";
import { THEME } from "./theme.mjs";
const h = React.createElement;

// ── 行内 Markdown ──

export function Inline({ text }) {
  const clean = displayText(text);
  // 按顺序匹配：行内代码、粗体、斜体、删除线、链接
  const tokens = clean.split(/(`[^`]+`|\*\*[^*]+\*\*|(?<!\w)\*[^*]+\*|(?<!\w)__[^_]+__(?!\w)|(?<!\w)_[^_]+_(?!\w)|~~[^~]+~~|\[[^\]]+\]\([^)]+\))/g);
  return h(Text, null, tokens.map((part, index) => {
    if (!part) return null;
    if (/^`[^`]+`$/.test(part)) return h(Text, { key: index, color: THEME.accent, dimColor: false }, part.slice(1, -1));
    if (/^(\*\*[^*]+\*\*|__[^_]+__)$/.test(part)) return h(Text, { key: index, bold: true }, part.slice(2, -2));
    if (/^~~[^~]+~~$/.test(part)) return h(Text, { key: index, strikethrough: true, dimColor: true }, part.slice(2, -2));
    if (/^(\*[^*]+\*|_[^_]+_)$/.test(part)) return h(Text, { key: index, italic: true }, part.slice(1, -1));
    const link = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (link) return h(Text, { key: index, underline: true, color: THEME.accent }, `${link[1]} (${link[2]})`);
    return h(Text, { key: index }, part);
  }));
}

// ── 语法高亮 tokenizer ──

const KEYWORDS = {
  javascript: new Set(["const", "let", "var", "function", "class", "extends", "super", "import", "export", "from", "default", "async", "await", "return", "if", "else", "for", "while", "do", "switch", "case", "break", "continue", "new", "delete", "typeof", "instanceof", "in", "of", "try", "catch", "finally", "throw", "this", "null", "undefined", "true", "false", "void", "yield", "static", "get", "set", "namespace"]),
  typescript: new Set(["const", "let", "var", "function", "class", "extends", "implements", "super", "import", "export", "from", "default", "async", "await", "return", "if", "else", "for", "while", "do", "switch", "case", "break", "continue", "new", "delete", "typeof", "instanceof", "in", "of", "try", "catch", "finally", "throw", "this", "null", "undefined", "true", "false", "void", "yield", "static", "get", "set", "namespace", "interface", "type", "enum", "readonly", "private", "public", "protected", "abstract", "as", "is", "keyof", "infer", "declare"]),
  python: new Set(["def", "class", "import", "from", "as", "return", "if", "elif", "else", "for", "while", "break", "continue", "pass", "with", "try", "except", "finally", "raise", "yield", "lambda", "global", "nonlocal", "assert", "del", "in", "is", "not", "and", "or", "None", "True", "False", "self", "cls", "async", "await", "property", "staticmethod", "classmethod"]),
  bash: new Set(["if", "then", "else", "elif", "fi", "for", "in", "do", "done", "while", "until", "case", "esac", "function", "return", "break", "continue", "exit", "local", "export", "readonly", "declare", "source", "echo", "printf", "read", "test", "true", "false", "cd", "pwd", "ls", "cat", "grep", "sed", "awk", "mkdir", "rm", "cp", "mv", "chmod", "chown", "sudo", "apt", "npm", "node", "git", "curl", "wget"]),
  cj: new Set(["let", "var", "func", "class", "struct", "enum", "interface", "extends", "implements", "import", "package", "public", "private", "protected", "internal", "open", "override", "static", "init", "this", "super", "return", "if", "else", "match", "for", "while", "do", "break", "continue", "try", "catch", "finally", "throw", "raise", "in", "is", "as", "type", "alias", "prop", "main", "true", "false", "None", "Unit", "Int64", "String", "Bool", "Float64", "Array", "Map", "Set", "Option", "Some", "None"]),
};

const LANG_ALIASES = { js: "javascript", jsx: "javascript", ts: "typescript", tsx: "typescript", sh: "bash", shell: "bash", zsh: "bash", py: "python", cj: "cj", cangjie: "cj" };

export function highlightLine(line, lang = "") {
  const resolved = LANG_ALIASES[lang.toLowerCase()] || lang.toLowerCase();
  const keywords = KEYWORDS[resolved];
  if (!keywords && resolved !== "json") return [{ text: line }];
  const tokens = [];
  // 连续覆盖每个码点，不能用 \b 分词跳过中文、数字后缀或未知语法。
  const regex = /"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`|\/\*.*?\*\/|\/\/.*|#.*|\d+(?:\.\d+)?|[\p{L}_$][\p{L}\p{N}_$]*|\s+|./guy;
  let offset = 0;
  while (offset < line.length) {
    regex.lastIndex = offset;
    const text = regex.exec(line)?.[0] || String.fromCodePoint(line.codePointAt(offset));
    offset += text.length;
    const hashComment = ["python", "bash"].includes(resolved) && text.startsWith("#");
    const slashComment = ["javascript", "typescript", "cj"].includes(resolved) && /^\/[/\*]/.test(text);
    if (hashComment || slashComment) tokens.push({ text, dimColor: true, italic: true });
    else if (/^["'`]/.test(text)) tokens.push({ text, color: "green" });
    else if (/^\d/.test(text)) tokens.push({ text, color: "magenta" });
    else if (keywords?.has(text) || (resolved === "json" && /^(true|false|null)$/.test(text))) tokens.push({ text, color: THEME.accent, bold: true });
    else if (/^[A-Z][A-Za-z0-9_]*$/.test(text) && text.length > 1) tokens.push({ text, color: "yellow" });
    else if (/^\s+$/.test(text)) tokens.push({ text });
    else tokens.push({ text });
  }
  return tokens;
}

// ── 代码块 ──

export function CodeBlock({ content, lang, pending = false }) {
  const diff = /^(diff|patch)$/i.test(lang || "");
  const digits = String(content.length || 1).length;
  return h(Box, { flexDirection: "column", flexShrink: 0, marginY: 1 },
    h(Box, { flexDirection: "row" },
      h(Text, { dimColor: true, bold: true }, ` ${displayText(lang || "code")} `),
      pending ? h(Text, { dimColor: true }, "· 正在生成…") : null,
    ),
    content.map((line, index) => {
      if (diff) {
        const isAdd = /^\+(?!\+\+)/.test(line);
        const isDel = /^-(?!--)/.test(line);
        const color = isAdd ? THEME.success : isDel ? THEME.danger : undefined;
        return h(Box, { key: index },
          h(Text, { dimColor: true, color }, `${String(index + 1).padStart(digits)} │ `),
          h(Box, { flexGrow: 1, flexShrink: 1, minWidth: 0 },
            h(Text, { wrap: "wrap", color }, displayText(line) || " "),
          ),
        );
      }
      const tokens = highlightLine(displayText(line), lang);
      return h(Box, { key: index },
        h(Text, { dimColor: true }, `${String(index + 1).padStart(digits)} │ `),
        h(Box, { flexGrow: 1, flexShrink: 1, minWidth: 0 },
          h(Text, { wrap: "wrap" }, tokens.length > 0
            ? tokens.map((token, ti) => h(Text, { key: ti, color: token.color, bold: token.bold, italic: token.italic, dimColor: token.dimColor }, token.text))
            : " ",
          ),
        ),
      );
    }),
  );
}

// ── 表格 ──

export function TableBlock({ headers, rows }) {
  const { stdout } = useStdout();
  const safeHeaders = headers.map(displayText);
  const safeRows = rows.map((row) => row.map(displayText));
  const columns = Math.max(headers.length, ...rows.map((row) => row.length));
  const widths = Array.from({ length: columns }, (_, column) => Math.max(
    stringWidth(safeHeaders[column] || String(column + 1)),
    ...safeRows.map((row) => stringWidth(row[column] || "")),
  ));
  // 宽屏排成表格，窄屏或长单元格转记录视图；不以截断单元格凑列宽。
  const fits = widths.reduce((sum, width) => sum + width, 0) + Math.max(0, columns - 1) * 3 <= (stdout.columns || 80) - 8;
  if (fits) {
    const line = (cells, bold = false) => h(Text, { bold }, widths.map((width, column) => {
      const cell = cells[column] || "";
      return cell + " ".repeat(Math.max(0, width - stringWidth(cell)));
    }).join(" │ "));
    return h(Box, { flexDirection: "column", marginY: 1 },
      line(widths.map((_, column) => safeHeaders[column] || String(column + 1)), true),
      h(Text, { dimColor: true }, widths.map((width) => "─".repeat(width)).join("─┼─")),
      safeRows.map((row, index) => h(Box, { key: index }, line(row))),
    );
  }
  return h(Box, { flexDirection: "column", marginY: 1 }, rows.length === 0
    ? h(Text, { dimColor: true }, safeHeaders.join(" · "))
    : rows.map((row, index) => h(Box, { key: index, flexDirection: "column", marginBottom: 1 },
        row.map((cell, column) => h(Text, { key: column },
          h(Text, { bold: true, color: THEME.accent }, `${displayText(headers[column] || String(column + 1))}: `),
          h(Inline, { text: cell }),
        )),
      )),
  );
}
