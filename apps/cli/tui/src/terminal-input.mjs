// Ink5 useInput 未暴露 Home/End，且 DEL(127)归为delete；在固定版本适配
// 已分发的原始按键，不读stdin、不消费其他监听器、不解析粘贴里的转义。
import { useLayoutEffect, useRef } from "react";
import { useInput, useStdin } from "ink";

export function normalizeInput(input, key, raw) {
  if (/^\x1b(?:\[H|OH|\[(?:1|7)~)$/.test(raw)) return { input: "", key: { ...key, home: true } };
  if (/^\x1b(?:\[F|OF|\[(?:4|8)~)$/.test(raw)) return { input: "", key: { ...key, end: true } };
  if (raw === "\x7f") return { input: "", key: { ...key, backspace: true, delete: false } };
  return { input, key };
}

export function useTerminalInput(handler, options = {}) {
  const { internal_eventEmitter: emitter } = useStdin();
  const raw = useRef("");
  useLayoutEffect(() => {
    // 仅为此固定Ink版本做兼容；原始捕获先于useInput解码。拆分控制序列尚不重组。
    if (!emitter?.prependListener) throw new Error("ink-input-adapter-unavailable");
    const capture = (chunk) => { raw.current = String(chunk); };
    emitter.prependListener("input", capture);
    return () => emitter.off("input", capture);
  }, [emitter]);
  useInput((input, key) => {
    const normalized = normalizeInput(input, key, raw.current);
    handler(normalized.input, normalized.key);
  }, options);
}
