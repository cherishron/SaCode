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

const TR = window.TinyRobot;
if (!TR || !TR.BubbleList || !TR.BubbleProvider) {
  document.getElementById("app").textContent =
    "缺 vendor/tinyrobot.iife.js：先跑 node scripts/pack-vendor.mjs、node scripts/pack-tinyvue.mjs 与 node scripts/pack-tinyrobot.mjs";
  throw new Error("TinyRobot vendor missing");
}
const FOLD = window.DshMsgFold;
if (!FOLD || typeof FOLD.toBubbleMessages !== "function") {
  document.getElementById("app").textContent = "缺 renderer/msgfold.js";
  throw new Error("msgfold missing");
}

// 自定义文本内容渲染器：接管所有 text 内容，含 tool/ 行。
// 非接不可的原因：默认内容渲染器链（dist/index6.js 的 Ke）把 role==="tool" 交给 ToolRole，
// 而 ToolRole 只往 provider store 登记 tool_call_results、渲染一个注释节点——tool 正文会隐身。
// priority 0 与默认链的 NORMAL 并列，但 BubbleProvider 合并时自定义在前、排序稳定，故恒先命中，
// 也顺带压过 ROLE=20 的 ToolRole。
// 折叠态只是视图态：一条消息折没折，既不是会话事实也不该写进日志。
// 用 reactive 包 Set 是为了 has() 建立依赖、add()/delete() 能触发这条正文重渲染。
// 阈值不在这里——FOLD.FOLD_THRESHOLD 是全仓唯一出处，组件里不许出现第二个数字。
const foldOpen = window.Vue.reactive({ ids: new Set() });

const TextBubble = {
  props: { message: { type: Object, default: () => ({}) }, contentIndex: { type: Number, default: 0 } },
  setup(props) {
    return () => {
      const m = props.message || {};
      const text = typeof m.content === "string" ? m.content : "";
      const id = m.id || "";
      const plan = FOLD.foldPlan(text, FOLD.FOLD_THRESHOLD);
      const expanded = !!id && foldOpen.ids.has(id);
      const state = plan.folded ? (expanded ? "expanded" : "folded") : "plain";
      const children = [
        h("p", { class: "msg-text", "data-msg-id": id, "data-source-role": m.sourceRole || "", "data-fold-state": state }, expanded ? text : plan.shown),
      ];
      if (plan.folded) {
        children.push(
          h(
            "button",
            {
              class: "btn btn-fold",
              "data-fold-toggle": id,
              onClick: () => {
                if (foldOpen.ids.has(id)) foldOpen.ids.delete(id);
                else foldOpen.ids.add(id);
              },
            },
            expanded ? "收起" : "展开"
          )
        );
      }
      return h("div", { class: "msg-node" }, children);
    };
  },
};
const TEXT_MATCH = {
  find: (_message, content) => !!(content && content.type === "text"),
  renderer: window.Vue.markRaw(TextBubble),
  priority: 0,
};

