// 对话面的纯派生层：投影行数组 → 气泡消息数组，以及长消息折叠判定。
// 只放纯函数（挂 window.SaCodeMsgFold），不引 Vue、不碰 DOM，这样 node 单测能在全新上下文里求值。
// 角色映射的唯一来源就是这张表；投影行的原始前缀保留在 sourceRole 里，
// 界面按条复述它，data-role 用映射值——两者都能在会话日志里找到出处，不造假。
"use strict";
window.SaCodeMsgFold = (function () {
  // 全仓唯一的折叠阈值出处。要调只改这一处；组件里不许再出现第二个数字。
  var FOLD_THRESHOLD = 240;
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

  function toBubbleMessages(lines, rows, sessionId) {
    var out = [];
    for (var i = 0; i < lines.length; i++) {
      var parts = splitMsg(lines[i]);
      var role = bubbleRole(parts.role);
      var metadata = rows && rows[i];
      var message = { id: metadata ? metadata.id : "m" + i, role: role, content: parts.text, sourceRole: parts.role, attachments: metadata ? metadata.attachments : [] };
      if (sessionId) message.sessionId = sessionId;
      out.push(message);
    }
    return out;
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

  return {
    FOLD_THRESHOLD: FOLD_THRESHOLD,
    OUTLINE_TITLE_LIMIT: OUTLINE_TITLE_LIMIT,
    OUTLINE_TEXT_LIMIT: OUTLINE_TEXT_LIMIT,
    ROLE_MAP: ROLE_MAP,
    toBubbleMessages: toBubbleMessages,
    turnOutline: turnOutline,
    roleConfigs: roleConfigs,
    foldPlan: foldPlan,
    latestReadPreview: latestReadPreview
  };
})();
