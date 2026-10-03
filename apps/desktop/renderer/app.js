/* 渲染层：Vue 3 运行时构建 + h()（CSP 禁 unsafe-eval，所以不带运行时模板编译器）。
   这里不持有会话真源——消息列表只来自核心投影，流式文本只来自 turn/poll，
   工具与审批态只来自 extension/list 与 extension/call 的实际应答。 */
"use strict";
const { createApp, h, ref, onMounted } = window.Vue;

const el = (tag, cls, children, extra) => h(tag, Object.assign({ class: cls }, extra || {}), children);
const roleName = (role) => ({ system: "系统", developer: "开发者", user: "用户", assistant: "助手", tool: "工具" }[role] || "系统");
const verdictName = (verdict) => ({ recorded: "已计量", "over-budget": "超出预算", absent: "未收到用量", "bad-usage": "用量格式异常" }[verdict] || "未计量");
const navIcon = (path) => h("svg", { class: "nav-symbol", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", "stroke-width": 1.6, "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true" }, [h("path", { d: path })]);

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
    const readPreview = window.Vue.computed(() => FOLD.latestReadPreview(proj.value.messages || []));
    const tools = ref([]);
    const detailName = ref("");
    const sideTab = ref("inspect");
    const sideSplit = ref(false);
    const sideRatio = ref(50);
    const previewFloating = ref(false);
    let resizeController = null;
    function beginResize(e) {
      if (e.button !== 0) return;
      e.preventDefault();
      const divider = e.currentTarget, pointerId = e.pointerId;
      divider.focus(); divider.setPointerCapture(pointerId);
      if (resizeController) resizeController.abort();
      resizeController = new AbortController();
      const signal = resizeController.signal;
      // 窗口监听同时覆盖快速越过分隔条的拖动；捕获负责窗口边缘的指针归属。
      window.addEventListener("pointermove", (move) => {
        if (move.pointerId !== pointerId || !divider.isConnected) return;
        const rect = divider.parentElement.getBoundingClientRect();
        sideRatio.value = Math.max(25, Math.min(75, Math.round((move.clientY-rect.top)/rect.height*100)));
      }, { signal });
      const stop = (end) => {
        if (end.pointerId !== pointerId) return;
        if (divider.hasPointerCapture(pointerId)) divider.releasePointerCapture(pointerId);
        resizeController.abort(); resizeController = null;
      };
      window.addEventListener("pointerup", stop, { signal });
      window.addEventListener("pointercancel", stop, { signal });
    }
    window.Vue.onBeforeUnmount(() => { if (resizeController) resizeController.abort(); });
    function openSide(target) {
      sideTab.value = target === "guide-panel" ? "guide" : target === "preview-panel" ? "preview" : "inspect";
      window.Vue.nextTick(() => {
        const panel = document.getElementById(target);
        if (panel) { panel.focus({ preventScroll: true }); panel.scrollIntoView({ block: "nearest" }); }
      });
    }
    // 详情始终从当前核心清单派生；卸载后不继续展示过期副本。
    const detailTool = window.Vue.computed(() => tools.value.find((tool) => tool.name === detailName.value) || null);
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
      proj, tools, detailName, detailTool, sideTab, sideSplit, sideRatio, beginResize, openSide, toolCounters, draft, error, approval, outcome, outcomeKind, turn,
      usage, budgetDraft, budgetNote, setBudget, bubbleMessages, readPreview, previewFloating,
      send, runTurn, cancelTurn, askTool, answerTool,
    };
  },
  render() {
    const self = this;
    const head = el("header", "top", [
      el("div", "heading", [el("h1", null, "会话"), el("span", "note", "消息与执行记录")]),
      el("div", "counters", [
        el("span", "badge", "事件 " + self.proj.events, { id: "count-events" }),
        el("span", "badge", "已保存 " + self.proj.durable, { id: "count-durable" }),
        el("span", "badge" + (self.proj.pending > 0 ? " badge-warn" : " badge-ok"), "待保存 " + self.proj.pending, { id: "count-pending" }),
        el("span", "badge" + (self.proj.truncatedTail ? " badge-danger" : ""), self.proj.truncatedTail ? "尾帧已截断" : "记录完整", { id: "count-tail" }),
      ]),
    ]);
    const nav = el("nav", "navigation", [
      el("div", "brand", [h("img", { src: "assets/sacode-logo.png", alt: "SaCode", width: 32, height: 32 }), el("span", null, "SaCode")]),
      el("p", "nav-caption", "编程工作台"),
      el("a", "nav-item nav-current", [navIcon("M4 4h16v12H9l-5 4V4z M8 8h8 M8 12h5"), el("span", "nav-label", "会话")], { href: "#composer", "aria-current": "page", "aria-label": "会话" }),
      el("a", "nav-item", [navIcon("M14 4a6 6 0 0 0-7 8L3 16l5 5 5-5a6 6 0 0 0 7-7l-4 4-4-4 4-4z"), el("span", "nav-label", "工具与审批")], { href: "#tools-panel", "aria-label": "工具与审批", onClick: (e) => { e.preventDefault(); self.openSide("tools-panel"); } }),
      el("a", "nav-item", [navIcon("M5 18V9 M12 18V4 M19 18v-6 M3 21h18"), el("span", "nav-label", "用量与预算")], { href: "#budget-panel", "aria-label": "用量与预算", onClick: (e) => { e.preventDefault(); self.openSide("budget-panel"); } }),
      el("a", "nav-item", [navIcon("M4 4h6l2 2 2-2h6v15h-6l-2 2-2-2H4V4z M12 6v15"), el("span", "nav-label", "使用指南")], { href: "#guide-panel", "aria-label": "使用指南", onClick: (e) => { e.preventDefault(); self.openSide("guide-panel"); } }),
      el("div", "nav-footer", [el("span", "note", "本地会话"), el("span", "note", "使用你的模型与服务凭证")]),
    ], { "aria-label": "工作台导航" });

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
              h("span", { class: "msg-role" }, roleName(slot.role) + " · " + (slot.messageIndexes || slot.messages || []).length + " 条消息"),
            ],
          }
        ),
      ]),
    ];

    const streamChildren = [el("span", "msg-role", "助手 · 流式输出")];
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
      ? (self.turn.cancelled ? "已取消" : self.turn.interrupted ? "已中断" : "已完成")
      : self.turn.running ? "执行中" : "就绪";
    // 用量呈现：数字与判决只来自核心（开机读 usage/status，跑完一轮取结算帧），界面不推算、不补默认值。
    // 还没拿到数时显示 ?，而不是 0/0——0/0 看起来像「已经花光了」。
    const u = self.usage;
    const usageText = "用量 " + (u.used === null ? "?" : u.used) + "/" + (u.budget === null ? "?" : u.budget)
      + " · " + verdictName(u.verdict) + (u.over ? " · 已超档" : "");
    // 超过档就不给再开新轮：界面先把按钮锁住，核心那侧的 -32014 仍是真正的闸门，
    // 两者都要在——只靠界面禁用等于换个客户端就能继续花。
    const turnLocked = self.turn.running || u.over;
    const runTurnBtn = h(TV.Button, {
      type: "primary",
      id: "run-turn",
      disabled: turnLocked,
      onClick: () => self.runTurn(5),
    }, () => (u.over ? "已超档" : "跑一轮（完整）"));
    const turnBar = el("div", "turn-actions", [
      runTurnBtn,
      el("button", "btn", "跑一轮（可取消）", { id: "run-turn-2", onClick: () => self.runTurn(2), disabled: turnLocked }),
      el("button", "btn btn-danger", "停止", { id: "stop-turn", onClick: self.cancelTurn, disabled: !self.turn.running }),
      el("span", "badge", "状态 " + turnState, { id: "turn-state", "aria-live": "polite" }),
    ]);
    const budgetBox = el("section", "side-section", [
      el("h2", null, "用量与预算"),
      el("span", "badge" + (u.over ? " badge-warn" : ""), usageText, { id: "turn-usage", "aria-live": "polite" }),
      el("label", "field-label", "收紧预算", { for: "budget-input" }),
      el("div", "budget-controls", [
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
      ]),
      el("p", "note", self.budgetNote || "预算只能收紧；耗尽后停止执行。", { id: "budget-note", "aria-live": "polite" }),
    ], { id: "budget-panel", tabindex: -1 });

    const main = el("section", "pane conversation", [
      el("div", "conversation-scroll", [el("div", "stream", msgs, { id: "messages" }), streamBox]),
      turnBar,
      self.error ? el("p", "error", self.error, { id: "error", role: "alert" }) : null,
    ]);

    const toolBtns = self.tools.map((t) =>
      el("div", "tool-card", [
      el("button", "tool", [({ read: "读取文件", write: "写入文件" }[t.name] || t.name), el("span", "tool-desc", (t.description || "") + (t.needsApproval ? " · 需审批" : " · 免审批"))], {
        id: "tool-" + t.name,
        onClick: () => self.askTool(t),
      }),
      el("button", "btn tool-detail", "查看详情", { id: "detail-" + t.name,
        "aria-label": "查看" + ({ read: "读取文件", write: "写入文件" }[t.name] || t.name) + "详情",
        onClick: () => { self.detailName = t.name; } }),
      ], { key: t.name })
    );

    const approvalBox = self.approval
      ? [el("div", "approval", [
          el("p", null, "审批：" + ({ write: "写入文件", read: "读取文件" }[self.approval.name] || self.approval.name) + "（工单 #" + self.approval.approvalId + "，一次性放行，不给永久授权）"),
          el("div", "approval-row", [
            el("button", "btn btn-primary", "允许一次", { id: "allow-once", onClick: () => self.answerTool("allowed-once") }),
            el("button", "btn btn-danger", "拒绝", { id: "deny", onClick: () => self.answerTool("denied") }),
          ]),
        ], { id: "approval" })]
      : [];

    const sideTabs = el("div", "side-tabs", [
      ...[["inspect", "工具与预算"], ["preview", "文档预览"], ["guide", "使用指南"]].map(([id, label], index, tabs) => el("button", "side-tab", [label,
        id === "inspect" && self.approval ? el("span", "pending-dot", null, { "aria-hidden": "true" }) : null], {
        id: "side-tab-" + id, role: "tab", "aria-selected": self.sideTab === id,
        "aria-label": label + (id === "inspect" && self.approval ? "，待审批" : ""),
        title: label + (id === "inspect" && self.approval ? "，待审批" : ""),
        "aria-controls": "side-page-" + id, tabindex: self.sideTab === id ? 0 : -1,
        onClick: () => { self.sideTab = id; },
        onKeydown: (e) => {
          const offset = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
          if (!offset && e.key !== "Home" && e.key !== "End") return;
          e.preventDefault();
          const next = e.key === "Home" ? 0 : e.key === "End" ? tabs.length - 1 : (index + offset + tabs.length) % tabs.length;
          self.sideTab = tabs[next][0];
          window.Vue.nextTick(() => document.getElementById("side-tab-" + self.sideTab).focus());
        },
      })),
    ], { role: "tablist", "aria-label": "右侧栏页面" });
    const inspection = el("div", "side-page", [
      el("section", "side-section", [el("h2", null, "工具与审批"),
      toolBtns,
      approvalBox,
      self.outcome ? el("div", self.outcomeKind || "outcome", self.outcome, { id: "outcome" }) : null,
      el("p", "note", "未登记 " + self.toolCounters.misses + " · 安全校验拒绝 " + self.toolCounters.guardDenials, { id: "tool-counters" }),
      ], { id: "tools-panel", tabindex: -1 }),
      budgetBox,
    ], { id: "side-page-inspect", role: "tabpanel", "aria-labelledby": "side-tab-inspect", hidden: self.sideTab !== "inspect" });
    const guide = el("div", "side-page", [
      el("section", "side-section", [
        el("h2", null, "SaCode 使用指南"),
        self.approval ? el("button", "btn", "返回处理待审批请求", { id: "guide-approval", onClick: () => self.openSide("tools-panel") }) : null,
        ...[
          ["记录任务", "在底部输入任务或补充信息，点击发送后写入当前本地会话。发送消息与启动执行是两个独立操作。"],
          ["运行与停止", "使用会话下方的运行按钮开始验证轮次；执行中可点击停止。当前轮次使用示例输出，真实模型任务尚未开放。"],
          ["工具与审批", "在工具页查看工具说明。需要审批的操作只有允许一次或拒绝两种选择；查看详情不会执行工具。"],
          ["预算与保存", "预算只能收紧。已保存表示内容已落盘，待保存表示仍有未提交记录；审批或工具调用后应留意保存状态。"],
        ].map(([title, text]) => el("article", "guide-card", [el("h3", null, title), el("p", "note", text)])),
      ], { id: "guide-panel", tabindex: -1 }),
    ], { id: "side-page-guide", role: "tabpanel", "aria-labelledby": "side-tab-guide", hidden: self.sideTab !== "guide" });
    const previewBody = (prefix) => [
      el("section", "side-section", [
        el("div", "preview-heading", [el("h2", null, "文档预览"),
          prefix !== "float-preview" ? el("button", "btn", "浮动预览", { id: prefix + "-float", onClick: () => { self.previewFloating = true; } }) : null,
        ]),
        self.readPreview ? [
          el("p", "preview-path", self.readPreview.path, { id: prefix + "-path" }),
          el("p", "note", "读取时快照 · " + self.readPreview.bytes + " 字节", { id: prefix + "-meta" }),
          el("pre", "preview-text", self.readPreview.text, { id: prefix + "-text", tabindex: 0 }),
          el("p", "note", "内容来自本地会话中的成功读取记录；文件修改后需再次读取以更新快照。"),
        ] : el("div", "empty-card", [
          el("h3", null, "暂无读取记录"),
          el("p", "note", "先在工具页读取文件，成功后这里显示会话记录中的文本快照。"),
          el("button", "btn", "查看读取工具", { onClick: () => self.openSide("tools-panel") }),
        ], { id: prefix + "-empty" }),
      ], { id: prefix + "-panel", tabindex: -1 }),
    ];
    const preview = el("div", "side-page", previewBody("preview"), { id: "side-page-preview", role: "tabpanel", "aria-labelledby": "side-tab-preview", hidden: self.sideTab !== "preview" });
    const sideToolbar = el("div", "side-toolbar", [el("span", "note", "右侧工作区"),
      el("button", "btn", self.sideSplit ? "合并窗格" : "拆分窗格", { id: "split-side", "aria-pressed": self.sideSplit,
        onClick: () => { self.sideSplit = !self.sideSplit; if (self.sideSplit) self.sideTab = "inspect"; } }),
    ]);
    const side = el("aside", "pane side", [sideToolbar, sideTabs, el("div", "side-content" + (self.sideSplit ? " side-split" : ""), [
      el("div", "side-primary", [inspection, preview, guide], { style: { flex: self.sideSplit ? self.sideRatio : 1 } }),
      self.sideSplit ? el("div", "pane-divider", null, { id: "pane-divider", role: "separator", tabindex: 0,
        "aria-label": "调整右侧窗格高度", "aria-orientation": "horizontal", "aria-valuemin": 25, "aria-valuemax": 75, "aria-valuenow": self.sideRatio,
        onKeydown: (e) => {
          if (!["ArrowUp", "ArrowDown", "Home", "End"].includes(e.key)) return;
          e.preventDefault();
          self.sideRatio = e.key === "Home" ? 25 : e.key === "End" ? 75 : Math.max(25, Math.min(75, self.sideRatio + (e.key === "ArrowDown" ? 5 : -5)));
        },
        onPointerdown: self.beginResize,
        onDblclick: () => { self.sideRatio = 50; },
      }) : null,
      self.sideSplit ? el("div", "side-secondary", previewBody("split-preview"), { role: "region", "aria-label": "文档预览副窗格", style: { flex: 100-self.sideRatio } }) : null,
    ])], {
      "aria-label": "工具、预算与指南",
    });

    const composer = el("footer", "composer", [
      el("label", "field-label", "发送消息", { for: "composer" }),
      el("div", "composer-row", [h("textarea", {
        class: "input",
        id: "composer",
        rows: 2,
        placeholder: "描述你的任务或补充信息…",
        value: self.draft,
        onInput: (e) => (self.draft = e.target.value),
      }),
      el("button", "btn btn-primary", "发送", { id: "send", onClick: self.send }),
      ]),
      el("span", "note", "支持多行输入 · 审批决定由你确认"),
    ]);

    const detail = h(window.SaCodeDialog, { open: !!self.detailTool, title: "工具详情",
      onClose: () => { self.detailName = ""; } }, () => self.detailTool ? [
        el("dl", "detail-fields", [
          el("dt", null, "工具名称"), el("dd", null, ({ read: "读取文件", write: "写入文件" }[self.detailTool.name] || self.detailTool.name)),
          el("dt", null, "协议标识"), el("dd", null, self.detailTool.name),
          el("dt", null, "说明"), el("dd", null, self.detailTool.description || "核心未提供说明"),
          el("dt", null, "执行授权"), el("dd", null, self.detailTool.needsApproval ? "每次执行需一次性审批" : "此工具免审批"),
        ]),
        el("p", "note", "详情来自核心当前工具清单；关闭弹窗不会执行工具或批准请求。"),
      ] : []);
    const floating = h(window.SaCodeDialog, { open: self.previewFloating, modal: false, adjustable: true, title: "SaCode · 文档预览",
      class: "floating-preview", onClose: () => { self.previewFloating = false; } }, () => previewBody("float-preview"));
    return el("div", "app", [nav, head, main, side, composer, detail, floating]);
  },
}).mount("#app");
