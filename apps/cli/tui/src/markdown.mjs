/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * 修改说明（SaCode，2026-10-24）：从 Gemini CLI MarkdownDisplay.tsx 的块级
 * 解析流程适配为 React18/Ink5 经典 JS；去掉 Google 配置/context，分离安全
 * 行内与代码展示，表格使用不丢单元格的记录视图，修正表格结束行被漏解析。
 * 补充：引用块、标题层级、嵌套列表、删除线、斜体。
 * 来源 a3dd9f8c7bcb495a46d0b505b6f179996ccd8332，详见 third-party/README.md。
 */
import React from "react";
import { Box, Text } from "ink";
import { Inline, CodeBlock, TableBlock } from "./content.mjs";
import { THEME } from "./theme.mjs";
import { displayText } from "./commands.mjs";
const h = React.createElement;

const HEADING_STYLE = {
  1: { bold: true, color: THEME.accent },
  2: { bold: true, color: THEME.accent },
  3: { bold: true },
  4: { bold: true, dimColor: true },
};

export function Markdown({ text, pending = false }) {
  if (!text) return null;
  const lines = String(text).split(/\r?\n/);
  const fence = /^ *(`{3,}|~{3,})(?:\s*([^`~\s]+))?\s*$/;
  const header = /^ *(#{1,4}) +(.*)/;
  const list = /^([ \t]*)([-*+]|\d+\.) +(.*)/;
  const quote = /^ *> ?(.*)/;
  const separator = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)+\|?\s*$/;
  const row = /^\s*\|(.+)\|\s*$/;
  const blocks = [];
  let code = null;
  let table = null;
  let lastEmpty = true;
  const push = (node) => { blocks.push(node); lastEmpty = false; };
  const flushTable = () => {
    if (table) push(h(TableBlock, { key: `table-${blocks.length}`, ...table }));
    table = null;
  };
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const match = line.match(fence);
    if (code) {
      if (match && !match[2] && match[1][0] === code.fence[0] && match[1].length >= code.fence.length) {
        push(h(CodeBlock, { key: index, content: code.lines, lang: code.lang }));
        code = null;
      } else code.lines.push(line);
      continue;
    }
    if (table) {
      const cells = line.match(row);
      if (cells) { table.rows.push(cells[1].split("|").map((cell) => cell.trim())); continue; }
      flushTable();
    }
    if (match) { code = { fence: match[1], lang: match[2], lines: [] }; continue; }
    const cells = line.match(row);
    if (cells && separator.test(lines[index + 1] || "")) {
      table = { headers: cells[1].split("|").map((cell) => cell.trim()), rows: [] };
      index++;
      continue;
    }
    const heading = line.match(header);
    const item = line.match(list);
    const quoted = line.match(quote);
    if (heading) {
      const level = heading[1].length;
      const style = HEADING_STYLE[level] || HEADING_STYLE[4];
      push(h(Text, { key: index, ...style }, h(Inline, { text: heading[2] })));
    } else if (quoted) {
      push(h(Box, { key: index, flexDirection: "row", flexShrink: 0 },
        h(Text, { color: THEME.accent, dimColor: true }, "│ "),
        h(Box, { flexGrow: 1, flexShrink: 1, minWidth: 0 },
          h(Text, { dimColor: true, wrap: "wrap" }, displayText(quoted[1])),
        ),
      ));
    } else if (item) {
      const indent = item[1].length;
      const marker = item[2];
      push(h(Box, { key: index, flexDirection: "row", paddingLeft: indent },
        h(Text, { color: THEME.accent }, `${marker} `),
        h(Box, { flexGrow: 1, flexShrink: 1, minWidth: 0 },
          h(Inline, { text: item[3] }),
        ),
      ));
    } else if (/^ *([-*_] *){3,} *$/.test(line)) {
      push(h(Text, { key: index, dimColor: true }, "───"));
    } else if (!line.trim()) {
      if (!lastEmpty) { blocks.push(h(Box, { key: index, height: 1 })); lastEmpty = true; }
    } else push(h(Inline, { key: index, text: line }));
  }
  if (code) push(h(CodeBlock, { key: "code-eof", content: code.lines, lang: code.lang, pending }));
  flushTable();
  return h(Box, { flexDirection: "column", flexShrink: 0 }, blocks);
}
