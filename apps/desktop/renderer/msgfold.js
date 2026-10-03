// 对话面的纯派生层：投影行数组 → 气泡消息数组，以及长消息折叠判定。
// 只放纯函数（挂 window.DshMsgFold），不引 Vue、不碰 DOM，这样 node 单测能在全新上下文里求值。
// 角色映射的唯一来源就是这张表；投影行的原始前缀保留在 sourceRole 里，
// 界面按条复述它，data-role 用映射值——两者都能在会话日志里找到出处，不造假。
"use strict";
window.DshMsgFold = (function () {
  // 全仓唯一的折叠阈值出处。要调只改这一处；组件里不许再出现第二个数字。
  var FOLD_THRESHOLD = 240;

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

  function toBubbleMessages(lines) {
    var out = [];
    for (var i = 0; i < lines.length; i++) {
      var parts = splitMsg(lines[i]);
      var role = "system";
      for (var k = 0; k < ROLE_MAP.length; k++) {
        if (parts.role.indexOf(ROLE_MAP[k][0]) === 0) {
          role = ROLE_MAP[k][1];
          break;
        }
      }
      out.push({ id: "m" + i, role: role, content: parts.text, sourceRole: parts.role });
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

  return {
    FOLD_THRESHOLD: FOLD_THRESHOLD,
    ROLE_MAP: ROLE_MAP,
    toBubbleMessages: toBubbleMessages,
    roleConfigs: roleConfigs,
    foldPlan: foldPlan
  };
})();