createApp({
  setup() {
    const proj = ref({ projection: 0, events: 0, durable: 0, pending: 0, truncatedTail: false, messages: [] });
    // 投影行 → 气泡消息。这只是同一份 proj.messages 的视图派生：不写日志、不发协议帧。
    const bubbleMessages = window.Vue.computed(() => FOLD.toBubbleMessages(proj.value.messages || []));
    const tools = ref([]);
    const toolCounters = ref({ misses: 0, guardDenials: 0 });
    const draft = ref("");
    const error = ref("");
    const approval = ref(null);
    const outcome = ref("");
    const outcomeKind = ref("");
    const turn = ref({ running: false, settled: false, text: "", finishReason: "", cancelled: false, interrupted: false, delivered: 0 });
    // 计量读数只留一处真源：值全部来自核心的 usage/status 或 turn/poll 结算帧。
    // 界面不累加、不换算、也不在核心没回话时编一个 0 出来（0/0 看起来像「花光了」）。
    const usage = ref({ used: null, budget: null, over: false, verdict: "" });
    const budgetDraft = ref("");
    const budgetNote = ref("");

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
            // 用量读数只能取自核心的结算帧：界面不另算一份账，也不显示自己推算的预算。
            usage.value = { used: p.used, budget: p.budget, over: !!p.over, verdict: p.usageVerdict || "" };
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
      turn.value = { running: true, settled: false, text: "", finishReason: "", cancelled: false, interrupted: false, delivered: 0, used: null, budget: null, verdict: "", over: false };
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

    async function refreshUsage() {
      const u = await window.dsh.usageStatus();
      usage.value = { used: u.used, budget: u.budget, over: !!u.over, verdict: u.verdict || "" };
    }

    // 收紧预算：填进来的数字交给核心判，界面只复述核心回的那一档，绝不自己抬。
    async function setBudget() {
      const raw = String(budgetDraft.value);
      const n = Number(raw);
      if (raw === "" || !Number.isInteger(n) || n < 0) {
        budgetNote.value = "预算要填非负整数";
        return;
      }
      try {
        const r = await window.dsh.usageSetBudget(n);
        await refreshUsage();
        budgetNote.value = r.applied ? "已收紧到 " + r.budget : "拒绝放宽：仍停在 " + r.budget;
      } catch (e) {
        budgetNote.value = cleanErr(e);
      }
    }

    onMounted(async () => {
      try {
        await refresh();
        await refreshTools();
        // 开机就把账读出来：重启后「已经花掉多少、停在哪个档」不该等到跑完一轮才知道
        await refreshUsage();
      } catch (e) {
        error.value = String(e.message || e);
      }
    });

    return {
      proj, tools, toolCounters, draft, error, approval, outcome, outcomeKind, turn,
      usage, budgetDraft, budgetNote, setBudget, bubbleMessages,
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

    // 分组策略用库内置的 consecutive（连续同角色合并），不自造分组器。
    // 组标签走 prefix 槽，内容是「组内条数 × 映射角色」——两个数都能从投影数出来，
    // 不是第二真源。autoScroll 关掉：本批不引入滚动语义改动。
    const msgs = [
      h(TR.BubbleProvider, { contentRendererMatches: [TEXT_MATCH] }, () => [
        h(
          TR.BubbleList,
          {
            messages: self.bubbleMessages,
            groupStrategy: "consecutive",
            fallbackRole: "system",
            roleConfigs: FOLD.roleConfigs(),
            autoScroll: false,
          },
          {
            prefix: (slot) => [
              h("span", { class: "msg-role" }, (slot.messageIndexes || slot.messages || []).length + " × " + (slot.role || "system")),
            ],
          }
        ),
      ]),
    ];

    const streamChildren = [el("span", "msg-role", "assistant/stream")];
    if (self.turn.text) streamChildren.push(self.turn.text);
    if (self.turn.running) streamChildren.push(el("span", "note", " …流式中"));
    // 干净收束后正文已落进会话日志、由投影给出那一份气泡，回显框必须撤掉：
    // 留着它等于界面上同一句助手话有两份来源，其中一份重启就没了。
    // 取消的一轮不落 assistant/message，半截正文只能继续由回显框呈现。
    const persisted = self.turn.settled && !self.turn.cancelled;
    const streamBox = self.turn.running || (self.turn.text && !persisted)
      ? [el("div", "streaming", streamChildren, { id: "stream" })]
      : [];

    const turnState = self.turn.settled
      ? (self.turn.cancelled ? "cancelled" : self.turn.interrupted ? "interrupted" : "settled:" + (self.turn.finishReason || "-"))
      : self.turn.running ? "running" : "idle";
    // 用量呈现：数字与判决只来自核心（开机读 usage/status，跑完一轮取结算帧），界面不推算、不补默认值。
    // 还没拿到数时显示 ?，而不是 0/0——0/0 看起来像「已经花光了」。
    const u = self.usage;
    const usageText = "用量 " + (u.used === null ? "?" : u.used) + "/" + (u.budget === null ? "?" : u.budget)
      + (u.verdict ? " · " + u.verdict : " · 未计量") + (u.over ? " · 已超档" : "");
    // 超过档就不给再开新轮：界面先把按钮锁住，核心那侧的 -32014 仍是真正的闸门，
    // 两者都要在——只靠界面禁用等于换个客户端就能继续花。
    const turnLocked = self.turn.running || u.over;
    const runTurnBtn = h(TV.Button, {
      type: "primary",
      id: "run-turn",
      disabled: turnLocked,
      onClick: () => self.runTurn(5),
    }, () => (u.over ? "已超档" : "跑一轮（完整）"));
    const turnBar = el("div", "approval-row", [
      runTurnBtn,
      el("button", "btn", "跑一轮（可取消）", { id: "run-turn-2", onClick: () => self.runTurn(2), disabled: turnLocked }),
      el("button", "btn btn-danger", "停止", { id: "stop-turn", onClick: self.cancelTurn, disabled: !self.turn.running }),
      // 档位只允许往下调：填大的会被核心拒，界面原样复述核心回的那一档，不自己抬
      h("input", {
        class: "input",
        id: "budget-input",
        type: "number",
        min: "0",
        step: "1",
        placeholder: "收紧预算到",
        value: self.budgetDraft,
        onInput: (e) => (self.budgetDraft = e.target.value),
      }),
      el("button", "btn", "收紧预算", { id: "apply-budget", onClick: self.setBudget }),
      el("span", "note", self.budgetNote, { id: "budget-note" }),
      el("span", "badge", "turn " + turnState, { id: "turn-state" }),
      el("span", "badge" + (u.over ? " badge-warn" : ""), usageText, { id: "turn-usage" }),
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
