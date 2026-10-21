// 对话面的纯派生层：投影行数组 → 气泡消息数组，以及长消息折叠判定。
// 只放纯函数（挂 window.SaCodeMsgFold），不引 Vue、不碰 DOM，这样 node 单测能在全新上下文里求值。
// 角色映射的唯一来源就是这张表；投影行的原始前缀保留在 sourceRole 里，
// 界面按条复述它，data-role 用映射值——两者都能在会话日志里找到出处，不造假。
"use strict";
window.SaCodeMsgFold = (function () {
  // 全仓唯一的折叠阈值出处。要调只改这一处；组件里不许再出现第二个数字。
  var FOLD_THRESHOLD = 600;
  // 网页正文独立使用 500 个 Unicode 字符预览，不改变普通消息折叠阈值。
  var WEB_PREVIEW_LIMIT = 500;
  // 历史导航的标题与摘要上限，同样只在这里出现一次。
  var OUTLINE_TITLE_LIMIT = 60;
  var OUTLINE_TEXT_LIMIT = 120;

  // 按声明顺序匹配投影行前缀：[前缀, 气泡角色, 定位, 形状]
  var ROLE_MAP = [
    ["user/", "user", "end", "corner"],
    ["assistant/", "assistant", "start", "corner"],
    ["tool/", "tool", "start", "corner"],
    ["system/", "system", "start", "none"],
    ["developer/", "developer", "start", "none"]
  ];

  function splitMsg(line) {
    var i = line.indexOf(":");
    if (i < 0) return { role: "", text: line };
    return { role: line.slice(0, i), text: line.slice(i + 1).replace(/^ /, "") };
  }

  // 角色映射只有一个入口，大纲与气泡不许各判一次（否则同一行在两处得到两个角色）。
  function bubbleRole(prefix) {
    for (var k = 0; k < ROLE_MAP.length; k++) {
      if (prefix.indexOf(ROLE_MAP[k][0]) === 0) return ROLE_MAP[k][1];
    }
    return "system";
  }

  // 截断带省略号后总长正好是上限；组件里不许出现第二套上限数字。
  function clip(text, limit) {
    return text.length > limit ? text.slice(0, limit - 1) + "…" : text;
  }

  function rowId(rows, i) {
    return rows && rows[i] ? rows[i].id : "m" + i;
  }

  function toBubbleMessages(lines, rows, sessionId, toolCalls) {
    var out = [];
    var calls = Array.isArray(toolCalls) ? toolCalls : [];
    var results = new Map(calls.filter(function(call) { return call.resultMessageId; }).map(function(call) { return [call.resultMessageId, call]; }));
    for (var i = 0; i < lines.length; i++) {
      var parts = splitMsg(lines[i]);
      var role = bubbleRole(parts.role);
      var metadata = rows && rows[i];
      var message = { id: metadata ? metadata.id : "m" + i, role: role, content: parts.text, sourceRole: parts.role, attachments: metadata ? metadata.attachments : [] };
      if (metadata && results.has(metadata.id)) message.toolCall = results.get(metadata.id);
      if (sessionId) message.sessionId = sessionId;
      out.push(message);
    }
    var firstSeq = rows && rows.length ? Number(String(rows[0].id).replace(/^event-/, '')) : 0;
    for (var call of calls) {
      if (call.resultMessageId || !Number.isSafeInteger(call.eventSeq) || (Number.isFinite(firstSeq) && call.eventSeq < firstSeq)) continue;
      var pending = {id:call.id,role:'tool',content:call.result||'',sourceRole:'tool/call',attachments:[],sessionId:sessionId,toolCall:call};
      var at = out.findIndex(function(message) { return Number(String(message.id).replace(/^(?:tool-)?event-/, '')) > call.eventSeq; });
      out.splice(at < 0 ? out.length : at, 0, pending);
    }
    return out;
  }

  // 系统与开发者上下文供模型消费，保留在日志/投影中，不混入普通对话气泡。
  // 按真实角色筛选，不能按正文关键词隐藏用户或助手消息。
  function conversationMessages(messages) {
    return messages.filter(function(message) {
      return message.role === 'user' || message.role === 'assistant' || message.role === 'tool';
    });
  }

  // 临时正文复用落盘消息的同一气泡链，收束只替换数据来源，不替换布局。
  function withStreamingMessage(messages, turn, sessionId) {
    var persisted = turn.settled && !turn.cancelled && !turn.interrupted && !turn.projectionPending;
    if ((!turn.running && persisted) || (!turn.running && !turn.text)) return messages;
    return messages.concat([{id:'live-'+sessionId, role:'assistant', sourceRole:'assistant/message',
      content:turn.text || '', attachments:[], sessionId:sessionId, live:true, running:!!turn.running}]);
  }

  // 定位与形状由同一张表生成，避免出现「映射表说 start、roleConfigs 说 end」这种双真源。
  function roleConfigs() {
    var rc = {};
    for (var k = 0; k < ROLE_MAP.length; k++) {
      rc[ROLE_MAP[k][1]] = { placement: ROLE_MAP[k][2], shape: ROLE_MAP[k][3] };
    }
    return rc;
  }

  function foldPlan(text, threshold) {
    if (text.length > threshold) {
      return { folded: true, shown: text.slice(0, threshold) + "…" };
    }
    return { folded: false, shown: text };
  }

  // 只从日志投影的成功读取记录提取快照，路径可能含 Windows 盘符和冒号。
  // 头部以最后的字节数结尾；正文保留原始换行和字符，不作为 HTML 解释。
  function latestReadPreview(lines, rows) {
    for (var i = lines.length - 1; i >= 0; i--) {
      var parts = splitMsg(lines[i]);
      if (parts.role !== "tool/result" || parts.text.indexOf("ok-read:") !== 0) continue;
      var newline = parts.text.indexOf("\n");
      if (newline < 0) continue;
      var header = /^(.*):(\d+)$/.exec(parts.text.slice(8, newline));
      if (!header || !header[1] || !Number.isSafeInteger(Number(header[2]))) continue;
      return { path: header[1], bytes: Number(header[2]), text: parts.text.slice(newline + 1), messageId: rows && rows[i] ? rows[i].id : "m" + i };
    }
    return null;
  }

  // 会话内历史对话导航的轮次大纲：条目只取投影里真实存在的用户提问，
  // 锚点 id 与气泡消息同一来源（同一行、同一取法），点了才有确定的落点。
  // 第一条提问之前的系统/开发者消息不建条目——侧栏不造界面上跳不到的锚点。
  function turnOutline(lines, rows) {
    var out = [];
    for (var i = 0; i < (lines || []).length; i++) {
      var parts = splitMsg(lines[i]);
      var role = bubbleRole(parts.role);
      var text = parts.text || "";
      if (role === "user") {
        var head = "";
        var paragraphs = text.split("\n");
        for (var k = 0; k < paragraphs.length && !head; k++) head = paragraphs[k].trim();
        out.push({
          id: rowId(rows, i),
          title: clip(head, OUTLINE_TITLE_LIMIT) || "（空消息）",
          content: clip(text.trim(), OUTLINE_TEXT_LIMIT),
          replies: []
        });
      } else if (out.length && (role === "assistant" || role === "tool")) {
        out[out.length - 1].replies.push({ id: rowId(rows, i), role: role, text: clip(text.trim(), OUTLINE_TEXT_LIMIT) });
      }
    }
    return out;
  }

  // 工具结果卡的数据来源：投影只 surface tool/result（tool/call 按冻结不变量不进投影），
  // 所以这里只解析「结果侧」真实存在的事实，不补调用名与参数——投影里没有就不编。
  // 路径可能含 Windows 盘符冒号，字节数按最后一段数字认，不按第一个冒号切。
  function safeWebUrl(value) {
    if (typeof value !== 'string' || /[\s\u0000-\u001f\u007f]/.test(value) || value.indexOf('\\') >= 0) return '';
    // 不提供点击执行通道；这里只把明确的 HTTP(S) 无凭据来源标为可识别地址。
    return /^https?:\/\/[^/?#@]+(?:[/?#]|$)/i.test(value) ? value : '';
  }

  function parseWebResult(raw, argumentsText) {
    try {
      var envelope = JSON.parse(raw);
      if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) return null;
      var value = envelope.result && typeof envelope.result === 'object' ? envelope.result : envelope;
      if (value.externalContent !== true) return null;
      var isSearch = Array.isArray(value.sources);
      if (!isSearch && !safeWebUrl(value.url)) return null;
      var content = typeof (isSearch ? value.content : value.body) === 'string' ? (isSearch ? value.content : value.body) : '';
      var chars = Array.from(content);
      var queries = [];
      try {
        var args = typeof argumentsText === 'string' ? JSON.parse(argumentsText) : argumentsText;
        if (args && Array.isArray(args.queries)) queries = args.queries.filter(function(q) { return typeof q === 'string'; });
      } catch (_) {}
      if (!queries.length && Array.isArray(value.queries)) queries = value.queries.filter(function(q) { return typeof q === 'string'; });
      return {
        kind: isSearch ? 'web-search' : 'web-fetch', label: isSearch ? '网络搜索' : '网页抓取',
        status: !isSearch && Number.isInteger(value.status) && value.status >= 400 ? 'error' : 'done',
        target: isSearch ? queries.join(' · ') : value.url,
        url: isSearch ? '' : value.url,
        httpStatus: !isSearch && Number.isInteger(value.status) && value.status >= 100 && value.status <= 599 ? value.status : null,
        externalContent: true, truncated: value.truncated === true, queries: queries,
        sources: isSearch ? value.sources.filter(function(s) { return s && typeof s === 'object' && !Array.isArray(s); }).map(function(s) {
          return { url: typeof s.url === 'string' ? s.url : '', title: typeof s.title === 'string' ? s.title : '',
            snippet: typeof s.snippet === 'string' ? s.snippet : '', publishedAt: typeof s.publishedAt === 'string' ? s.publishedAt : '' };
        }) : [],
        body: content, preview: chars.slice(0, WEB_PREVIEW_LIMIT).join('') + (chars.length > WEB_PREVIEW_LIMIT ? '…' : ''),
        folded: chars.length > WEB_PREVIEW_LIMIT, bytes: null, lines: null
      };
    } catch (_) { return null; }
  }

  function parseToolResult(text, argumentsText) {
    var raw = String(text == null ? "" : text);
    var web = parseWebResult(raw, argumentsText);
    if (web) return web;
    var brk = raw.indexOf("\n");
    var head = brk < 0 ? raw : raw.slice(0, brk);
    var body = brk < 0 ? "" : raw.slice(brk + 1);
    var m;
    if (head.indexOf("ok-read:") === 0) {
      var rest = head.slice("ok-read:".length);
      var linesNote = null;
      var li = rest.lastIndexOf(":lines=");
      if (li >= 0) { linesNote = rest.slice(li + 7); rest = rest.slice(0, li); }
      var ci = rest.lastIndexOf(":");
      if (ci > 0 && /^\d+$/.test(rest.slice(ci + 1))) {
        return { kind: "read", label: "读取", status: "done", target: rest.slice(0, ci), bytes: Number(rest.slice(ci + 1)), lines: linesNote, body: body };
      }
      return { kind: "read", label: "读取", status: "done", target: rest, bytes: null, lines: linesNote, body: body };
    }
    if ((m = /^ok-edit:(.+)$/.exec(head))) { return { kind: "edit", label: "编辑", status: "done", target: m[1], bytes: null, lines: null, body: body }; }
    if ((m = /^ok:(.+)$/.exec(head))) { return { kind: "write", label: "写入", status: "done", target: m[1], bytes: null, lines: null, body: body }; }
    if ((m = /^cancelled:(.+)$/.exec(head))) { return { kind: "cancel", label: "已取消", status: "warning", target: m[1], bytes: null, lines: null, body: body }; }
    if ((m = /^denied:([^:]+)(?::([\s\S]*))?$/.exec(head))) { return { kind: "denied", label: "已拒绝", status: "error", target: m[1], reason: m[2] || "", bytes: null, lines: null, body: body }; }
    if (head === "bad-args" || head.indexOf("err") === 0 || head.indexOf("web-error:") === 0 || head.indexOf("computer.") === 0) {
      return { kind: "error", label: "失败", status: "error", target: "", reason: head, bytes: null, lines: null, body: body };
    }
    return { kind: "generic", label: "工具", status: "idle", target: "", bytes: null, lines: null, body: raw };
  }

  return {
    FOLD_THRESHOLD: FOLD_THRESHOLD,
    WEB_PREVIEW_LIMIT: WEB_PREVIEW_LIMIT,
    OUTLINE_TITLE_LIMIT: OUTLINE_TITLE_LIMIT,
    OUTLINE_TEXT_LIMIT: OUTLINE_TEXT_LIMIT,
    ROLE_MAP: ROLE_MAP,
    toBubbleMessages: toBubbleMessages,
    conversationMessages: conversationMessages,
    withStreamingMessage: withStreamingMessage,
    turnOutline: turnOutline,
    roleConfigs: roleConfigs,
    foldPlan: foldPlan,
    latestReadPreview: latestReadPreview,
    parseToolResult: parseToolResult
  };
})();
