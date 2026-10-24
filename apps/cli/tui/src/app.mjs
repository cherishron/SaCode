// TUI 主体：只负责把宿主给出的会话投影、流式帧和审批工单画到终端。
// 审批、取消、结算全部走宿主协议，界面没有自己的“同意”状态。
import React, { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { Box, Text, useApp, useStdout } from "ink";
import {
  ApprovalBox,
  Composer,
  ErrorScreen,
  HELP_LINES,
  StatusBar,
  ToolCard,
  h,
} from "./components.mjs";
import { terminalLayout, THEME } from "./theme.mjs";
import { characters, edit, editorState } from "./editor.mjs";
import { ApprovalDetails, Viewport } from "./viewport.mjs";
import { COMMANDS, commandMatches, parseCommand, displayText } from "./commands.mjs";
import { CommandSuggestions, SelectionDialog } from "./dialogs.mjs";
import { modelOptions, readSession, selectSession, toolsWithResults } from "./actions.mjs";
import { MainContent } from "./main-content.mjs";
import { ConfigurationDialog } from "./configuration-dialog.mjs";
import { configurationStatus } from "./configuration.mjs";
import { historyMatches } from "./history-search.mjs";
import { useTerminalInput } from "./terminal-input.mjs";
import { changedFiles, fileOptions, insertReference, readWorkspaceDiff, referenceToken } from "./workspace-views.mjs";
import { CodeBlock } from "./content.mjs";
import { Markdown } from "./markdown.mjs";
import { mcpDetail, mcpOptions, modeDetail, skillDetail, skillOptions } from "./capability-views.mjs";
import { browserItems, metadataConfirmation, mutateSessionMetadata, sessionEntries, validateSessionTitle } from './session-browser.mjs';
import { SessionConfirmation } from './session-confirmation.mjs';
import { ActionConfirmation } from './action-confirmation.mjs';
import { compactDescribe, compactDetailLines, compactRun, sessionClear } from './session-actions.mjs';
import { checkReferenceIdentity, readReferenceMessage, referenceMessageView, referencePaths } from './file-references.mjs';
import { ReferenceConfirmation } from './reference-confirmation.mjs';

const POLL_INTERVAL_MS = 80;

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function projectionToMessages(projection) {
  const rows = Array.isArray(projection?.messageRows) ? projection.messageRows : [];
  return rows
    .filter((row) => row.eventType === "user/message" || row.eventType === "assistant/message")
    .map((row) => ({
      key: String(row.id || `${row.eventType}-${Math.random()}`),
      role: row.eventType === "user/message" ? "user" : "assistant",
      ...(row.eventType === 'user/message' ? referenceMessageView(String(row.text ?? '')) : { text: String(row.text ?? '') }),
    }))
    .filter((row) => row.text.trim().length > 0);
}

function humanError(error) {
  const raw = String(error?.message || error || "未知错误");
  if (raw.includes("model-not-configured")) {
    return "还没有配置模型供应商：先在桌面端配置，或设置 SACODE_PROVIDER_BASE_URL / SACODE_PROVIDER_MODEL / SACODE_PROVIDER_KEY 后重试。";
  }
  if (raw.includes("model-credential-unavailable")) return "模型凭据不可用：请检查供应商密钥配置。";
  if (raw.includes("protocol-not-supported")) return "当前供应商协议暂不支持（只支持 openai-completions）。";
  if (raw.includes("already-owned")) return "当前会话正被另一个进程写入（会话日志租约被占用）。关闭另一个 SaCode 后再试。";
  if (raw.includes("turn-in-flight")) return "上一轮还在进行中。";
  if (raw.includes("over-budget")) return "本轮预算已用完，请调整预算后再试。";
  if (raw.startsWith("timeout:")) return `宿主响应超时（${raw.slice("timeout:".length)}）。`;
  if (raw.includes("host-gone") || raw.includes("host-spawn-error")) {
    return `${raw}。宿主可能已退出；请确认 apps/desktop/dist/host/bin 下的 DLL 与 exe 齐全。`;
  }
  return raw;
}

export function App({ client, hostPath, version = "dev", mode = "transcript" }) {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const [size, setSize] = useState({ columns: stdout.columns || 80, rows: stdout.rows || 24 });
  const [phase, setPhase] = useState("connecting");
  const [bootError, setBootError] = useState(null);
  const [sessionTitle, setSessionTitle] = useState("");
  const [cwd, setCwd] = useState(process.cwd());
  const [messages, setMessages] = useState([]);
  const [tools, setTools] = useState([]);
  const [streamText, setStreamText] = useState("");
  const [busy, setBusy] = useState(false);
  const [approval, setApproval] = useState(null);
  const [usage, setUsage] = useState(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState(null);
  const [editor, dispatchEdit] = useReducer(edit, undefined, () => editorState());
  const value = editor.text;
  const setValue = (text) => dispatchEdit({ type: "set", text });
  const [history, setHistory] = useState([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const draftRef = useRef("");
  const [approvalDetails, setApprovalDetails] = useState(false);
  const [approvalSelection, setApprovalSelection] = useState(1);
  const [answering, setAnswering] = useState(false);
  const answeringRef = useRef(false);
  const approvalUnknownRef = useRef(false);
  const [screen, setScreen] = useState(mode === "screen");
  const [configView, setConfigView] = useState(null);
  const [selectedModel, setSelectedModel] = useState({ id: "", label: "宿主默认路由" });
  const [dialog, setDialog] = useState(null);
  const [sessionConfirmation, setSessionConfirmation] = useState(null);
  const [actionConfirmation, setActionConfirmation] = useState(null);
  const [actionBusy, setActionBusy] = useState(false);
  const actionBusyRef = useRef(false);
  const [metadataBusy, setMetadataBusy] = useState(false);
  const metadataBusyRef = useRef(false);
  const [referenceView, setReferenceView] = useState(null);
  const referenceBusyRef = useRef(false);
  const referenceCancelRef = useRef(false);
  const [detail, setDetail] = useState(null);
  const [toolExpanded, setToolExpanded] = useState(false);
  const [search, setSearch] = useState(null);
  const [files, setFiles] = useState(null);
  const [suppressedFiles, setSuppressedFiles] = useState(null);
  const [commandIndex, setCommandIndex] = useState(0);
  const [suppressedCommand, setSuppressedCommand] = useState(null);
  const commandBusyRef = useRef(false);
  const dialogEpochRef = useRef(0);
  const matches = suppressedCommand === value ? [] : commandMatches(value);

  useEffect(() => { setCommandIndex(0); }, [value]);

  const sessionIdRef = useRef("");
  const runningRef = useRef(false);
  const approvalRef = useRef(null);
  const noticeTimerRef = useRef(null);
  const capabilitiesRef = useRef(new Set());

  useEffect(() => {
    let alive = true;
    const token = referenceToken(value, editor.cursor);
    if (phase !== "ready" || !token || value === suppressedFiles || approval || dialog || sessionConfirmation || actionConfirmation || referenceView || detail || configView || search || busy) {
      setFiles(null); return undefined;
    }
    setFiles({ token, items: [], selected: 0, loading: true });
    const timer = setTimeout(() => {
      void fileOptions(client, token.directory, token.prefix, cwd).then((reply) => {
        if (alive) setFiles({ ...reply, token, selected: 0, loading: false });
      }).catch((failure) => {
        if (alive) setFiles({ token, items: [], selected: 0, loading: false, error: humanError(failure) });
      });
    }, 100);
    return () => { alive = false; clearTimeout(timer); };
  }, [client, phase, value, editor.cursor, cwd, suppressedFiles, approval, dialog, sessionConfirmation, actionConfirmation, referenceView, detail, configView, search, busy]);

  useEffect(() => {
    const onResize = () => setSize({ columns: stdout.columns || 80, rows: stdout.rows || 24 });
    // ink-testing-library 的假 stdout 没有事件接口；真实终端才有。
    if (typeof stdout?.on === "function") stdout.on("resize", onResize);
    return () => {
      if (typeof stdout?.off === "function") stdout.off("resize", onResize);
    };
  }, [stdout]);

  useEffect(() => {
    if (!notice) return undefined;
    if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
    noticeTimerRef.current = setTimeout(() => setNotice(""), 4000);
    return () => {
      if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
    };
  }, [notice]);

  const refreshProjection = useCallback(async () => {
    const projection = await client.request("session/projection", {}, 15000);
    if (projection?.sessionId && sessionIdRef.current && projection.sessionId !== sessionIdRef.current) return;
    if (projection?.sessionId) sessionIdRef.current = projection.sessionId;
    setMessages(projectionToMessages(projection));
    setTools(toolsWithResults(projection));
  }, [client]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const initialized = await client.request("initialize", {}, 15000);
        capabilitiesRef.current = new Set(Array.isArray(initialized?.capabilities) ? initialized.capabilities : []);
        const [catalog, workspace, usageStatus] = await Promise.all([
          client.request("session/catalog", {}, 15000),
          client.request("workspace/get", {}, 15000),
          client.request("usage/status", {}, 15000),
        ]);
        if (!alive) return;
        const entries = Array.isArray(catalog?.entries) ? catalog.entries : [];
        const current = entries.find((entry) => entry.current) || null;
        sessionIdRef.current = current?.id || "";
        setSessionTitle(current?.title || "当前会话");
        setCwd(workspace?.directory || catalog?.root || process.cwd());
        setUsage(usageStatus);
        const projection = await client.request("session/projection", {}, 15000);
        if (!alive) return;
        if (projection?.sessionId) sessionIdRef.current = projection.sessionId;
        setMessages(projectionToMessages(projection));
        setTools(toolsWithResults(projection));
        // 老 Host 缺只读配置面时仍允许会话浏览，但不把未知配置标为已就绪。
        try {
          const status = await configurationStatus(client);
          if (!alive) return;
          setSelectedModel({ id: "", label: status.label });
          if (!status.configured) {
            const view = await client.request("model/registry/describe", {}, 15000);
            if (alive && view.writable) setConfigView(view);
          }
        } catch { if (alive) setNotice("配置状态未确认；可用 /auth 检查"); }
        setPhase("ready");
      } catch (failure) {
        if (!alive) return;
        setBootError(humanError(failure));
        setPhase("error");
      }
    })();
    return () => {
      alive = false;
    };
  }, [client]);

  // 宿主推送的审批工单：只接当前会话的，其他会话的工单不在这里代答。
  useEffect(() => client.onNotification((message) => {
    if (message?.method !== "approval/asked" || !message.params) return;
    const params = message.params;
    if (params.sessionId && sessionIdRef.current && params.sessionId !== sessionIdRef.current) return;
    if (approvalRef.current) return;
    approvalRef.current = params;
    approvalUnknownRef.current = false;
    setApprovalDetails(false);
    setApprovalSelection(1);
    setApproval(params);
    setNotice(`工具 ${params.tool || "tool"} 请求审批`);
  }), [client]);

  const quit = useCallback(() => {
    if (runningRef.current || commandBusyRef.current || approvalRef.current) {
      setNotice("请先取消任务并等待宿主结算，再退出");
      return;
    }
    setPhase("exiting");
    exit();
  }, [exit]);

  const answerApproval = useCallback(async (decision) => {
    const pending = approvalRef.current;
    if (!pending || answeringRef.current || approvalUnknownRef.current) return;
    answeringRef.current = true;
    setAnswering(true);
    try {
      const result = await client.request("approval/answer", { approvalId: pending.approvalId, decision }, 10000);
      approvalRef.current = null;
      setApproval(null);
      setApprovalDetails(false);
      if (!result?.accepted) setNotice(`审批已失效（${result?.state || "unknown"}）`);
      else setNotice(decision === "allowed-once" ? "已允许一次" : "已拒绝");
    } catch (failure) {
      // 结果未知不允许再次放行同票，也不将输入焦点还给普通草稿。
      setError(`审批答复未确认，请取消本轮或退出重开核对：${humanError(failure)}`);
      approvalUnknownRef.current = true;
    } finally { answeringRef.current = false; setAnswering(false); }
  }, [client]);

  const cancelTurn = useCallback(async () => {
    if (!runningRef.current) return;
    setNotice("正在取消…");
    if (approvalRef.current) await answerApproval("denied");
    try {
      await client.request("turn/cancel", {}, 10000);
    } catch (failure) {
      setError(humanError(failure));
    }
  }, [answerApproval, client]);

  const publishSession = useCallback((snapshot) => {
    const changed = sessionIdRef.current !== snapshot.sessionId;
    sessionIdRef.current = snapshot.sessionId;
    setSessionTitle(snapshot.title);
    setCwd(snapshot.directory);
    setUsage(snapshot.usage);
    setMessages(projectionToMessages(snapshot.projection));
    setTools(toolsWithResults(snapshot.projection));
    setStreamText("");
    setDetail(null);
    setError(null);
    setSearch(null);
    setFiles(null);
    setSuppressedFiles(null);
    setToolExpanded(false);
    if (changed) {
      setValue("");
      setHistory([]);
      setHistoryIndex(-1);
      draftRef.current = "";
    }
  }, []);

  const runCommand = useCallback(async (text) => {
    const { name, argument } = parseCommand(text);
    if (name === "/help" || name === "/?") {
      setDetail({ title: "帮助", text: HELP_LINES.join("\n") });
      return;
    }
    if (name === "/quit" || name === "/exit") {
      quit();
      return;
    }
    if (name === "/about") {
      setDetail({ title: "SaCode CLI", text: `版本：${version}\n宿主：${hostPath}\n目录：${cwd}\n会话：${sessionIdRef.current}\n本进程模型选择：${selectedModel.label}` });
      return;
    }
    if (name === "/screen") {
      setScreen((current) => !current);
      setNotice("已切换终端显示模式；只改变展示，不改变会话");
      return;
    }
    if (!COMMANDS.some((command) => command.name === name)) {
      setNotice(`未知命令 ${name}；输入 / 查看可用命令`);
      return;
    }
    if (runningRef.current || commandBusyRef.current || approvalRef.current) {
      setNotice("任务或命令仍在进行，请等待结算后再操作");
      return;
    }
    commandBusyRef.current = true;
    const epoch = ++dialogEpochRef.current;
    let mutationStarted = false;
    setError(null);
    try {
      if (name === '/rename') {
        const title = validateSessionTitle(argument);
        if (!capabilitiesRef.current.has('session/rename')) throw new Error('宿主未声明session/rename，不能修改');
        const entries = await sessionEntries(client, sessionIdRef.current);
        const current = entries.find((entry) => entry.id === sessionIdRef.current && entry.current);
        setSessionConfirmation({ ...metadataConfirmation(current, 'rename', title), selected: 1 });
      } else if (name === '/archive' || name === '/resume') {
        if (name === '/archive' && argument) throw new Error('/archive 不接受直接执行参数，请从列表选择并确认');
        const action = name === '/archive' ? 'archive' : 'resume';
        if (action === 'archive' && !capabilitiesRef.current.has('session/archive')) throw new Error('宿主未声明session/archive，不能归档');
        setDialog({ kind: name, title: action === 'archive' ? '归档会话（不会删除记录）' : '恢复会话', items: [], selected: 0, loading: true });
        const entries = await sessionEntries(client);
        if (epoch === dialogEpochRef.current) setDialog({ kind: name, title: action === 'archive' ? '归档/恢复归档（非当前会话）' : '恢复会话',
          entries, filter: argument || '', showArchived: false, searchable: true, items: browserItems(entries, argument, false, action),
          selected: 0, loading: false, emptyText: '无匹配会话；可清空搜索或切换归档视图' });
      } else if (name === '/compact') {
        if (!capabilitiesRef.current.has('compact/run') || !capabilitiesRef.current.has('compact/describe')) throw new Error('宿主未声明compact能力');
        setActionConfirmation({ title: '压缩会话历史', warning: '压缩是有损操作：摘录替代原文，不可逆', detail: [], selected: 1, status: 'loading', confirmLabel: '确认压缩' });
        const describe = await compactDescribe(client, capabilitiesRef.current, sessionIdRef.current);
        setActionConfirmation((current) => current ? { ...current, detail: compactDetailLines(describe), status: 'confirm', canExecute: describe.state !== 'not-applicable' } : null);
      } else if (name === '/clear') {
        setActionConfirmation({ title: '清空对话历史', warning: '只清user/assistant消息和工具调用，保留会话标题/目录/权限/主题', detail: [], selected: 1, status: 'loading', confirmLabel: '确认清空' });
        const projection = await client.request('session/projection', {}, 15000);
        const messages = (projection.messageRows || []).filter((row) => row.eventType === 'user/message' || row.eventType === 'assistant/message').length;
        const tools = (projection.toolCalls || []).length;
        setActionConfirmation((current) => current ? { ...current, detail: [
          `会话：${sessionIdRef.current}`, `将清空：${messages}条消息 · ${tools}个工具调用`,
          `将保留：标题、工作目录、权限档位、计划模式、主题`, `事件总数：${projection.events ?? '未知'} · 持久：${projection.durable ?? '未知'}`,
        ], status: 'confirm' } : null);
      } else if (["/skills", "/mcp", "/permissions", "/plan"].includes(name)) {
        if (argument) throw new Error('本入口仅浏览状态，不支持执行、安装、连接或模式切换参数');
        if (name === '/skills' || name === '/mcp') {
          const sessionId = sessionIdRef.current;
          const title = name === '/skills' ? '技能目录（只读）' : 'MCP注册目录（不探测）';
          setDialog({ kind: name, title, items: [], selected: 0, loading: true, sessionId });
          const items = name === '/skills' ? await skillOptions(client, capabilitiesRef.current)
            : await mcpOptions(client, capabilitiesRef.current, sessionId);
          if (epoch === dialogEpochRef.current) setDialog({ kind: name, title, items, selected: 0, loading: false, sessionId,
            emptyText: name === '/skills' ? '当前工作区未发现可浏览技能；请检查目录与SKILL.md格式，旧Host需更新' : '没有已注册的MCP服务；不会自动连接或扫描配置' });
        } else {
          const result = await modeDetail(client, capabilitiesRef.current, name === '/plan' ? 'plan' : 'permissions');
          if (epoch === dialogEpochRef.current) setDetail(result);
        }
      } else if (name === "/auth") {
        const view = await client.request("model/registry/describe", {}, 15000);
        if (!view.writable) throw new Error("用户配置为只读，不能从终端保存");
        setConfigView(view);
      } else if (name === "/diff") {
        const identity = { sessionId: sessionIdRef.current, directory: cwd };
        setDialog({ kind: "/diff", title: "读取真实 Git 状态（只读）", items: [], selected: 0, loading: true, identity });
        const result = await changedFiles(client, identity);
        if (epoch === dialogEpochRef.current) setDialog({ kind: "/diff", title: `Git 差异 · ${result.branch || "无分支信息"}${result.truncated ? " · 状态已截断" : ""}`,
          items: result.items, selected: 0, loading: false, identity,
          emptyText: result.truncated ? "状态截断，不能判断仓库是否干净" : "当前状态没有变更（不代表任务已验收）" });
      } else if (name === "/model" || name === "/tools") {
        const title = name === "/model" ? "选择模型 · 仅本进程，下次任务生效" : "工具调用与结果";
        setDialog({ kind: name, title, items: [], selected: 0, loading: true });
        let items;
        if (name === "/model") items = await modelOptions(client);
        else {
          const projection = await client.request("session/projection", {}, 15000);
          items = toolsWithResults(projection).map((call) => ({ id: call.id,
            label: `${call.name} · ${call.status} · ${call.callId}`, call }));
        }
        if (epoch === dialogEpochRef.current) setDialog({ kind: name, title, items, selected: 0, loading: false });
      } else if (name === "/new") {
        mutationStarted = true;
        const created = await client.request("session/create", { title: argument || "新会话" }, 15000);
        if (!created?.saved || !created.id) throw new Error("session-create-unconfirmed");
        setNotice(`已新建 ${created.id}，正在切换`);
        publishSession(await selectSession(client, created.id));
        setNotice("已切换到新会话");
      } else if (name === "/directory") {
        if (argument) {
          // 不直接 process.chdir，工具根必须经 Host 校验和持久化。
          mutationStarted = true;
          const result = await client.request("workspace/set-directory", { sessionId: sessionIdRef.current, directory: argument }, 15000);
          if (result?.saved !== true) throw new Error("workspace-change-unconfirmed");
        }
        const snapshot = await readSession(client);
        publishSession(snapshot);
        setDetail({ title: "工作目录", text: snapshot.directory });
      } else if (name === "/stats") {
        const usage = await client.request("usage/status", {}, 15000);
        setUsage(usage);
        setDetail({ title: "宿主用量", text: JSON.stringify(usage, null, 2) });
      }
    } catch (failure) {
      setError(humanError(failure));
      if (mutationStarted) {
        // 写操作超时/回读失败不代表未生效，不能继续把新宿主状态画成旧会话。
        setBootError(`会话或目录修改未确认：${humanError(failure)}。请退出重开核对，不会自动重试。`);
        setPhase("error");
      }
      if (epoch === dialogEpochRef.current) setDialog((current) => current ? { ...current, loading: false, error: humanError(failure) } : null);
    } finally { commandBusyRef.current = false; }
  }, [quit, client, publishSession, version, hostPath, cwd, selectedModel]);

  const chooseDialog = async () => {
    if (!dialog || dialog.loading || dialog.error || commandBusyRef.current || runningRef.current || approvalRef.current) return;
    const item = dialog.items[dialog.selected];
    if (!item) return;
    if ((dialog.kind === '/resume' && item.entry?.archived) || dialog.kind === '/archive') {
      try {
        if (!capabilitiesRef.current.has('session/archive')) throw new Error('宿主未声明session/archive，不能恢复归档');
        setSessionConfirmation({ ...metadataConfirmation(item.entry, item.entry.archived ? 'restore' : 'archive'), selected: 1 });
        setDialog(null);
      } catch (failure) { setError(humanError(failure)); }
      return;
    }
    if (dialog.kind === '/skills' || dialog.kind === '/mcp') {
      const kind = dialog.kind;
      const sessionId = dialog.sessionId;
      if (sessionId !== sessionIdRef.current) { setDialog(null); setError('会话已变化，请重新打开目录'); return; }
      const epoch = ++dialogEpochRef.current;
      commandBusyRef.current = true;
      setDialog((current) => ({ ...current, loading: true }));
      try {
        const result = kind === '/skills' ? await skillDetail(client, capabilitiesRef.current, item.id)
          : await mcpDetail(client, capabilitiesRef.current, sessionId, item.id);
        if (epoch === dialogEpochRef.current && sessionId === sessionIdRef.current) { setDetail(result); setDialog(null); }
      } catch (failure) {
        if (epoch === dialogEpochRef.current) setDialog((current) => current ? { ...current, loading: false, error: humanError(failure) } : null);
      } finally { commandBusyRef.current = false; }
      return;
    }
    if (dialog.kind === "/model") {
      setSelectedModel(item);
      setNotice(`已选择 ${item.label}；仅下一次任务起生效`);
      setDialog(null);
      return;
    }
    if (dialog.kind === "/tools") {
      const call = item.call;
      setToolExpanded(false);
      setDetail({ title: `工具 ${call.name} · ${call.status}`, text:
        `调用：${call.callId}\n参数：\n${call.arguments}`, call });
      setDialog(null);
      return;
    }
    if (dialog.kind === "/diff") {
      if (item.scope === "untracked") {
        setDetail({ title: `未跟踪 · ${item.path}`, text: "Git 未跟踪文件没有索引基线，不能把空 patch 当成没有内容变更。可用 @ 路径引用并让模型按授权读取。" });
        setDialog(null); return;
      }
      const identity = dialog.identity;
      commandBusyRef.current = true;
      setDialog((current) => ({ ...current, loading: true }));
      try {
        const result = await readWorkspaceDiff(client, identity, item.path, item.scope);
        setDetail({ title: `${item.scope === "index" ? "暂存" : "未暂存"} · ${item.path}`, text: result.truncated
          ? "宿主差异输出已截断；以下不是完整 patch。" : "只读 Git 查询（含全部当前变更，不归因给 AI）",
          diff: result.text, diffEmpty: result.text.length === 0 });
        setDialog(null);
      } catch (failure) {
        setDialog((current) => current ? { ...current, loading: false, error: humanError(failure) } : null);
      } finally { commandBusyRef.current = false; }
      return;
    }
    commandBusyRef.current = true;
    setDialog((current) => ({ ...current, loading: true }));
    try {
      publishSession(await selectSession(client, item.id));
      setDialog(null);
      setNotice("已恢复会话");
    } catch (failure) {
      setDialog(null);
      setBootError(`会话切换未确认：${humanError(failure)}。请退出重开核对，不会自动重试。`);
      setPhase("error");
    } finally { commandBusyRef.current = false; }
  };

  const confirmMetadata = async () => {
    if (!sessionConfirmation || metadataBusyRef.current || runningRef.current || approvalRef.current) return;
    if (sessionConfirmation.selected !== 0) { setSessionConfirmation(null); return; }
    metadataBusyRef.current = true;
    commandBusyRef.current = true;
    setMetadataBusy(true);
    try {
      const checked = await mutateSessionMetadata(client, sessionConfirmation);
      if (checked.id === sessionIdRef.current) setSessionTitle(checked.title);
      setSessionConfirmation(null);
      setNotice(sessionConfirmation.action === 'rename' ? '会话已重命名，回读确认通过'
        : sessionConfirmation.action === 'archive' ? '已归档，记录未删除' : '已恢复归档；请用/resume选择会话');
    } catch (failure) {
      setSessionConfirmation((current) => current ? { ...current, blocked: true, error: humanError(failure) } : null);
      if (failure.outcomeUnknown) {
        setBootError(humanError(failure));
        setPhase('error');
      }
    } finally { metadataBusyRef.current = false; commandBusyRef.current = false; setMetadataBusy(false); }
  };

  const confirmAction = async () => {
    if (!actionConfirmation || actionBusyRef.current || runningRef.current || approvalRef.current) return;
    if (actionConfirmation.selected !== 0 || actionConfirmation.status !== 'confirm') { setActionConfirmation(null); return; }
    if (actionConfirmation.error) return;
    actionBusyRef.current = true;
    commandBusyRef.current = true;
    setActionBusy(true);
    setActionConfirmation((current) => current ? { ...current, status: 'executing', progress: '正在执行…' } : null);
    const sessionId = sessionIdRef.current;
    try {
      if (actionConfirmation.title === '压缩会话历史') {
        if (!actionConfirmation.canExecute) throw new Error('当前状态不可压缩');
        const result = await compactRun(client, capabilitiesRef.current, sessionId);
        await refreshProjection();
        setActionConfirmation(null);
        setNotice(result.status === 'applied' ? `已压缩，节省${result.savedInputBound ?? '?'}字节` : `压缩状态：${result.status}（${result.reason || ''}）`);
      } else if (actionConfirmation.title === '清空对话历史') {
        await sessionClear(client, sessionId);
        await refreshProjection();
        setActionConfirmation(null);
        setNotice('已清空对话历史');
      }
    } catch (failure) {
      setActionConfirmation((current) => current ? { ...current, status: 'failed', error: humanError(failure) } : null);
      if (/timeout:|host-/.test(String(failure?.message))) {
        setBootError(humanError(failure)); setPhase('error');
      }
    } finally { actionBusyRef.current = false; commandBusyRef.current = false; setActionBusy(false); }
  };

  const handleSubmit = useCallback(async (raw, resolvedReference) => {
    const text = raw.trim();
    if (!text) return;
    if (text.startsWith("/")) {
      await runCommand(text);
      return;
    }
    if (runningRef.current || commandBusyRef.current) {
      setNotice("上一轮仍在进行：按 Ctrl+C 取消后再发送");
      return;
    }
    if (!resolvedReference) {
      try {
        const paths = referencePaths(text);
        if (paths.length) {
          setValue(raw);
          setReferenceView({ text, paths, identity: { sessionId: sessionIdRef.current, directory: cwd }, modelLabel: selectedModel.label, selected: 1 });
          return;
        }
      } catch (failure) { setValue(raw); setError(humanError(failure)); return; }
    }
    runningRef.current = true;
    setBusy(true);
    setError(null);
    setNotice("");
    setStreamText("");
    setMessages((previous) => [...previous, { key: `local-${Date.now()}`, role: "user", text,
      ...(resolvedReference ? { references: resolvedReference.files.map(({ path, bytes }) => ({ path, bytes })) } : {}) }]);
    setHistory((previous) => [...previous, text]);
    setHistoryIndex(-1);

    const collected = [];
    try {
      // 与桌面同一口径：用户消息是 user/message 事件；起轮走产品 task/start
      // （补系统提示、知识库上下文并只认真实模型配置），不走诊断 turn/start。
      if (resolvedReference) {
        await checkReferenceIdentity(client, resolvedReference.identity);
        const saved = await client.request('session/append', { sessionId: resolvedReference.identity.sessionId, eventType: 'user/message', data: resolvedReference.message }, 15000);
        if (!Number.isSafeInteger(saved?.events) || saved.events !== saved.durable) throw new Error('引用消息持久化未确认');
      } else await client.request("session/append", { eventType: "user/message", data: text }, 15000);
      const started = await client.request("task/start", selectedModel.id ? { customModelId: selectedModel.id } : {}, 30000);
      if (started?.started !== true) throw new Error(`turn-not-started: ${JSON.stringify(started)}`);
      await refreshProjection();

      let cursor = 0;
      let turnId = null;
      let final = null;
      for (;;) {
        const params = { cursor };
        if (turnId !== null) params.turnId = turnId;
        const poll = await client.request("turn/poll", params, 30000);
        if (poll?.reset === true) {
          cursor = Number.isSafeInteger(poll.nextCursor) && poll.nextCursor >= 0 ? poll.nextCursor : 0;
          turnId = Number.isInteger(poll.turnId) && poll.turnId > 0 ? poll.turnId : null;
        } else {
          if (Number.isSafeInteger(poll?.nextCursor) && poll.nextCursor >= 0) cursor = poll.nextCursor;
          if (Number.isInteger(poll?.turnId) && poll.turnId > 0) turnId = poll.turnId;
        }
        let wantsProjection = false;
        for (const frame of Array.isArray(poll?.frames) ? poll.frames : []) {
          if (typeof frame !== "string") continue;
          if (frame.startsWith("text:")) {
            collected.push(frame.slice("text:".length));
            setStreamText(collected.join(""));
          } else if (frame.startsWith("projection:")) {
            wantsProjection = true;
          }
        }
        if (wantsProjection) void refreshProjection().catch(() => {});
        if (poll?.settled) {
          final = poll;
          break;
        }
        await delay(POLL_INTERVAL_MS);
      }

      setStreamText("");
      if (final) {
        approvalRef.current = null;
        setApproval(null);
        setApprovalDetails(false);
        setUsage({ used: final.used, budget: final.budget, over: final.over });
        if (final.cancelled) setNotice("已取消本轮");
        else if (final.interrupted) setNotice(`本轮中断：${final.finishReason || "未知原因"}`);
      }
      try {
        await refreshProjection();
      } catch (failure) {
        // 投影刷新失败时至少保住这一轮正文，不让它凭空消失。
        const textOut = String(final?.text || collected.join("")).trim();
        if (textOut) {
          setMessages((previous) => [
            ...previous.filter((row) => !String(row.key).startsWith("local-")),
            { key: `fallback-${Date.now()}`, role: "assistant", text: textOut },
          ]);
        }
        setError(humanError(failure));
      }
    } catch (failure) {
      setError(humanError(failure));
      if (resolvedReference) {
        setBootError('引用消息或模型起轮未确认；请退出重开核对，不自动重试');
        setPhase('error');
      }
    } finally {
      runningRef.current = false;
      setBusy(false);
      setStreamText("");
    }
  }, [client, refreshProjection, runCommand, selectedModel, cwd]);

  const confirmReferences = async () => {
    if (!referenceView || referenceBusyRef.current || runningRef.current || approvalRef.current) return;
    if (referenceView.selected !== 0) { setReferenceView(null); return; }
    if (referenceView.error) return;
    referenceBusyRef.current = true;
    referenceCancelRef.current = false;
    commandBusyRef.current = true;
    const snapshot = referenceView;
    setReferenceView((current) => ({ ...current, status: 'reading' }));
    try {
      const resolved = await readReferenceMessage(client, snapshot, {
        cancelled: () => referenceCancelRef.current,
        onProgress: (progress) => setReferenceView((current) => ({ ...current, progress })),
      });
      if (referenceCancelRef.current || approvalRef.current || sessionIdRef.current !== snapshot.identity.sessionId) throw new Error('引用读取已取消或会话变化，消息未发送');
      setReferenceView(null); setValue('');
      commandBusyRef.current = false;
      // 保持同步保护到handleSubmit设置runningRef，重复Enter不会形成第二次提交。
      await handleSubmit(snapshot.text, resolved);
    } catch (failure) {
      if (failure.outcomeUnknown) { setBootError(humanError(failure)); setPhase('error'); }
      else {
        setReferenceView((current) => current ? { ...current, status: 'failed', error: humanError(failure) } : null);
        // 失败也可能有已结算的工具记录：如截断/取消，不能一直画成“没有读取过”。
        await refreshProjection().catch(() => {});
      }
    } finally { referenceBusyRef.current = false; commandBusyRef.current = false; }
  };

  useTerminalInput((input, key) => {
    if (phase === "error" || phase === "connecting") {
      if (key.ctrl && input === "c") quit();
      return;
    }
    if (phase !== "ready") return;
    if (configView && !approvalRef.current) return; // 配置表单自己的输入监听器持有唯一焦点。
    if (approvalRef.current) {
      // 审批待答时也要能取消整轮：先拒票，再让宿主取消。不能让审批框把 Ctrl+C 吞掉。
      if (key.ctrl && input === "c") {
        if (runningRef.current) void cancelTurn();
        else void answerApproval("denied");
        return;
      }
      if (answeringRef.current) return;
      if (key.upArrow || key.downArrow) { setApprovalSelection((current) => 1 - current); return; }
      if (key.return) { void answerApproval(approvalSelection === 0 ? "allowed-once" : "denied"); return; }
      if (input === "y" || input === "Y") {
        void answerApproval("allowed-once");
        return;
      }
      if (input === "d" || input === "D") {
        setApprovalDetails((shown) => !shown);
        return;
      }
      if (input === "n" || input === "N" || key.escape) {
        void answerApproval("denied");
        return;
      }
      // 审批期间不允许把字符输进输入框，避免“以为在写消息，实际在答审批”。
      return;
    }
    if (referenceView) {
      if (referenceBusyRef.current) {
        if (key.escape || (key.ctrl && input === 'c')) {
          referenceCancelRef.current = true;
          setReferenceView((current) => ({ ...current, progress: '取消已请求，等待当前读取结算；不会发送' }));
        }
        return;
      }
      if (key.escape || (key.ctrl && input === 'c')) { setReferenceView(null); return; }
      if (referenceView.error) return;
      if (key.upArrow || key.downArrow) setReferenceView((current) => ({ ...current, selected: 1 - current.selected }));
      if (key.return) void confirmReferences();
      return;
    }
    if (actionConfirmation) {
      if (actionBusyRef.current) {
        if (key.escape || (key.ctrl && input === 'c')) setActionConfirmation((current) => current ? { ...current, progress: '取消已请求，等待当前操作结算' } : null);
        return;
      }
      if (key.escape || (key.ctrl && input === 'c')) { setActionConfirmation(null); return; }
      if (actionConfirmation.error) return;
      if (key.upArrow || key.downArrow) setActionConfirmation((current) => ({ ...current, selected: 1 - current.selected }));
      if (key.return) void confirmAction();
      return;
    }
    if (sessionConfirmation) {
      if (metadataBusyRef.current) return;
      if (key.escape || (key.ctrl && input === 'c')) { setSessionConfirmation(null); return; }
      if (sessionConfirmation.blocked) return;
      if (key.upArrow || key.downArrow) setSessionConfirmation((current) => ({ ...current, selected: 1 - current.selected }));
      if (key.return) void confirmMetadata();
      return;
    }
    if (dialog) {
      const readOnlyView = ['/skills', '/mcp', '/resume', '/archive'].includes(dialog.kind);
      if ((key.escape || (key.ctrl && input === 'c')) && (!commandBusyRef.current || readOnlyView)) {
        ++dialogEpochRef.current; setDialog(null); return;
      }
      if (key.upArrow || key.downArrow) {
        setDialog((current) => ({ ...current, selected: Math.max(0, Math.min(current.items.length - 1, current.selected + (key.upArrow ? -1 : 1))) }));
      }
      if (dialog.searchable && !dialog.loading && !dialog.error) {
        const action = dialog.kind === '/archive' ? 'archive' : 'resume';
        let query = dialog.filter;
        let archived = dialog.showArchived;
        if (key.ctrl && input === 'a') archived = !archived;
        else if (key.ctrl && input === 'u') query = '';
        else if (key.backspace || key.delete) query = characters(query).slice(0, -1).join('');
        else if (input && !key.ctrl && !key.meta && !key.return) query += input.replace(/[\x00-\x1f\x7f-\x9f]/g, '');
        if (query !== dialog.filter || archived !== dialog.showArchived) setDialog((current) => ({ ...current, filter: query, showArchived: archived,
          selected: 0, items: browserItems(current.entries, query, archived, action) }));
      }
      if (key.return) void chooseDialog();
      return;
    }
    if (detail) {
      if (detail.call && input.toLowerCase() === "e" && !key.ctrl && !key.meta) { setToolExpanded((current) => !current); return; }
      if (key.ctrl && input === "d" && !value) { quit(); return; }
      if (key.ctrl && input === "c" && runningRef.current) { void cancelTurn(); setDetail(null); return; }
      if (key.escape || (key.ctrl && input === "c")) setDetail(null);
      return;
    }
    if (search) {
      const found = historyMatches(history, search.query);
      if (key.escape || (key.ctrl && input === "c")) {
        setValue(search.original); setSearch(null); return;
      }
      if (key.return || key.tab) {
        setValue(found[search.index] ?? search.original);
        setSearch(null); return; // 只回填，不发送。
      }
      if ((key.ctrl && input === "r") || key.upArrow || key.downArrow) {
        setSearch((current) => ({ ...current, index: found.length ? (current.index + (key.downArrow ? -1 : 1) + found.length) % found.length : 0 }));
        return;
      }
      if (key.backspace || key.delete) {
        setSearch((current) => ({ ...current, query: characters(current.query).slice(0, -1).join(""), index: 0 })); return;
      }
      if (input && !key.ctrl && !key.meta) {
        setSearch((current) => ({ ...current, query: current.query + input.replace(/[\x00-\x1f\x7f-\x9f]/g, ""), index: 0 }));
      }
      return;
    }
    if (key.ctrl && input === "r") {
      setSearch({ query: "", index: 0, original: value }); return;
    }
    if (key.ctrl && input === "c") {
      if (runningRef.current) void cancelTurn();
      else if (value) setValue("");
      else quit();
      return;
    }
    if (key.ctrl && input === "d") {
      if (value.length === 0) quit();
      else dispatchEdit({ type: "delete" });
      return;
    }
    if (key.escape) {
      if (files) { setSuppressedFiles(value); setFiles(null); return; }
      if (runningRef.current) void cancelTurn();
      else if (matches.length > 0) setSuppressedCommand(value);
      else setValue("");
      return;
    }
    if ((key.ctrl && input === "j") || (key.return && (key.meta || key.shift))) {
      dispatchEdit({ type: "insert", text: "\n" });
      return;
    }
    if (key.ctrl && (input === "u" || input === "k")) {
      dispatchEdit({ type: input === "u" ? "kill-left" : "kill-right" });
      return;
    }
    if (key.home || key.end) {
      dispatchEdit({ type: key.home ? "start" : "end" }); return;
    }
    if (key.ctrl && input === "w") {
      dispatchEdit({ type: "word-backspace" });
      return;
    }
    if (key.ctrl && input === "z") {
      dispatchEdit({ type: "undo" });
      return;
    }
    if (key.ctrl && input === "y") {
      dispatchEdit({ type: "redo" });
      return;
    }
    if (files) {
      if (key.escape) { setSuppressedFiles(value); setFiles(null); return; }
      if (key.upArrow || key.downArrow) {
        setFiles((current) => ({ ...current, selected: Math.max(0, Math.min(current.items.length - 1, current.selected + (key.upArrow ? -1 : 1))) }));
        return;
      }
      if (key.tab || key.return) {
        if (files.loading || files.error || !files.items.length) { setNotice("文件列表未就绪；Esc 收起后可继续编辑"); return; }
        const item = files.items[files.selected];
        if (!item) return;
        if (item.isDir && !item.path.includes('"')) {
          const chars = characters(value);
          const inserted = `@${/\s/.test(item.path) ? '"' : ""}${item.path}/`;
          dispatchEdit({ type: "replace-reference", text: chars.slice(0, files.token.start).join("") + inserted + chars.slice(files.token.end).join(""),
            cursor: files.token.start + characters(inserted).length });
        } else {
          dispatchEdit({ type: "replace-reference", ...insertReference(value, files.token, item.path) });
          setNotice("已插入路径；发送前确认后由Host读取文本正文，不自动上传");
        }
        setFiles(null); return;
      }
    }
    if (matches.length > 0) {
      if (key.upArrow || key.downArrow) {
        setCommandIndex((index) => (index + (key.upArrow ? -1 : 1) + matches.length) % matches.length);
        return;
      }
      if (key.tab) { setValue(matches[Math.min(commandIndex, matches.length - 1)].name + " "); return; }
      if (key.return) {
        const command = matches[Math.min(commandIndex, matches.length - 1)].name;
        setValue("");
        void runCommand(command);
        return;
      }
    }
    if (key.return) {
      if (runningRef.current && !value.trim().startsWith("/")) {
        setNotice("上一轮仍在进行，草稿已保留；Ctrl+C 可取消");
        return;
      }
      const text = value;
      setValue("");
      void handleSubmit(text);
      return;
    }
    if (key.upArrow || (key.ctrl && input === "p")) {
      if (key.upArrow && value.includes("\n")) { dispatchEdit({ type: "up" }); return; }
      if (history.length === 0) return;
      if (historyIndex === -1) draftRef.current = value;
      const next = Math.min(historyIndex + 1, history.length - 1);
      setHistoryIndex(next);
      setValue(history[history.length - 1 - next]);
      return;
    }
    if (key.downArrow || (key.ctrl && input === "n")) {
      if (key.downArrow && value.includes("\n")) { dispatchEdit({ type: "down" }); return; }
      if (historyIndex <= 0) {
        setHistoryIndex(-1);
        if (historyIndex === 0) setValue(draftRef.current);
        return;
      }
      const next = historyIndex - 1;
      setHistoryIndex(next);
      setValue(history[history.length - 1 - next]);
      return;
    }
    if (key.leftArrow || key.rightArrow) {
      dispatchEdit({ type: key.ctrl || key.meta ? (key.leftArrow ? "word-left" : "word-right") : (key.leftArrow ? "left" : "right") });
      return;
    }
    if (key.ctrl && (input === "a" || input === "e")) {
      dispatchEdit({ type: input === "a" ? "start" : "end" });
      return;
    }
    if (key.backspace || key.delete) {
      dispatchEdit({ type: key.backspace ? "backspace" : "delete" });
      return;
    }
    if (input && !key.ctrl && !key.meta) {
      if (/[\r\n]/.test(input)) setNotice("已保留多行粘贴；Enter 才发送");
      dispatchEdit({ type: "insert", text: input });
    }
  });

  if (phase === "connecting") {
    return h(Box, { paddingX: 1 }, h(Text, { color: "cyan" }, "正在连接 SaCode 宿主…"));
  }
  if (phase === "error") {
    return h(ErrorScreen, {
      message: bootError || "未知错误",
      stderr: client.stderrText,
      hostPath,
    });
  }

  const visibleMessages = messages;
  const stream = streamText;
  const layout = terminalLayout(size.columns, size.rows);
  const controlsOpen = !!approval || !!dialog || !!sessionConfirmation || !!actionConfirmation || !!referenceView || !!detail || !!configView || !!search;
  const normalInput = !controlsOpen;

  return h(
    Box,
    { flexDirection: "column", paddingX: THEME.gutter, width: layout.width, height: screen ? layout.height : undefined },
    !(screen && (detail || (approval && approvalDetails))) ? h(MainContent, {
      messages: visibleMessages, tools, stream, busy, sessionId: sessionIdRef.current,
      sessionTitle, version, compact: layout.compact, screen, controlsOpen,
    }) : null,
    approval && approvalDetails ? h(Box, { height: Math.max(3, layout.height - 12), flexDirection: "column", flexShrink: 0 },
      h(ApprovalDetails, { approval }),
    ) : null,
    approval ? h(ApprovalBox, { approval, compact: layout.compact, details: approvalDetails, selected: approvalSelection, answering })
      : actionConfirmation ? h(ActionConfirmation, { view: actionConfirmation, height: layout.height })
        : referenceView ? h(ReferenceConfirmation, { view: referenceView, height: layout.height })
        : sessionConfirmation ? h(SessionConfirmation, { confirmation: sessionConfirmation, busy: metadataBusy, height: layout.height })
        : configView ? h(ConfigurationDialog, { client, view: configView, compact: layout.compact, onClose: () => setConfigView(null), onSaved: (saved) => {
          setConfigView(null); setSelectedModel({ id: "", label: saved.label }); setNotice("配置已保存；尚未发起连通性或模型请求");
        } })
        : dialog ? h(SelectionDialog, { ...dialog, compact: layout.compact })
          : detail ? h(Box, { flexDirection: "column", height: Math.max(5, layout.height - 4), flexShrink: 0 },
               h(Viewport, { resetKey: detail, fromTop: true, label: detail.title },
                  h(Text, null, displayText(detail.text)),
                  detail.markdown !== undefined ? h(Markdown, { text: detail.markdown }) : null,
                  detail.call ? h(ToolCard, { call: detail.call, compact: layout.compact, expanded: toolExpanded }) : null,
                  detail.diff !== undefined ? detail.diffEmpty ? h(Text, { dimColor: true }, "Git 返回空 patch；可能是二进制、重命名、状态已变化或无文本差异，不等同于没有变更。")
                    : h(CodeBlock, { content: detail.diff.split("\n"), lang: "diff" }) : null,
               ),
               h(Text, { dimColor: true, wrap: "truncate-end" }, `Esc 返回 · PgUp/PgDn 翻页${detail.call ? ` · [e] ${toolExpanded ? "收起结果" : "展开全部结果"}` : ""}`),
            )
            : search ? h(Box, { flexDirection: "column", flexShrink: 0, borderStyle: "round", borderColor: THEME.accent, paddingX: 1 },
                h(Text, { bold: true }, `历史搜索：${displayText(search.query)}▌`),
                h(Text, { wrap: "truncate-end" }, displayText(historyMatches(history, search.query)[search.index] || "无匹配记录")),
                h(Text, { dimColor: true, wrap: "truncate-end" }, "Ctrl+R 下一个 · Enter/Tab 回填不发送 · Esc 恢复草稿"),
              ) : h(Box, { flexDirection: "column", flexShrink: 0 },
                busy ? h(Text, { color: THEME.accent }, "⠋ 正在处理 · Esc / Ctrl+C 取消") : null,
                screen && matches.length > 0 ? h(CommandSuggestions, { matches, selected: Math.min(commandIndex, matches.length - 1), compact: layout.compact }) : null,
                 h(Composer, { value, cursor: editor.cursor, busy, compact: layout.compact, width: layout.width - 2, placeholder: busy ? "可编辑下一条草稿，Ctrl+C 取消" : "输入任务，或 / 查看命令" }),
                 files ? h(SelectionDialog, { ...files, title: `@ 工作区${files.token.directory ? " / " + displayText(files.token.directory) : ""}${files.limited ? " · 最多200项" : ""}`,
                    compact: layout.compact, footer: "Tab/Enter 补全 · Esc 收起 · 发送前确认读取" }) : null,
                !screen && matches.length > 0 ? h(CommandSuggestions, { matches, selected: Math.min(commandIndex, matches.length - 1), compact: layout.compact }) : null,
              ),
    !configView ? h(StatusBar, { busy, usage, notice, error, inputActive: normalInput, cwd: normalInput ? cwd : undefined, sessionTitle, modelLabel: selectedModel.label, compact: layout.compact, approvalPending: !!approval }) : null,
  );
}
