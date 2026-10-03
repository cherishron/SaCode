/* 渲染层：Vue 3 运行时构建 + h()（CSP 禁 unsafe-eval，所以不带运行时模板编译器）。
   这里不持有会话真源——消息列表只来自核心投影，流式文本只来自 turn/poll，
   工具与审批态只来自 extension/list 与 extension/call 的实际应答。 */
"use strict";
const { createApp, h, ref, onMounted } = window.Vue;

const el = (tag, cls, children, extra) => h(tag, Object.assign({ class: cls }, extra || {}), children);

// TinyVue 组件由 scripts/pack-tinyvue.mjs 在构建期折叠成 vendor/tinyvue.iife.js（经典脚本）：
// 组件库自身是 ESM-only，而这里跑在 file:// + CSP script-src 'self' 上，既不能加载 ES module
// 也没有运行时模板编译器，所以只有折叠产物这一条路。用的还是上面那份 Vue runtime（构建期把
// `vue` 别名到 globalThis.Vue），不允许出现第二份 Vue——那样组件的响应式和应用的不是同一套。
// 缺产物就当场把话写在界面上：不悄悄退回自画按钮，否则「接了组件库」会变成没法证伪的声称。
const TV = window.TinyVue;
if (!TV || !TV.Button) {
  document.getElementById("app").textContent =
    "缺 vendor/tinyvue.iife.js：先跑 node scripts/pack-vendor.mjs 与 node scripts/pack-tinyvue.mjs";
  throw new Error("TinyVue vendor missing");
}

// 核心投影帧里的每条消息形如 "user/message: 正文"；只按第一个冒号切，正文里再冒号原样保留。
function splitMsg(line) {
  const i = line.indexOf(":");
  if (i < 0) return { role: "message", text: line };
  return { role: line.slice(0, i), text: line.slice(i + 2) };
}

function roleClass(role) {
  if (role.startsWith("user")) return "msg msg-user";
  if (role.startsWith("assistant")) return "msg msg-assistant";
  if (role.startsWith("tool")) return "msg msg-tool";
  return "msg msg-system";
}

