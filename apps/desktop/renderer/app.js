/* 渲染层：Vue 3 运行时构建 + h()（CSP 禁 unsafe-eval，所以不带运行时模板编译器）。
   这里不持有会话真源——消息列表只来自核心投影，流式文本只来自 turn/poll，
   工具与审批态只来自 extension/list 与 extension/call 的实际应答。 */
"use strict";
const { createApp, h, ref, onMounted, withDirectives } = window.Vue;

// 高度是草稿的派生视图；只在正文或宽度变化时测量，避免轮询重置输入滚动位置。
const draftSize = new WeakMap();
const autoDraftSize = {
  mounted(node) {
    const state={text:null,width:0,font:null,frame:0,observer:null};
    const fit=()=>{
      state.frame=0;
      const width=node.getBoundingClientRect().width;
      const css=getComputedStyle(node),font=css.fontSize+'/'+css.lineHeight;
      if(state.text===node.value && Math.abs(state.width-width)<.5 && state.font===font) return;
      const top=node.scrollTop;
      node.style.height='auto';
      node.style.height=node.scrollHeight+'px';
      node.scrollTop=top;
      state.text=node.value;state.width=width;state.font=font;
    };
    state.schedule=()=>{if(!state.frame)state.frame=requestAnimationFrame(fit);};
    state.observer=new ResizeObserver(state.schedule);
    draftSize.set(node,state);state.observer.observe(node);fit();
  },
  updated(node) {draftSize.get(node)?.schedule();},
  beforeUnmount(node) {
    const state=draftSize.get(node);
    if(state){state.observer.disconnect();cancelAnimationFrame(state.frame);draftSize.delete(node);}
  },
};

