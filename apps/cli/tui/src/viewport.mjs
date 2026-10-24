// 按 Ink 实际字格高度滚动，而不是按消息条数估算 CJK/长行折行。
import React, { useLayoutEffect, useRef, useState } from "react";
import { Box, Text, measureElement, useInput } from "ink";
import { h } from "./components.mjs";

export function Viewport({ children, active = true, resetKey = "", label = "对话", fromTop = false, showIndicator = true }) {
  const outer = useRef(null);
  const inner = useRef(null);
  const [dimensions, setDimensions] = useState({ height: 0, content: 0, width: 0 });
  const [back, setBack] = useState(fromTop ? Infinity : 0);
  const maximum = Math.max(0, dimensions.content - dimensions.height);
  const offset = Math.min(back, maximum);
  useLayoutEffect(() => {
    if (!outer.current || !inner.current) return;
    const bounds = measureElement(outer.current);
    const content = measureElement(inner.current).height;
    setDimensions((previous) => previous.height === bounds.height && previous.content === content && previous.width === bounds.width
      ? previous : { height: bounds.height, width: bounds.width, content });
  });
  useLayoutEffect(() => { setBack(fromTop ? Infinity : 0); }, [resetKey, fromTop]);
  useInput((_input, key) => {
    const page = Math.max(1, Math.floor(dimensions.height) - 1);
    if (key.pageUp) setBack(Math.min(maximum, offset + page));
    if (key.pageDown) setBack(Math.max(0, offset - page));
  }, { isActive: active });
  return h(Box, { flexDirection: "column", flexGrow: 1, flexShrink: 1, minHeight: 0 },
    h(Box, { ref: outer, flexDirection: "column", flexGrow: 1, flexShrink: 1, minHeight: 0, overflow: "hidden" },
      h(Box, { ref: inner, flexDirection: "column", flexShrink: 0, marginTop: -Math.max(0, maximum - offset) }, children),
    ),
    showIndicator ? h(Text, { dimColor: true, wrap: "truncate-end" }, offset > 0
      ? `${label} · 距底部 ${offset} 行 · PgDn 返回最新`
      : `${label} · 最新 · PgUp 翻阅`) : null,
  );
}

export function ApprovalDetails({ approval }) {
  // 不解析/重排/截断参数；控制字节转可见转义，防止 ANSI/OSC 操纵终端。
  const text = String(approval.argumentsJson ?? "（宿主未提供参数）")
    .replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`);
  return h(Viewport, { resetKey: approval.approvalId, label: "完整参数", fromTop: true },
    h(Text, null, text),
  );
}
