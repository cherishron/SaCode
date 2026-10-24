import React, { useEffect, useReducer, useRef, useState } from "react";
import { Box, Text } from "ink";
import { useTerminalInput } from "./terminal-input.mjs";
import { edit, editorState } from "./editor.mjs";
import { displayText } from "./commands.mjs";
import { saveProviderConfiguration, validateProviderField } from "./configuration.mjs";
import { characters } from './editor.mjs';
const h = React.createElement;
const fields = [
  { key: "id", label: "供应商 ID", hint: "新建独立配置，不覆盖已有供应商" },
  { key: "baseUrl", label: "Base URL", hint: "HTTPS；不含 Key 或认证查询参数" },
  { key: "model", label: "模型 ID", hint: "手动指定，不联网拉取模型清单" },
  { key: "key", label: "API Key", hint: "输入不回显；保存在 Host 的本机凭据文件（非系统钥匙串）" },
];

export function ConfigurationDialog({ client, view, onClose, onSaved, compact = false }) {
  const [field, setField] = useState(0);
  const [buffer, dispatch] = useReducer(edit, undefined, () => editorState());
  const [values, setValues] = useState({ id: "", baseUrl: "", model: "" });
  const keyRef = useRef('');
  const submittingRef = useRef(false);
  const mountedRef = useRef(true);
  const [saving, setSaving] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [error, setError] = useState("");
  const current = fields[field];
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; keyRef.current = ''; };
  }, []);
  const clear = () => { keyRef.current = ''; dispatch({ type: "set", text: "" }); setValues({ id: "", baseUrl: "", model: "" }); };
  const changeField = (index, next = values) => {
    setField(index); setError('');
    // 密钥不重新灌进可编辑缓冲区，也不显示长度；返回后可留空保留或Ctrl+U清除。
    dispatch({ type: 'set', text: index < fields.length && fields[index].key !== 'key' ? next[fields[index].key] || '' : '' });
  };
  useTerminalInput((input, key) => {
    if (submittingRef.current) return;
    if (key.escape || (key.ctrl && input === "c")) { clear(); onClose(); return; }
    if (blocked) return;
    if (key.tab && key.shift && field > 0) {
      let next = values;
      if (current && current.key !== 'key') { next = { ...values, [current.key]: buffer.text }; setValues(next); }
      if (current?.key === 'key' && buffer.text) keyRef.current = buffer.text;
      changeField(field - 1, next); return;
    }
    if (key.ctrl && input === "u") { if (current?.key === 'key') keyRef.current = ''; dispatch({ type: "set", text: "" }); return; }
    if (key.home || key.end) { dispatch({ type: key.home ? "start" : "end" }); return; }
    if (key.backspace || key.delete) { dispatch({ type: key.backspace ? "backspace" : "delete" }); return; }
    if (key.leftArrow || key.rightArrow) { dispatch({ type: key.leftArrow ? "left" : "right" }); return; }
    if (key.return) {
      if (field < fields.length) {
        const value = current.key === 'key' ? buffer.text || keyRef.current : buffer.text;
        try { validateProviderField(current.key, value, values, view); }
        catch (failure) { setError(failure.message); return; }
        const next = current.key === 'key' ? values : { ...values, [current.key]: value };
        if (current.key === 'key') keyRef.current = value;
        setValues(next); changeField(field + 1, next);
      } else {
        submittingRef.current = true;
        setSaving(true);
        const submitted = { ...values, key: keyRef.current };
        void saveProviderConfiguration(client, submitted, view.revision).then((saved) => {
          if (!mountedRef.current) return;
          clear(); onSaved(saved);
        }).catch((failure) => {
          if (!mountedRef.current) return;
          clear(); setError(failure.message); setBlocked(true);
        }).finally(() => { submitted.key = ''; submittingRef.current = false; if (mountedRef.current) setSaving(false); });
      }
      return;
    }
    if (field < fields.length && input && !key.ctrl && !key.meta) dispatch({ type: "insert", text: input.replace(/[\r\n]/g, "") });
  });
  return h(Box, { flexDirection: "column", borderStyle: "round", borderColor: "cyan", paddingX: 1 },
    h(Text, { bold: true }, "配置 OpenAI 兼容供应商"),
    h(Text, { dimColor: true }, compact ? "本机配置 · 会改变全局默认 · 不联网" : "保存到本机用户配置，可能影响桌面默认模型；不会联网或测试 Key。"),
    h(Text, { dimColor: true, wrap: 'truncate-end' }, `现有：${displayText((view.providers || []).map((provider) => provider.id).join(', ') || '无供应商')} · 修订 ${view.revision}`),
    h(Text, { dimColor: true, wrap: 'truncate-end' }, `默认：${displayText(view.defaultProviderId || '未设置')}${view.defaultModel ? '/' + displayText(view.defaultModel) : ''}`),
    field < fields.length ? h(Box, { flexDirection: "column", marginTop: 1 },
      h(Text, { bold: true }, `${field + 1}/4 · ${current.label}`),
      h(Text, { dimColor: true }, current.hint),
      h(Text, { wrap: 'truncate-middle' }, "> ", current.key === "key" ? `[隐藏输入]${keyRef.current ? ' · 已保留（Ctrl+U清除）' : ''}`
        : displayText(characters(buffer.text).slice(0, buffer.cursor).join('')) + '▌' + displayText(characters(buffer.text).slice(buffer.cursor).join(''))),
    ) : h(Box, { flexDirection: "column" },
      h(Text, null, `供应商：${displayText(values.id)}`),
      h(Text, null, `地址：${displayText(values.baseUrl)}`),
      h(Text, null, `模型：${displayText(values.model)}`),
      h(Text, null, `凭据：${keyRef.current ? "将保存新凭据（不回显）" : "未输入（仅限无需认证的本机服务）"}`),
      h(Text, { bold: true }, blocked ? "保存未确认，已停止提交；Esc 退出核对" : "Enter 确认保存并设为默认；Esc 放弃"),
    ),
    error ? h(Text, { color: "red" }, error) : null,
    h(Text, { dimColor: true, wrap: 'wrap' }, saving ? "保存中，请等待宿主确认…" : blocked ? '此表单已停止提交；Esc 退出后重新读取配置'
      : "Enter 下一步/确认 · Shift+Tab 返回修改 · Ctrl+U 清空 · Esc 放弃"),
  );
}
