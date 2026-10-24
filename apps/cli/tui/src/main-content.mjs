// 标准模式用 Ink Static 保留历史；全屏模式显式选择，不强迫空屏撑满终端。
import React from "react";
import { Box, Static } from "ink";
import { Header, EmptyState, MessageRow, ToolCard, h } from "./components.mjs";
import { Viewport } from "./viewport.mjs";
import { transcriptItems, splitTranscript } from "./transcript.mjs";

function HistoryItem({ item, compact }) {
  return item.type === "tool" ? h(ToolCard, { call: item.call, compact })
    : h(MessageRow, { ...item, compact });
}

export function MainContent({ messages, tools, stream, busy, sessionId, sessionTitle, version, compact, screen, controlsOpen }) {
  const items = transcriptItems(messages, tools);
  const { stable, active } = splitTranscript(items, busy);
  const header = { key: "header", type: "header" };
  const renderItem = (item) => item.type === "header"
    ? h(Header, { key: item.key, version, sessionTitle, compact })
    : h(HistoryItem, { key: item.key, item, compact });
  if (screen) return h(Viewport, { active: !controlsOpen, resetKey: sessionId, showIndicator: true },
    renderItem(header),
    items.map(renderItem),
    stream ? h(MessageRow, { role: "assistant", text: stream, streaming: true, compact }) : null,
    items.length === 0 && !stream && !busy && !controlsOpen ? h(EmptyState, { compact }) : null,
  );
  return h(Box, { flexDirection: "column", flexShrink: 0 },
    h(Static, { key: sessionId, items: [header, ...stable] }, renderItem),
    active.map(renderItem),
    stream ? h(MessageRow, { role: "assistant", text: stream, streaming: true, compact }) : null,
    items.length === 0 && !stream && !busy && !controlsOpen ? h(EmptyState, { compact }) : null,
  );
}