const el = (tag, cls, children, extra) => {
  const props=Object.assign({class:cls},extra||{}),tooltip=props.tooltip||(cls?.split(' ').includes('nav-item')&&props['aria-label']?{label:props['aria-label'],side:'right'}:null);delete props.tooltip;
  const node=h(tag,props,children);
  return tooltip?window.SaCodeTooltip.wrap(node,tooltip):node;
};
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
      const markdown = m.role === "assistant" && state !== "folded";
      const children = [
        markdown
          ? h(window.SaCodeMarkdown.Body, { text, "data-msg-id": id, "data-source-role": m.sourceRole || "", "data-fold-state": state })
          : h("p", { class: "msg-text", "data-msg-id": id, "data-source-role": m.sourceRole || "", "data-fold-state": state }, expanded ? text : plan.shown),
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
    const settingsOpen = ref(false);
    const settingsTab = ref("general");
    const catalogOpen = ref(false), catalog = ref(null), catalogBusy = ref(false), catalogNote = ref("");
    let sessionGeneration = 0;
    const workspaceOpen=ref(false), workspace=ref(null), workspaceBusy=ref(false), workspaceNote=ref("");
    async function refreshWorkspace() {
      const generation=sessionGeneration, result=await window.dsh.workspaceGet();
      if(generation===sessionGeneration) workspace.value=result;
    }
    async function openWorkspace() {
      workspaceOpen.value=true;
      try {await refreshWorkspace();} catch(e) {workspaceNote.value=catalogError(e);}
    }
    async function chooseWorkspace() {
      if(workspaceBusy.value || budgetBusy.value || appearanceBusy.value || turn.value.running || approval.value) return;
      workspaceBusy.value=true; workspaceNote.value="请选择项目目录…";
      try {
        const result=await window.dsh.workspaceChoose();
        if(result.cancelled) {workspaceNote.value="已取消选择，目录未变更。";return;}
        await refreshWorkspace(); await refresh(); await refreshTools();
        workspaceNote.value="已保存当前会话的项目目录。";
      } catch(e) {workspaceNote.value=catalogError(e);}
      finally {workspaceBusy.value=false;}
    }
    const newSessionTitle = ref("");
    const sessionDrafts = new Map();
    function catalogError(e) {
      const message=String(e.message || e);
      const reasons={"selection-replay-rejected":"所选会话无法读取，请从会话列表选择可用会话。", "selection-failed-restart-required":"会话选择保存失败，请重启后继续。",
        "workspace-flush-failed":"项目目录保存失败，请重启后检查会话日志。", "workspace-failed-restart-required":"项目目录保存失败，请重启后继续。", "bad-workspace-directory":"请选择存在的项目文件夹。",
        "session-resources-in-flight":"请先处理审批工单并关闭在途扩展。", "turn-in-flight":"请先停止当前执行并等待结算。", "already-owned":"会话正在由另一写者使用，请稍后重试。",
        "bad-session-title":"请输入有效的会话名称。", "replay-rejected":"会话日志无法回放，已保留原会话。", "unknown-session":"会话目录不存在，请刷新列表。",
        "selection-flush-failed":"会话选择保存失败，请重启后检查日志。", "flush-failed":"当前会话保存失败，尚未切换。"};
      return Object.entries(reasons).find(([key])=>message.includes(key))?.[1] || message;
    }
    async function applySelection(id) {
      if (turn.value.running || approval.value) throw new Error("请先结算执行任务并处理待审批工单。");
      if (budgetBusy.value || appearanceBusy.value || workspaceBusy.value) throw new Error("正在保存当前会话配置，请稍后切换。");
      const oldId=catalog.value?.entries.find(item=>item.current)?.id;
      await window.dsh.sessionSelect(id);
      sessionGeneration += 1;
      if (oldId) sessionDrafts.set(oldId,draft.value);
      draft.value=sessionDrafts.get(id)||"";
      stopPolling(); foldOpen.ids.clear();
      turn.value={running:false,settled:false,text:"",finishReason:"",cancelled:false,interrupted:false,delivered:0};
      approval.value=null; outcome.value=""; outcomeKind.value=""; error.value="";
      previewFloating.value=false; detailName.value=""; budgetDraft.value=""; budgetNote.value=""; appearanceNote.value="";
      catalogNote.value="已切换，正在加载会话…";
      await refresh(); await refreshTools(); await refreshUsage(); await refreshWorkspace();
      await refreshGlobalAppearance();
      workspaceNote.value="";
      catalog.value=await window.dsh.sessionCatalog();
      catalogOpen.value=false;
      window.Vue.nextTick(()=>document.getElementById('composer').focus());
    }
    async function selectSession(id) {
      if (catalogBusy.value) return;
      catalogBusy.value=true; catalogNote.value="正在保存并切换会话…";
      try { await applySelection(id); }
      catch(e) { catalogNote.value=catalogError(e); }
      finally { catalogBusy.value=false; }
    }
    async function createSession() {
      if (catalogBusy.value || !newSessionTitle.value.trim()) return;
      catalogBusy.value=true; catalogNote.value="正在新建会话…";
      try {
        if (turn.value.running || approval.value) throw new Error("请先结算执行任务并处理待审批工单。");
        if (budgetBusy.value || appearanceBusy.value || workspaceBusy.value) throw new Error("正在保存当前会话配置，请稍后新建。");
        const created=await window.dsh.sessionCreate(newSessionTitle.value);
        newSessionTitle.value="";
        catalog.value=await window.dsh.sessionCatalog();
        await applySelection(created.id);
      } catch(e) { catalogNote.value=catalogError(e); }
      finally { catalogBusy.value=false; }
    }
    async function refreshCatalog() {
      if (catalogBusy.value) return;
      catalogBusy.value = true; catalogNote.value = "正在读取本地会话…";
      try {
        catalog.value = await window.dsh.sessionCatalog();
        catalogNote.value = "已读取落盘会话；列表不包含尚未保存的事件。";
      } catch (e) { catalogNote.value = "读取失败：" + String(e.message || e); }
      finally { catalogBusy.value = false; }
    }
    function openCatalog() { catalogOpen.value = true; refreshCatalog(); }
    const globalAppearance = ref({theme:null,fontSize:null}), fontBusy=ref(false), fontNote=ref('');
    function fontError(e) {
      const message=String(e.message||e);
      if(message.includes('settings-already-owned')) return '另一入口正在保存配置，请稍后重试。';
      if(message.includes('settings-replay-rejected')) return '全局外观配置损坏，未保存变更。';
      return '无法读取或保存全局外观配置，请检查用户配置目录。';
    }
    async function refreshGlobalAppearance() {
      try {globalAppearance.value=await window.dsh.globalAppearanceGet();}
      catch(e) {fontNote.value=fontError(e);}
    }
    async function setFontSize(value) {
      if(fontBusy.value || appearanceBusy.value) return;
      fontBusy.value=true; fontNote.value='正在保存全局正文字号…';
      try {
        globalAppearance.value=await window.dsh.globalAppearanceSetFontSize(value);
        fontNote.value='已保存全局正文字号。';
      } catch(e) {fontNote.value=fontError(e);}
      finally {fontBusy.value=false;}
    }
    const appearanceBusy = ref(false), appearanceNote = ref("");
    async function setTheme(theme) {
      if (appearanceBusy.value || fontBusy.value) return;
      appearanceBusy.value=true; appearanceNote.value="正在保存全局主题…";
      try {
        globalAppearance.value=await window.dsh.globalAppearanceSetTheme(theme);
        appearanceNote.value="已保存全局主题，切换会话后保持。";
      } catch(e) { appearanceNote.value=fontError(e); }
      finally { appearanceBusy.value=false; }
    }
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
    const budgetBusy = ref(false);

    let pollTimer = null;
    function desktopKeys(event) {
      if (event.isComposing || event.repeat || event.altKey || !(event.ctrlKey || event.metaKey)) return;
      const key=event.key.toLowerCase();
      const settings=key===',' && !event.shiftKey;
      const composer=key==='l' && !event.shiftKey;
      const preview=key==='p' && event.shiftKey;
      const submit=key==='enter' && !event.shiftKey && event.target.id==='composer';
      if (!settings && !composer && !preview && !submit) return;
      event.preventDefault();
      // 模态优先：全局导航与发送不能穿透上层审批/详情/设置。
      if (document.querySelector('dialog[open][aria-modal="true"]')) return;
      if (settings) settingsOpen.value=true;
      else if (composer) document.getElementById('composer').focus();
      else if (preview) openSide('preview-panel');
      else send();
    }
    onMounted(() => window.addEventListener('keydown', desktopKeys));
    window.Vue.onBeforeUnmount(() => { window.removeEventListener('keydown', desktopKeys); stopPolling(); });

    async function refresh() {
      const generation=sessionGeneration, result=await window.dsh.projection();
      if (generation===sessionGeneration) proj.value=result;
    }

    async function refreshTools() {
      const generation=sessionGeneration;
      const r = await window.dsh.toolsList();
      if (generation!==sessionGeneration) return;
      tools.value = r.tools;
      toolCounters.value = { misses: r.misses, guardDenials: r.guardDenials };
    }

    async function send() {
      const generation=sessionGeneration;
      const text = draft.value;
      if (!text.trim()) return;
      draft.value = "";
      error.value = "";
      try {
        // 渲染层只说「用户说了什么」，事件类型由核心决定：不给它伪造 system/message 的口子
        await window.dsh.userSend(text);
        if (generation!==sessionGeneration) return;
        await refresh();
      } catch (e) {
        if (generation!==sessionGeneration) return;
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
      const generation=sessionGeneration;
      pollTimer = setInterval(async () => {
        try {
          const p = await window.dsh.turnPoll();
          if (generation!==sessionGeneration) return;
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
          if (generation!==sessionGeneration) return;
          error.value = String(e.message || e);
          stopPolling();
        }
      }, 60);
    }

    async function runTurn(limit) {
      const generation=sessionGeneration;
      error.value = "";
      turn.value = { running: true, settled: false, text: "", finishReason: "", cancelled: false, interrupted: false, delivered: 0, used: null, budget: null, verdict: "", over: false };
      try {
        await window.dsh.turnStart(limit);
        if (generation!==sessionGeneration) return;
        startPolling();
      } catch (e) {
        if (generation!==sessionGeneration) return;
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
      const generation=sessionGeneration;
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
        if (generation!==sessionGeneration) return;
        approval.value = { name: t.name, description: t.description, approvalId: a.approvalId };
      } catch (e) {
        if (generation!==sessionGeneration) return;
        approval.value = null;
        outcomeKind.value = "outcome outcome-denied";
        outcome.value = "发号失败：" + cleanErr(e);
      }
    }

    async function answerTool(approvalAnswer) {
      const generation=sessionGeneration;
      const a = approval.value;
      approval.value = null;
      if (!a) return;
      try {
        const r = await window.dsh.approvalAnswer(a.approvalId, approvalAnswer);
        if (generation!==sessionGeneration) return;
        if (!r.accepted) {
          outcomeKind.value = "outcome outcome-denied";
          outcome.value = "应答未被接受：工单状态 " + r.state;
          return;
        }
      } catch (e) {
        if (generation!==sessionGeneration) return;
        outcomeKind.value = "outcome outcome-denied";
        outcome.value = "应答失败：" + cleanErr(e);
        return;
      }
      // 批过的和拒的都真的走一次调用：放行才执行，拒绝要当场看到核心把它挡下来
      await callTool(a.name, a.approvalId);
    }

    async function callTool(name, approvalId) {
      const generation=sessionGeneration;
      if (!name) return;
      // 各工具按自己的参数契约给 args：只读工具的路径就是整串参数，
      // 把「路径 正文」一起塞给它，它会把整串当成一个不存在的路径。
      const args = name === "read" ? "dsh-tool.txt" : "dsh-tool.txt hello-from-renderer";
      try {
        const r = await window.dsh.toolCall(name, args, approvalId || 0);
        if (generation!==sessionGeneration) return;
        outcomeKind.value = "";
        outcome.value = "结果：" + r.result;
      } catch (e) {
        if (generation!==sessionGeneration) return;
        outcomeKind.value = "outcome outcome-denied";
        outcome.value = "被拒：" + cleanErr(e);
      }
      await refreshTools();
      await refresh();
    }

    async function refreshUsage() {
      const generation=sessionGeneration;
      const u = await window.dsh.usageStatus();
      if (generation!==sessionGeneration) return;
      usage.value = { used: u.used, budget: u.budget, over: !!u.over, verdict: u.verdict || "" };
    }

    // 收紧预算：填进来的数字交给核心判，界面只复述核心回的那一档，绝不自己抬。
    async function setBudget() {
      if (budgetBusy.value) return;
      const raw = String(budgetDraft.value);
      const n = Number(raw);
      if (raw === "" || !Number.isInteger(n) || n < 0) {
        budgetNote.value = "预算要填非负整数";
        return;
      }
      budgetBusy.value = true;
      budgetNote.value = "正在提交预算…";
      try {
        const r = await window.dsh.usageSetBudget(n);
        await refreshUsage();
        budgetNote.value = r.applied ? "已收紧到 " + r.budget : "拒绝放宽：仍停在 " + r.budget;
      } catch (e) {
        budgetNote.value = cleanErr(e);
      } finally {
        budgetBusy.value = false;
      }
    }

    onMounted(async () => {
      await refreshGlobalAppearance();
      try {
        await refresh();
        await refreshTools();
        // 开机就把账读出来：重启后「已经花掉多少、停在哪个档」不该等到跑完一轮才知道
        await refreshUsage();
        await refreshCatalog();
        await refreshWorkspace();
      } catch (e) {
        error.value = catalogError(e);
      }
    });

    return {
      proj, tools, detailName, detailTool, sideTab, sideSplit, sideRatio, beginResize, openSide, toolCounters, draft, error, approval, outcome, outcomeKind, turn,
      usage, budgetDraft, budgetNote, budgetBusy, setBudget, bubbleMessages, readPreview, previewFloating, settingsOpen, settingsTab,
      appearanceBusy, appearanceNote, setTheme,
      globalAppearance, fontBusy, fontNote, setFontSize, refreshGlobalAppearance,
      catalogOpen, catalog, catalogBusy, catalogNote, refreshCatalog, openCatalog, newSessionTitle, createSession, selectSession,
      workspaceOpen, workspace, workspaceBusy, workspaceNote, openWorkspace, chooseWorkspace,
      send, runTurn, cancelTurn, askTool, answerTool,
    };
  },
  render() {
    const self = this;
    const currentTitle = self.catalog?.entries.find(item=>item.current)?.title || "会话";
    const head = el("header", "top", [
      el("div", "heading", [el("h1", null, currentTitle, {id:"current-session-title", title:currentTitle}), el("span", "note", "消息与执行记录")]),
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
      el("button", "nav-item nav-settings", [navIcon("M3 5h7l2 3h9v12H3V5z"), el("span", "nav-label", "会话列表")], { id:"open-catalog", "aria-label":"本地会话列表", onClick:self.openCatalog }),
      el("button", "nav-item nav-settings", [navIcon("M3 7h18v14H3V7z M8 7V3h8v4"), el("span", "nav-label", "工作区")], {id:"open-workspace", "aria-label":"当前会话工作区", onClick:self.openWorkspace}),
      el("a", "nav-item", [navIcon("M14 4a6 6 0 0 0-7 8L3 16l5 5 5-5a6 6 0 0 0 7-7l-4 4-4-4 4-4z"), el("span", "nav-label", "工具与审批")], { href: "#tools-panel", "aria-label": "工具与审批", onClick: (e) => { e.preventDefault(); self.openSide("tools-panel"); } }),
      el("a", "nav-item", [navIcon("M5 18V9 M12 18V4 M19 18v-6 M3 21h18"), el("span", "nav-label", "用量与预算")], { href: "#budget-panel", "aria-label": "用量与预算", onClick: (e) => { e.preventDefault(); self.openSide("budget-panel"); } }),
      el("a", "nav-item", [navIcon("M4 4h6l2 2 2-2h6v15h-6l-2 2-2-2H4V4z M12 6v15"), el("span", "nav-label", "使用指南")], { href: "#guide-panel", "aria-label": "使用指南", onClick: (e) => { e.preventDefault(); self.openSide("guide-panel"); } }),
      el("button", "nav-item nav-settings", [navIcon("M9 3h6l1 4 4 1v6l-4 1-1 4H9l-1-4-4-1V8l4-1 1-4z M9 11a3 3 0 1 0 6 0a3 3 0 1 0-6 0") , el("span", "nav-label", "设置")], { id: "open-settings", "aria-label": "SaCode 设置", "aria-keyshortcuts":"Control+, Meta+,", tooltip:{label:'设置',side:'right',shortcutKeys:['Ctrl','+',',']}, onClick: () => { self.settingsOpen = true; } }),
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

    // 干净收束后正文已落进会话日志、由投影给出那一份气泡，回显框必须撤掉：
    // 留着它等于界面上同一句助手话有两份来源，其中一份重启就没了。
    // 取消的一轮不落 assistant/message，半截正文只能继续由回显框呈现。
    const persisted = self.turn.settled && !self.turn.cancelled;
    const streamBox = self.turn.running || (self.turn.text && !persisted)
      ? [h(window.SaCodeMarkdown.Stream, { text: self.turn.text, running: self.turn.running })]
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
    const renderBudget = (prefix) => el("section", "side-section", [
      el("h2", null, "用量与预算"),
      el("span", "badge" + (u.over ? " badge-warn" : ""), usageText, { id: prefix === "budget" ? "turn-usage" : prefix + "-usage", "aria-live": "polite" }),
      el("label", "field-label", "收紧预算", { for: prefix + "-input" }),
      el("div", "budget-controls", [
      h("input", {
        class: "input",
        id: prefix + "-input",
        type: "number",
        min: "0",
        step: "1",
        placeholder: "收紧预算到",
        value: self.budgetDraft,
        disabled: self.budgetBusy,
        onInput: (e) => (self.budgetDraft = e.target.value),
      }),
      el("button", "btn", "收紧预算", { id: prefix === "budget" ? "apply-budget" : prefix + "-apply", onClick: self.setBudget, disabled: self.budgetBusy }),
      ]),
      el("p", "note", self.budgetNote || "预算只能收紧；耗尽后停止执行。", { id: prefix + "-note", "aria-live": "polite" }),
    ], { id: prefix + "-panel", tabindex: -1, "aria-busy": self.budgetBusy });
    const budgetBox = renderBudget("budget");

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
        tooltip:{label:label + (id === "inspect" && self.approval ? "，待审批" : ""),side:'bottom'},
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
          ["快捷键", "Ctrl+, 打开设置；Ctrl+L 聚焦输入；Ctrl+Shift+P 打开文档预览；输入区 Ctrl+Enter 发送。弹窗打开时全局操作暂停，Escape 只关闭最上层。"],
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
      el("label", "composer-label", "发送消息", { for: "composer" }),
      el("div", "composer-card", [withDirectives(h("textarea", {
        class: "input",
        id: "composer",
        rows: 1,
        "aria-keyshortcuts":"Control+Enter Meta+Enter",
        placeholder: "描述你的任务或补充信息…",
        value: self.draft,
        onInput: (e) => (self.draft = e.target.value),
      }),[[autoDraftSize]]),
      el("div", "composer-controls", [el("div", "composer-trailing", [el("button", "composer-primary", [h('svg',{width:16,height:16,viewBox:'0 0 16 16','aria-hidden':'true'},[
        self.turn.running && !self.draft.trim()
          ? h('rect',{x:3,y:3,width:10,height:10,rx:3,fill:'currentColor'})
          : h('path',{d:'M8.3125 0.980183C8.66767 1.0531 8.97902 1.20418 9.2627 1.43233C9.48724 1.61297 9.73029 1.85793 9.97949 2.10714L14.707 6.83468L13.293 8.24874L9 3.95577V15.0417H7V3.95577L2.70703 8.24874L1.29297 6.83468L6.02051 2.10714C6.26971 1.85793 6.51277 1.61297 6.7373 1.43233C6.97662 1.23986 7.28445 1.04402 7.6875 0.980183C7.8973 0.947006 8.1031 0.95516 8.3125 0.980183Z',fill:'currentColor'}),
      ])], { id: "send", type:'button', 'aria-label':self.turn.running && !self.draft.trim()?'停止执行':'发送消息', disabled:!self.turn.running && !self.draft.trim(),
        tooltip:{label:self.turn.running && !self.draft.trim()?'停止执行':'发送消息',side:'top',delayMs:500},
        // 鼠标发送不挪走输入焦点，键盘仍可 Tab 到可用的发送/停止按钮。
        onMousedown:e=>e.preventDefault(),onClick:()=>self.turn.running && !self.draft.trim()?self.cancelTurn():self.send() })])]),
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
    const settings = h(window.SaCodeDialog, { open: self.settingsOpen, title: "SaCode 设置", class: "settings-dialog", customFrame:true,
      onClose: () => { self.settingsOpen = false; } }, () => [
      el('nav','settings-nav',[
      el('h2','settings-title','SaCode 设置'),
      el("div", "settings-tabs", [["general", "通用"], ["models", "模型"], ["plugins", "工具与扩展"]].map(([id,label],index,tabs) => el("button", "settings-tab", [el('span','settings-nav-icon',null,{'aria-hidden':'true',style:{maskImage:`url('./assets/settings-${id}.svg')`}}),el('span','settings-nav-label',label)], {
        id: "settings-tab-"+id, role: "tab", "aria-selected": self.settingsTab===id,
        type:'button',autofocus:self.settingsTab===id,
        "aria-controls": "settings-page-"+id, tabindex: self.settingsTab===id ? 0 : -1,
        onClick: () => { self.settingsTab=id; },
        onKeydown: e => {
          const offset=['ArrowRight','ArrowDown'].includes(e.key)?1:['ArrowLeft','ArrowUp'].includes(e.key)?-1:0;
          if (!offset && e.key!=='Home' && e.key!=='End') return;
          e.preventDefault();
          const next=e.key==='Home'?0:e.key==='End'?tabs.length-1:(index+offset+tabs.length)%tabs.length;
          self.settingsTab=tabs[next][0]; window.Vue.nextTick(()=>document.getElementById('settings-tab-'+self.settingsTab).focus());
        },
      })), { role: "tablist", "aria-label": "设置分类",'aria-orientation':'vertical' }),
      ]),
      el('div','settings-content',[
      el('header','dialog-header settings-header',[
        el('button','settings-close',[h('svg',{width:14,height:14,viewBox:'0 0 16 16',fill:'none',stroke:'currentColor','stroke-width':1,'aria-hidden':'true'},[h('path',{d:'M2.5 2.5L13.5 13.5M13.5 2.5L2.5 13.5'})])],{type:'button','aria-label':'关闭SaCode 设置',onClick:()=>{self.settingsOpen=false;}}),
      ]),
      el('div','dialog-body settings-options',[
      el("section", "settings-page", [
        el("section", "appearance-settings", [el("h2", "appearance-title", "主题（全局）"),
          el("div", "theme-choices", [["light","亮色"],["dark","深色"],["system","跟随系统"]].map(([id,label]) =>
            el("button", "theme-choice", [el('span','theme-icon',null,{'aria-hidden':'true',style:{maskImage:`url('./assets/theme-${id}.svg')`}}),el('span','theme-label',label)], { id:"theme-"+id, type:'button', "aria-pressed":self.globalAppearance.theme===id,
              disabled:self.appearanceBusy || self.fontBusy || self.globalAppearance.theme===null, onClick:()=>self.setTheme(id) })), { "aria-label":"全局主题" }),
          el("p", "note", self.appearanceNote || "选择保存在用户配置；切换会话和重新打开后保持。旧会话主题记录保留，不覆盖全局主题。", { id:"appearance-note", "aria-live":"polite" }),
        ], { "aria-busy":self.appearanceBusy }),
        renderBudget("settings-budget"),
        el('section','font-settings',[
          el('div','font-row',[
            el('div','font-row-text',[el('label','font-title','正文字号（全局）',{id:'font-title'}),el('p','font-description','调整消息和输入区正文；按钮、标签与代码字号保持不变。')]),
            el('div','font-control',[
              el('div','font-stepper',[
                el('span','font-value',self.globalAppearance.fontSize===null?'—':String(self.globalAppearance.fontSize),{id:'font-value','aria-labelledby':'font-title'}),
                el('span','font-arrows',[[1,'增大正文字号','font-increase','M2 6l3-3 3 3'],[-1,'减小正文字号','font-decrease','M2 3l3 3 3-3']].map(([delta,label,id,path])=>window.SaCodeTooltip.wrap(h('button',{id,class:'font-arrow',type:'button','aria-label':label,disabled:self.fontBusy || self.appearanceBusy || self.globalAppearance.fontSize===null || (delta>0?self.globalAppearance.fontSize>=22:self.globalAppearance.fontSize<=10),onClick:()=>self.setFontSize(self.globalAppearance.fontSize+delta)},[h('svg',{width:9,height:9,viewBox:'0 0 10 10',fill:'none',stroke:'currentColor','stroke-width':1.4,'aria-hidden':'true'},[h('path',{d:path})])]),{label,side:'right'}))),
              ]),el('span','font-unit','像素'),
            ]),
          ]),el('p','note',self.fontNote || '范围 10–22 像素，切换会话和重新打开后保持。',{id:'font-note','aria-live':'polite'}),
        ],{'aria-busy':self.fontBusy}),
        el("p", "note", "用量和预算来自当前会话，变更由核心校验。这里的设置与右侧预算区同步。"),
      ], { id:"settings-page-general", role:"tabpanel", "aria-labelledby":"settings-tab-general", hidden:self.settingsTab!=="general" }),
      el("section", "settings-page", [el("h2", null, "模型配置尚未开放"),
        el("p", "note", "当前执行轮次使用示例输出。真实模型配置接入后，才能设置服务地址、模型和凭证。"),
      ], { id:"settings-page-models", role:"tabpanel", "aria-labelledby":"settings-tab-models", hidden:self.settingsTab!=="models" }),
      el("section", "settings-page", [el("h2", null, "当前可用工具"),
        ...self.tools.map(t=>el("article", "settings-tool", [el("h3", null, ({read:"读取文件",write:"写入文件"}[t.name]||t.name)),
          el("p", "note", t.description||"核心未提供说明"), el("span", "badge", t.needsApproval?"需一次性审批":"免审批"),
        ], {key:t.name, "data-tool-name":t.name})),
        el("p", "note", "清单来自当前核心。扩展安装、启用和卸载设置尚未开放。"),
      ], { id:"settings-page-plugins", role:"tabpanel", "aria-labelledby":"settings-tab-plugins", hidden:self.settingsTab!=="plugins" }),
      ]),
      ]),
    ]);
    const catalogDialog = h(window.SaCodeDialog, { open:self.catalogOpen, title:"SaCode 本地会话", class:"catalog-dialog",
      onClose:()=>{self.catalogOpen=false;} }, ()=>[
      el("div", "catalog-toolbar", [el("h2", null, "落盘会话"), el("button", "btn", self.catalogBusy ? "读取中…" : "刷新", {
        id:"refresh-catalog", disabled:self.catalogBusy, onClick:self.refreshCatalog })]),
      self.catalog ? el("p", "note catalog-root", "目录："+self.catalog.root, {id:"catalog-root"}) : null,
      el("p", "note", self.turn.running || self.approval ? "请先结算执行任务并处理待审批工单。" : self.budgetBusy || self.appearanceBusy ? "正在保存当前会话配置，请稍后切换。" : self.catalogNote, {id:"catalog-note", role:"status", "aria-live":"polite"}),
      el("label", "field-label", "新会话名称", {for:"new-session-title"}),
      el("div", "catalog-create", [el("input", "input", null, {id:"new-session-title", value:self.newSessionTitle, maxlength:80, disabled:self.catalogBusy,
        placeholder:"例如：整理项目文档", onInput:e=>{self.newSessionTitle=e.target.value;} }),
        el("button", "btn btn-primary", "新建会话", {id:"create-session", disabled:self.catalogBusy || self.budgetBusy || self.appearanceBusy || self.workspaceBusy || self.turn.running || !!self.approval || !self.newSessionTitle.trim(), onClick:self.createSession})]),
      el("div", "catalog-list", self.catalog ? self.catalog.entries.map(item=>el("article", "catalog-card", [
        el("h3", "catalog-title", item.title || "未命名会话", {title:item.title || "未命名会话"}),
        el("span", "badge"+(item.status!=="ready" ? " badge-warn" : ""), item.current ? "当前会话" : "本地会话"),
        el("p", "note catalog-meta", item.status==="replay-rejected" ? "日志回放失败，摘要不可用" : "已保存 "+item.durable+" 条事件"+(item.status==="truncated-tail" ? " · 尾帧不完整" : "")),
        el("p", "note catalog-id", item.id==="current" ? "默认会话" : "会话目录："+item.id),
        el("button", "btn catalog-select", item.current ? "已打开" : "打开会话", {"data-select-session":item.id,
          disabled:self.catalogBusy || self.budgetBusy || self.appearanceBusy || self.workspaceBusy || self.turn.running || !!self.approval || item.current || item.status==="replay-rejected", onClick:()=>self.selectSession(item.id)}),
      ], {"data-session-id":item.id})) : [], {id:"catalog-list", "aria-busy":String(self.catalogBusy)}),
      self.catalog && !self.catalog.entries.length ? el("p", "empty-card", "此目录暂无落盘会话。") : null,
      el("p", "note", "切换前会保存当前会话；待审批工单和执行任务需要先处理完毕。项目目录随会话恢复。"),
    ]);
    const workspaceDialog=h(window.SaCodeDialog,{open:self.workspaceOpen,title:"SaCode 工作区",class:"workspace-dialog",onClose:()=>{self.workspaceOpen=false;}},()=>[
      el("div","catalog-toolbar",[el("h2",null,"当前会话项目目录"),el("button","btn","选择目录…",{id:"choose-workspace",disabled:self.workspaceBusy || self.budgetBusy || self.appearanceBusy || self.turn.running || !!self.approval,onClick:self.chooseWorkspace})]),
      self.workspace ? el("section","workspace-panel",[
        el("span","badge"+(self.workspace.configured && !self.workspace.available ? " badge-danger" : ""),self.workspace.configured ? self.workspace.available ? "目录可用" : "目录不可用" : "尚未选择项目目录"),
        el("p","workspace-path",self.workspace.directory,{id:"workspace-directory"}),
      el("p","note",self.workspace.configured ? self.workspace.available ? "相对文件路径以此项目目录为基准。" : "保存的项目目录已不存在或无法访问。请恢复该目录，或重新选择项目目录；文件操作不会自动改用默认目录。" : "当前使用默认运行目录。选择项目目录后，相对文件路径将以项目目录为基准。",{id:"workspace-description"}),
      ]) : el("p","note","正在读取目录…"),
      el("p","note",self.turn.running || self.approval ? "请先结算执行任务并处理待审批工单。" : self.workspaceNote,{id:"workspace-note",role:"status","aria-live":"polite"}),
      el("p","note","项目目录按当前会话保存；切换会话时恢复对应目录。"),
    ]);
    const size=self.globalAppearance.fontSize;
    const fontAxis=Number.isInteger(size)?{'--fs-content':size+'px','--line-content':(size+10)+'px','--line-user':(size+8)+'px','--content-delta':(size-14)+'px'}:{};
    return el("div", "app", [nav, head, main, side, composer, detail, floating, settings, catalogDialog, workspaceDialog],{style:fontAxis});
  },
}).mount("#app");