createApp({
  setup() {
    const proj = ref({ projection: 0, events: 0, durable: 0, pending: 0, truncatedTail: false, messages: [] });
    const tools = ref([]);
    const toolCounters = ref({ misses: 0, guardDenials: 0 });
    const draft = ref("");
    const error = ref("");
    const approval = ref(null);
    const outcome = ref("");
    const outcomeKind = ref("");
    const turn = ref({ running: false, settled: false, text: "", finishReason: "", cancelled: false, interrupted: false, delivered: 0 });

    let pollTimer = null;

    async function refresh() {
      proj.value = await window.dsh.projection();
    }

    async function refreshTools() {
      const r = await window.dsh.toolsList();
      tools.value = r.tools;
      toolCounters.value = { misses: r.misses, guardDenials: r.guardDenials };
    }

    async function send() {
      const text = draft.value;
      if (!text) return;
      draft.value = "";
      error.value = "";
      try {
        // 渲染层只说「用户说了什么」，事件类型由核心决定：不给它伪造 system/message 的口子
        await window.dsh.userSend(text);
        await refresh();
      } catch (e) {
        error.value = String(e.message || e);
      }
    }

    function stopPolling() {
      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
    }

    function startPolling() {
      stopPolling();
      pollTimer = setInterval(async () => {
        try {
          const p = await window.dsh.turnPoll();
          for (const f of p.frames) {
            const i = f.indexOf(":");
            const kind = i < 0 ? f : f.slice(0, i);
            const body = i < 0 ? "" : f.slice(i + 1);
            if (kind === "text") turn.value.text += body;
            else if (kind === "usage") turn.value.text += "\n[usage " + body + "]";
            else if (kind === "tool-call-delta") turn.value.text += "\n[tool-call " + body + "]";
          }
          turn.value.running = p.running;
          if (p.settled) {
            turn.value.settled = true;
            turn.value.finishReason = p.finishReason || "";
            turn.value.cancelled = !!p.cancelled;
            turn.value.interrupted = !!p.interrupted;
            turn.value.delivered = p.delivered || 0;
            stopPolling();
            await refresh();
            await refreshTools();
          }
        } catch (e) {
          error.value = String(e.message || e);
          stopPolling();
        }
      }, 60);
    }

    async function runTurn(limit) {
      error.value = "";
      turn.value = { running: true, settled: false, text: "", finishReason: "", cancelled: false, interrupted: false, delivered: 0 };
      try {
        await window.dsh.turnStart(limit);
        startPolling();
      } catch (e) {
        error.value = String(e.message || e);
        turn.value.running = false;
      }
    }

    async function cancelTurn() {
      error.value = "";
      try {
        await window.dsh.turnCancel();
      } catch (e) {
        error.value = String(e.message || e);
      }
    }

    // IPC 会把宿主错误包一层「Error invoking remote method」；界面上只留协议层的码与原因
    const cleanErr = (e) => String((e && e.message) || e).replace(/^Error invoking remote method '[^']+': /, "");

    async function askTool(t) {
      outcome.value = "";
      outcomeKind.value = "";
      if (!t.needsApproval) {
        await callTool(t.name, 0);
        return;
      }
      // 需审批的工具先向核心要一张工单（asked 进日志），界面上批的是这张单，
      // 不是渲染层自己拼的一句 "allowed-once"。
      try {
        const a = await window.dsh.approvalAsk(t.name);
        approval.value = { name: t.name, description: t.description, approvalId: a.approvalId };
      } catch (e) {
        approval.value = null;
        outcomeKind.value = "outcome outcome-denied";
        outcome.value = "发号失败：" + cleanErr(e);
      }
    }

    async function answerTool(approvalAnswer) {
      const a = approval.value;
      approval.value = null;
      if (!a) return;
      try {
        const r = await window.dsh.approvalAnswer(a.approvalId, approvalAnswer);
        if (!r.accepted) {
          outcomeKind.value = "outcome outcome-denied";
          outcome.value = "应答未被接受：工单状态 " + r.state;
          return;
        }
      } catch (e) {
        outcomeKind.value = "outcome outcome-denied";
        outcome.value = "应答失败：" + cleanErr(e);
        return;
      }
      // 批过的和拒的都真的走一次调用：放行才执行，拒绝要当场看到核心把它挡下来
      await callTool(a.name, a.approvalId);
    }

    async function callTool(name, approvalId) {
      if (!name) return;
      // 各工具按自己的参数契约给 args：只读工具的路径就是整串参数，
      // 把「路径 正文」一起塞给它，它会把整串当成一个不存在的路径。
      const args = name === "read" ? "dsh-tool.txt" : "dsh-tool.txt hello-from-renderer";
      try {
        const r = await window.dsh.toolCall(name, args, approvalId || 0);
        outcomeKind.value = "";
        outcome.value = "结果：" + r.result;
      } catch (e) {
        outcomeKind.value = "outcome outcome-denied";
        outcome.value = "被拒：" + cleanErr(e);
      }
      await refreshTools();
      await refresh();
    }

    onMounted(async () => {
      try {
        await refresh();
        await refreshTools();
      } catch (e) {
        error.value = String(e.message || e);
      }
    });

    return {
      proj, tools, toolCounters, draft, error, approval, outcome, outcomeKind, turn,
      send, runTurn, cancelTurn, askTool, answerTool,
    };
  },
  render() {
    const self = this;
    const head = el("header", "top", [
      el("span", "brand", "DSH · 会话投影"),
      el("div", "counters", [
        el("span", "badge", "events " + self.proj.events, { id: "count-events" }),
        el("span", "badge", "durable " + self.proj.durable, { id: "count-durable" }),
        el("span", "badge" + (self.proj.pending > 0 ? " badge-warn" : " badge-ok"), "pending " + self.proj.pending, { id: "count-pending" }),
        el("span", "badge" + (self.proj.truncatedTail ? " badge-danger" : ""), self.proj.truncatedTail ? "tail truncated" : "tail ok", { id: "count-tail" }),
      ]),
    ]);

    const msgs = self.proj.messages.map((line, i) => {
      const m = splitMsg(line);
      return el("div", roleClass(m.role), [el("span", "msg-role", m.role), m.text], { key: i });
    });

    const streamChildren = [el("span", "msg-role", "assistant/stream")];
    if (self.turn.text) streamChildren.push(self.turn.text);
    if (self.turn.running) streamChildren.push(el("span", "note", " …流式中"));
    const streamBox = self.turn.running || self.turn.text
      ? [el("div", "streaming", streamChildren, { id: "stream" })]
      : [];

    const turnState = self.turn.settled
      ? (self.turn.cancelled ? "cancelled" : self.turn.interrupted ? "interrupted" : "settled:" + (self.turn.finishReason || "-"))
      : self.turn.running ? "running" : "idle";
    const turnBar = el("div", "approval-row", [
      h(TV.Button, {
        type: "primary",
        id: "run-turn",
        disabled: self.turn.running,
        onClick: () => self.runTurn(5),
      }, () => "跑一轮（完整）"),
      el("button", "btn", "跑一轮（可取消）", { id: "run-turn-2", onClick: () => self.runTurn(2), disabled: self.turn.running }),
      el("button", "btn btn-danger", "停止", { id: "stop-turn", onClick: self.cancelTurn, disabled: !self.turn.running }),
      el("span", "badge", "turn " + turnState, { id: "turn-state" }),
    ]);

    const main = el("section", "pane", [
      el("div", "stream", msgs, { id: "messages" }),
      streamBox,
      turnBar,
      el("p", "error", self.error, { id: "error" }),
    ]);

    const toolBtns = self.tools.map((t, i) =>
      el("button", "tool", [t.name, el("span", "tool-desc", (t.description || "") + (t.needsApproval ? " · 需审批" : " · 免审批"))], {
        key: t.name,
        id: "tool-" + t.name,
        onClick: () => self.askTool(t),
      })
    );

    const approvalBox = self.approval
      ? [el("div", "approval", [
          el("p", null, "审批：" + self.approval.name + "（工单 #" + self.approval.approvalId + "，一次性放行，不给永久授权）"),
          el("div", "approval-row", [
            el("button", "btn btn-primary", "允许一次", { id: "allow-once", onClick: () => self.answerTool("allowed-once") }),
            el("button", "btn btn-danger", "拒绝", { id: "deny", onClick: () => self.answerTool("denied") }),
          ]),
        ], { id: "approval" })]
      : [];

    const side = el("aside", "pane side", [
      el("h3", null, "工具（核心注册表）"),
      toolBtns,
      approvalBox,
      self.outcome ? el("div", self.outcomeKind || "outcome", self.outcome, { id: "outcome" }) : null,
      el("p", "note", "未登记 " + self.toolCounters.misses + " · guard 拒 " + self.toolCounters.guardDenials, { id: "tool-counters" }),
    ]);

    const composer = el("footer", "composer", [
      h("textarea", {
        class: "input",
        id: "composer",
        rows: 2,
        placeholder: "发消息给会话；多行也可以",
        value: self.draft,
        onInput: (e) => (self.draft = e.target.value),
      }),
      el("button", "btn btn-primary", "发送", { id: "send", onClick: self.send }),
    ]);

    return el("div", "app", [head, main, side, composer]);
  },
}).mount("#app");
