/* 渲染层：Vue 3 运行时构建 + h()（CSP 禁 unsafe-eval，所以不带运行时模板编译器）。
   这里不持有会话真源——消息列表只来自核心投影，流式文本只来自 turn/poll，
   工具与审批态只来自 extension/list 与 extension/call 的实际应答。 */
"use strict";
const { createApp, h, ref, onMounted, withDirectives } = window.Vue;
const nativePlatform = new URLSearchParams(location.search).get('platform') || 'web';

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
      if (m.attachments?.length) {
        children.push(h('div',{class:'attachments-rail history-attachments',role:'group','aria-label':'消息附件'},m.attachments.map((a,index)=>a.kind==='image'?h('article',{class:'history-image-entry','data-history-attachment':a.attachmentId,'data-attachment-kind':a.kind,key:index},[
          h(window.SaCodeAttachments.PersistedImage,{attachment:a,sessionId:m.sessionId,label:'历史图片'}),
          h('span',{class:'attachments-fileBody'},[h('span',{class:'attachments-name'},a.name||'图片附件'),h('span',{class:'attachments-meta'},`${a.width} × ${a.height} · ${a.bytes} B`)]),
        ]):h('article',{class:'attachments-fileCard','data-history-attachment':a.attachmentId,'data-attachment-kind':a.kind,key:index},[
          h('span',{class:'attachments-fileIcon','aria-hidden':true},a.kind==='image'?'▧':'▤'),
          h('span',{class:'attachments-fileBody'},[
            h('span',{class:'attachments-name',title:a.name},a.name||(a.kind==='image'?'图片附件':'文件附件')),
            h('span',{class:'attachments-meta'},a.kind==='image'?`${a.width} × ${a.height} · ${a.bytes} B · 图片引用`:`${a.bytes} B`),
          ]),
        ]))));
      }
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
const CLIENT_VIEWS = window.SaCodeSlots.createConversationAssembly();

createApp({
  setup() {
    window.Vue.onBeforeUnmount(() => CLIENT_VIEWS.dispose());
    const proj = ref({ projection: 0, events: 0, durable: 0, pending: 0, truncatedTail: false, messages: [] });
    const scrollSession = ref(0), followingTail = ref(true);
    // 投影行 → 气泡消息。这只是同一份 proj.messages 的视图派生：不写日志、不发协议帧。
    const bubbleMessages = window.Vue.computed(() => FOLD.toBubbleMessages(proj.value.messages || [], proj.value.messageRows, String(scrollSession.value)));
    const readPreview = window.Vue.computed(() => FOLD.latestReadPreview(proj.value.messages || [], proj.value.messageRows));
    const tools = ref([]);
    const detailName = ref("");
    const sideTab = ref("inspect");
    const viewport = ref(window.innerWidth), sidebarWidth = ref(280), rightWidth = ref(null);
    const sidebarClosed = ref(false), narrowExpanded = ref(false), sideOpen = ref(false), diagnosticsOpen = ref(false);
    const workspaceSessionLimits = ref(new Map());
    const sidebarCollapsed = window.Vue.computed(() => sidebarClosed.value || (viewport.value < 1024 && !narrowExpanded.value));
    const frameColumns = window.Vue.computed(() => window.SaCodeFrame.columns(viewport.value, sidebarCollapsed.value ? 0 : sidebarWidth.value,
      sideOpen.value ? rightWidth.value ?? viewport.value * .45 : 0, nativePlatform==='win32' || nativePlatform==='darwin' ? 0 : 56));
    function toggleSidebar() {
      if (viewport.value < 1024) { narrowExpanded.value = sidebarCollapsed.value; sidebarClosed.value = false; }
      else sidebarClosed.value = !sidebarClosed.value;
    }
    const updateViewport = () => { viewport.value = window.innerWidth; if(viewport.value >= 1024) narrowExpanded.value = false; };
    let frameDrag = null;
    function beginFrameResize(side, event) {
      if(event.button !== 0) return;
      event.preventDefault(); frameDrag?.abort(); frameDrag = new AbortController();
      const start=event.clientX, base=side==='sidebar'?sidebarWidth.value:frameColumns.value.rightbar;
      const {signal}=frameDrag;
      const move=e=>{
        if(side==='sidebar') sidebarWidth.value=window.SaCodeFrame.clamp(base+e.clientX-start,264,420);
        else rightWidth.value=window.SaCodeFrame.clamp(base-e.clientX+start,300,viewport.value*.7);
      };
      const stop=()=>{frameDrag?.abort();frameDrag=null;};
      window.addEventListener('pointermove',move,{signal}); window.addEventListener('pointerup',stop,{signal}); window.addEventListener('pointercancel',stop,{signal});
    }
    function resizeFrameKey(side,event) {
      if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return;
      event.preventDefault();
      const left=side==='sidebar', min=left?264:300, max=left?420:viewport.value*.7;
      const base=left?sidebarWidth.value:frameColumns.value.rightbar;
      const delta=(event.key==='ArrowRight'?16:-16)*(left?1:-1);
      const value=event.key==='Home'?min:event.key==='End'?max:base+delta;
      if(left) sidebarWidth.value=window.SaCodeFrame.clamp(value,min,max); else rightWidth.value=window.SaCodeFrame.clamp(value,min,max);
    }
    onMounted(()=>window.addEventListener('resize',updateViewport));
    window.Vue.onBeforeUnmount(()=>{window.removeEventListener('resize',updateViewport);frameDrag?.abort();});
    const sideSplit = ref(false);
    const sideRatio = ref(50);
    const previewFloating = ref(false);
    const settingsOpen = ref(false);
    const pluginManagerOpen = ref(false);
    const settingsTab = ref("general");
    const catalogOpen = ref(false), catalog = ref(null), catalogBusy = ref(false), catalogNote = ref("");
    let sessionGeneration = 0;
    let selectedScrollId = 'initial';
    const workspaceOpen=ref(false), workspace=ref(null), workspaceBusy=ref(false), workspaceNote=ref("");
    async function refreshWorkspace() {
      const generation=sessionGeneration, result=await window.dsh.workspaceGet();
      if(generation===sessionGeneration) workspace.value=result;
    }
    async function openWorkspace() {
      workspaceOpen.value=true;
      try {await refreshWorkspace(); await refreshCatalog();} catch(e) {workspaceNote.value=catalogError(e);}
    }
    async function chooseWorkspace() {
      if(sendBusy.value || workspaceBusy.value || budgetBusy.value || appearanceBusy.value || turn.value.running || approval.value) return;
      workspaceBusy.value=true; workspaceNote.value="请选择项目目录…";
      try {
        const result=await window.dsh.workspaceChoose();
        if(result.cancelled) {workspaceNote.value="已取消选择，目录未变更。";return;}
        await refreshWorkspace(); await refresh(); await refreshTools(); await refreshCatalog();
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
        "selection-flush-failed":"会话选择保存失败，请重启后检查日志。", "flush-failed":"当前会话保存失败，尚未切换。",
        "attachment-receipt-unknown":"附件凭证已失效，请重新上传。", "attachment-media-type-mismatch":"附件内容与所选类型不符。",
        "attachment-unsupported-media-type":"图片暂时只支持 PNG、JPEG、GIF。", "attachment-bad-base64":"附件读取失败，请重试。",
        "attachment-image-too-large":"单张图片不能超过 20 MB。", "attachment-image-count-exceeded":"一条消息最多 20 张图片。",
        "attachment-image-bytes-exceeded":"一条消息的图片合计不能超过 200 MB。", "attachment-image-pixels-exceeded":"图片像素超过 6400 万。",
        "attachment-image-dimension-exceeded":"图片单边不能超过 8192 像素。", "attachment-corrupt-object":"附件内容校验不通过，请重新上传。",
        "attachment-missing-object":"附件对象已不在盘上，请重新上传。"};
      return Object.entries(reasons).find(([key])=>message.includes(key))?.[1] || message;
    }
    async function applySelection(id) {
      if (turn.value.running || approval.value) throw new Error("请先结算执行任务并处理待审批工单。");
      if (sendBusy.value || budgetBusy.value || appearanceBusy.value || workspaceBusy.value) throw new Error("正在处理当前会话，请稍后切换。");
      const oldId=catalog.value?.entries.find(item=>item.current)?.id;
      await window.dsh.sessionSelect(id);
      sessionGeneration += 1;
      selectedScrollId=id;
      if (oldId) sessionDrafts.set(oldId,draft.value);
      // 换会话时把在途增强撤掉：那份迟到结果属于上一个会话的输入框，
      // 留在宿主槽位里既会顶掉下一次的发起，也可能落进别的草稿。
      if (enhance.value.busy) { window.dsh.promptCancel().catch(() => {}); }
      clearEnhance();
      draft.value=sessionDrafts.get(id)||"";
      stopPolling(); foldOpen.ids.clear();
      turn.value={running:false,settled:false,text:"",finishReason:"",cancelled:false,interrupted:false,delivered:0};
      approval.value=null; outcome.value=""; outcomeKind.value=""; error.value="";
      previewFloating.value=false; detailName.value=""; budgetDraft.value=""; budgetNote.value=""; appearanceNote.value="";
      catalogNote.value="已切换，正在加载会话…";
      queuePending.value=[];
      clearAttachments();
      await refresh(); await refreshTools(); await refreshUsage(); await refreshWorkspace(); await refreshQueue();
      await refreshGlobalAppearance();
      workspaceNote.value="";
      catalog.value=await window.dsh.sessionCatalog();
      catalogOpen.value=false;
      window.Vue.nextTick(()=>document.getElementById('composer').focus());
    }
    async function selectSession(id) {
      if (catalogBusy.value) return;
      if(catalog.value?.entries.some(item=>item.current && item.id===id)) return;
      catalogBusy.value=true; catalogNote.value="正在保存并切换会话…";
      try { await applySelection(id); }
      catch(e) { catalogNote.value=catalogError(e); error.value=catalogNote.value; }
      finally { catalogBusy.value=false; }
    }
    async function createSession() {
      if (catalogBusy.value || !newSessionTitle.value.trim()) return;
      catalogBusy.value=true; catalogNote.value="正在新建会话…";
      try {
        if (turn.value.running || approval.value) throw new Error("请先结算执行任务并处理待审批工单。");
        if (sendBusy.value || budgetBusy.value || appearanceBusy.value || workspaceBusy.value) throw new Error("正在处理当前会话，请稍后新建。");
        const created=await window.dsh.sessionCreate(newSessionTitle.value);
        newSessionTitle.value="";
        catalog.value=await window.dsh.sessionCatalog();
        await applySelection(created.id);
      } catch(e) { catalogNote.value=catalogError(e); error.value=catalogNote.value; }
      finally { catalogBusy.value=false; }
    }
    async function startNewSession() {
      if(sendBusy.value || catalogBusy.value || budgetBusy.value || appearanceBusy.value || workspaceBusy.value || turn.value.running || approval.value) return;
      newSessionTitle.value='新会话';
      await createSession();
    }
    async function refreshCatalog() {
      if (catalogBusy.value) return;
      catalogBusy.value = true; catalogNote.value = "正在读取本地会话…";
      try {
        catalog.value = await window.dsh.sessionCatalog();
        if(selectedScrollId==='initial') {
          selectedScrollId=catalog.value.entries.find(item=>item.current)?.id || 'initial';
          scrollSession.value=selectedScrollId;
        }
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
      sideOpen.value = true;
      sideTab.value = target === "guide-panel" ? "guide" : target === "preview-panel" ? "preview" : "inspect";
      window.Vue.nextTick(() => {
        const panel = document.getElementById(target);
        if (panel) { panel.focus({ preventScroll: true }); panel.scrollIntoView({ block: "nearest" }); }
      });
    }
    // 详情始终从当前核心清单派生；卸载后不继续展示过期副本。
    const detailTool = window.Vue.computed(() => tools.value.find((tool) => tool.name === detailName.value) || null);
    const toolCounters = ref({ misses: 0, guardDenials: 0 });
    const draft = ref(""), sendBusy=ref(false);
    // 队列面板只显示核心的投影；pending 只是「自己刚发出去还没回执」的回声
    const queueRows = ref([]), queuePending = ref([]);
    // 附件轨：字节只在上传那一刻过界一次，之后渲染层手里只有宿主发的凭证与引用。
    const attachments = ref([]), uploads = ref({});
    let attSeq = 0;
    const IMAGE_MIME = ["image/png", "image/jpeg", "image/gif"];
    const kindOf = (file) => (IMAGE_MIME.includes(file.type) ? "image" : "file");
    function readAsBase64(file) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          // reader.result 是只读访问器，写它会在回调里抛 TypeError 让这条 Promise 永不结算
          const text = String(reader.result || "");
          const comma = text.indexOf(",");
          if (comma < 0) { reject(new Error("附件读取失败")); } else { resolve(text.slice(comma + 1)); }
        };
        reader.onerror = () => reject(new Error("附件读取失败"));
        reader.readAsDataURL(file);
      });
    }
    async function uploadAttachment(item, file) {
      const generation = sessionGeneration;
      try {
        const data = await readAsBase64(file);
        const kind = kindOf(file);
        const out = await window.dsh.attachmentUpload(kind, file.name || "", kind === "image" ? file.type : "", data);
        if (generation !== sessionGeneration) { return; }
        item.receiptId = out.receiptId;
        item.attachment = out.attachment;
        if (kind === "image" && !item.previewUrl) { item.previewUrl = URL.createObjectURL(file); }
        uploads.value = { ...uploads.value, [item.id]: { status: "ready" } };
      } catch (e) {
        if (generation !== sessionGeneration) { return; }
        uploads.value = { ...uploads.value, [item.id]: { status: "error", message: catalogError(e) } };
        error.value = catalogError(e);
      }
    }
    function addAttachments(files, directories) {
      for (const file of files) {
        const item = { id: "a" + (++attSeq), kind: kindOf(file), file, previewUrl: "" };
        attachments.value = [...attachments.value, item];
        uploads.value = { ...uploads.value, [item.id]: { status: "uploading" } };
        void uploadAttachment(item, file);
      }
      // 文件夹不是附件：上游这条线只收文件，所以明说而不是静默吞掉。
      if (directories && directories.length) {
        error.value = "只接受文件，文件夹不入库：" + directories.map((d) => d.name).join("、");
      }
    }
    function removeAttachment(id) {
      const gone = attachments.value.find((a) => a.id === id);
      if (gone && gone.previewUrl) { URL.revokeObjectURL(gone.previewUrl); }
      attachments.value = attachments.value.filter((a) => a.id !== id);
      const rest = { ...uploads.value };
      delete rest[id];
      uploads.value = rest;
    }
    function retryAttachment(id) {
      const item = attachments.value.find((a) => a.id === id);
      if (!item) { return; }
      uploads.value = { ...uploads.value, [id]: { status: "uploading" } };
      void uploadAttachment(item, item.file);
    }
    function clearAttachments() {
      for (const item of attachments.value) {
        if (item.previewUrl) { URL.revokeObjectURL(item.previewUrl); }
      }
      attachments.value = [];
      uploads.value = {};
    }
    let rpcSeq = 0;
    let draftRevision=0, sendTicket=0;
    function updateDraft(value) { draftRevision++; draft.value=value; }
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

    // 提示词增强：图标只有「增强」与「回退」两副面孔，判据是「上一次替换还完整地留在输入框里」。
    // 用户一改就作废——哪怕改回一模一样的字也算作废，因为从那一刻起「该不该覆盖」已经不由我们决定了。
    const enhance = ref({ busy: false, undo: false });
    let enhanceSeq = 0, enhanceTimer = null, enhanceUndo = null, enhanceFrozen = null;
    function stopEnhancePoll() { if (enhanceTimer) { clearTimeout(enhanceTimer); enhanceTimer = null; } }
    function clearEnhance() { stopEnhancePoll(); enhanceFrozen = null; enhanceUndo = null; enhance.value = { busy: false, undo: false }; }
    // 草稿的每一条改动路径都得经过这里：增强是「程序替换」，它同样是一次可撤销的编辑，
    // 但它不能把用户的编辑历史吃掉。
    function userEditDraft(value) {
      if (enhance.value.undo) { enhanceUndo = null; enhance.value = { busy: false, undo: false }; }
      updateDraft(value);
    }
    function enhanceNotice(failure, result) {
      const raw = failure ? String(failure.message || failure) : String((result && result.error) || "");
      const reasons = {
        "model-not-configured": "还没有选择模型，请先在模型中心配好再增强。",
        "model-credential-unavailable": "当前模型的密钥没有配好，增强没有发出。",
        "protocol-not-supported": "当前模型的说法暂不支持增强，草稿已保留。",
        "enhance-empty-result": "模型没有给出可用的改写，草稿保持原样。",
        "enhance-max-tokens": "改写被截断了，半截话不能替换你的草稿。",
        "enhance-unexpected-tool": "模型试图执行操作，这次增强已作废，草稿保持原样。",
        "provider-init-failed": "连不上模型，草稿已保留，可以再试一次。",
        "http-request-error": "连不上模型，草稿已保留，可以再试一次。",
        "http-status": "模型拒绝了这次请求（常见于密钥或模型名不对），草稿已保留。",
        "timeout": "模型响应超时，草稿已保留，可以再试一次。",
        "enhance-in-flight": "上一条增强还在进行，请先取消它。",
      };
      return Object.entries(reasons).find(([key]) => raw.includes(key))?.[1] || catalogError(failure || new Error(raw));
    }
    function focusComposerCaret() {
      window.Vue.nextTick(() => {
        const box = document.getElementById("composer");
        if (!box) { return; }
        box.focus();
        try { box.setSelectionRange(box.value.length, box.value.length); } catch (_) {}
      });
    }
    function finishEnhance(frozen, result, failure) {
      // 认的是那一次发起：被取消过、换过会话，迟到的结果就作废，不去动现在的输入框。
      if (enhanceFrozen !== frozen) { return; }
      enhanceFrozen = null;
      const text = result && typeof result.text === "string" ? result.text : "";
      const usable = !failure && result && result.settled !== false && result.ok && !result.cancelled && text.trim().length > 0;
      if (!usable) {
        enhance.value = { busy: false, undo: false };
        if (!(result && result.cancelled)) { error.value = enhanceNotice(failure, result); }
        return;
      }
      if (draftRevision !== frozen.revision || sessionGeneration !== frozen.generation) {
        enhance.value = { busy: false, undo: false };
        return;
      }
      if (!window.SaCodeComposerEdit.replace(document.getElementById("composer"),text)) {
        enhance.value={busy:false,undo:false};error.value="输入框无法建立撤销记录，草稿已保留。";return;
      }
      enhanceUndo = { text: frozen.original };
      enhance.value = { busy: false, undo: true };
      error.value = "";
      focusComposerCaret();
    }
    function pollEnhance(frozen) {
      enhanceTimer = setTimeout(async () => {
        enhanceTimer = null;
        if (enhanceFrozen !== frozen) { return; }
        let result = null;
        try { result = await window.dsh.promptPoll(); }
        catch (e) { finishEnhance(frozen, null, e); return; }
        if (enhanceFrozen !== frozen) { return; }
        if (!result || !result.settled) { pollEnhance(frozen); return; }
        finishEnhance(frozen, result, null);
      }, 120);
    }
    async function startEnhance() {
      const original = draft.value;
      if (!original.trim() || enhance.value.busy) { return; }
      const frozen = { seq: ++enhanceSeq, revision: draftRevision, generation: sessionGeneration, original };
      enhanceUndo = null;
      enhanceFrozen = frozen;
      enhance.value = { busy: true, undo: false };
      error.value = "";
      try { await window.dsh.promptEnhance(original); }
      catch (e) { finishEnhance(frozen, null, e); return; }
      if (enhanceFrozen === frozen) { pollEnhance(frozen); }
    }
    async function cancelEnhance() {
      const frozen = enhanceFrozen;
      if (!frozen) { return; }
      enhanceFrozen = null;
      stopEnhancePoll();
      enhance.value = { busy: false, undo: false };
      try { await window.dsh.promptCancel(); } catch (_) {}
    }
    function undoEnhance() {
      if (!enhance.value.undo || !enhanceUndo) { return; }
      const original = enhanceUndo.text;
      enhanceUndo = null;
      enhance.value = { busy: false, undo: false };
      if (!window.SaCodeComposerEdit.undo(document.getElementById("composer"),original)) updateDraft(original);
      focusComposerCaret();
    }
    function clickEnhance() {
      if (enhance.value.busy) { cancelEnhance(); }
      else if (enhance.value.undo) { undoEnhance(); }
      else { startEnhance(); }
    }

    let pollTimer = null;
    function desktopKeys(event) {
      if (event.isComposing || event.repeat || event.altKey || !(event.ctrlKey || event.metaKey)) return;
      const key=event.key.toLowerCase();
      // 增强刚替换完、用户还没再动过：Ctrl+Z 就是回退这次替换。
      // 一旦用户改过文字，这个快捷键就交回浏览器自己的撤销顺序——
      // 那时代码里的「原文」已经是历史，跳过用户的新编辑去恢复它等于删掉他刚写的东西。
      if (key === 'z' && !event.shiftKey) {
        if (enhance.value.undo && event.target && event.target.id === 'composer' && !document.querySelector('dialog:modal')) {
          event.preventDefault();
          undoEnhance();
        }
        return;
      }
      const settings=key===',' && !event.shiftKey;
      const composer=key==='l' && !event.shiftKey;
      const preview=key==='p' && event.shiftKey;
      if (!settings && !composer && !preview) return;
      event.preventDefault();
      // 模态优先：全局导航与发送不能穿透上层审批/详情/设置。
      if (document.querySelector('dialog:modal')) return;
      if (settings) settingsOpen.value=true;
      else if (composer) document.getElementById('composer').focus();
      else if (preview) openSide('preview-panel');
    }
    onMounted(() => window.addEventListener('keydown', desktopKeys));
    window.Vue.onBeforeUnmount(() => { window.removeEventListener('keydown', desktopKeys); stopPolling(); });

    async function refresh() {
      const generation=sessionGeneration, result=await window.dsh.projection();
      if (generation===sessionGeneration) {proj.value=result;scrollSession.value=selectedScrollId;}
    }

    async function refreshTools() {
      const generation=sessionGeneration;
      const r = await window.dsh.toolsList();
      if (generation!==sessionGeneration) return;
      tools.value = r.tools;
      toolCounters.value = { misses: r.misses, guardDenials: r.guardDenials };
    }

    // 排队清单只认核心的投影：条目正文、id、rpcId 全部来自宿主回执，界面不自建排队状态。
    // 上游 QueueDock 显示的是 next-turn 那一份；即时补充由核心在步边界消化，不在这张清单里。
    async function refreshQueue() {
      const generation=sessionGeneration;
      let view;
      try { view = await window.dsh.queueDescribe(); } catch (e) { return; }
      if (generation!==sessionGeneration) return;
      queueRows.value = (view.nextTurn || []).map(window.SaCodeQueue.projectQueueRow);
      const admitted = new Set(queueRows.value.map((r) => r.source.rpcId));
      queuePending.value = queuePending.value.filter((p) => !admitted.has(p.requestId));
    }

    async function updateQueue(id, action) {
      const text = action.kind === "edit" ? (action.content || []).map((b) => (b.type === "text" ? b.text || "" : "")).join("") : "";
      await window.dsh.queueUpdate(id, action.kind, text);
      await refreshQueue();
    }

    // 运行中发送 = 排队：草稿交给核心铸造条目身份，回执到了才清空草稿。
    async function enqueueDraft() {
      const text = draft.value, revision = draftRevision;
      if (!text.trim()) return;
      if (text.length > 8000) { error.value = "消息最多支持 8000 个字符，请缩短后重试。"; return; }
      if (!imageDraftAllowed()) return;
      const requestId = "r" + (++rpcSeq);
      error.value = "";
      // 回合运行中发的图不能被丢掉：与发送那条路径同一道准入——没就绪就挡在这一步，
      // 就绪了就把宿主发放的凭证一起交出去（凭证只能来自本宿主，界面自报没有通路）。
      if (attachments.value.some((a) => !a.receiptId)) {
        error.value = attachments.value.some((a) => (uploads.value[a.id] || {}).status === "error")
          ? "有附件上传失败，请重试或先移除" : "附件还在上传，请等它就绪";
        return;
      }
      const receipts = attachments.value.map((a) => a.receiptId);
      queuePending.value = queuePending.value.concat([{ requestId, placement: "queued", text, attachments: [] }]);
      try {
        await window.dsh.queueEnqueue(text, requestId, receipts);
        if (draftRevision === revision) { clearEnhance(); updateDraft(""); }
        clearAttachments();
        await refreshQueue();
      } catch (e) {
        queuePending.value = queuePending.value.filter((p) => p.requestId !== requestId);
        error.value = "排队失败：" + cleanErr(e);
      }
    }

    // 模型页的每一次读写都穿过宿主：渲染层不留第二份提供商状态。
    // 宿主错误码要翻成页面认识的两类——「别人先改过」与「内容不合法」是两句不同的话。
    const modelsError = (error) => {
      const text = String((error && error.message) || error);
      const code = /settings-conflict/.test(text) ? "model-conflict" : /read-only/.test(text) ? "model-read-only" : "";
      return code ? Object.assign(Error(text), { code }) : error;
    };
    const modelsAdapter = {
      async load() {
        const view = await window.dsh.modelsDescribe().catch(modelsError);
        const catalogView = await window.dsh.modelsCatalog().catch(modelsError);
        const catalog = Array.isArray(catalogView) ? catalogView : [];
        const byId = {};
        for (const c of catalog) byId[c.id] = c;
        const providers = (view.providers || []).map((p) => {
          const base = byId[p.id];
          return { ...p, defaultModels: base ? base.models : undefined,
            modelsCustomized: base ? JSON.stringify(p.models) !== JSON.stringify(base.models) : true };
        });
        return { providers, catalog, revision: view.revision, writable: view.writable };
      },
      async save(draft, expectedRevision) {
        const { key, ...rest } = draft;
        await window.dsh.modelsSave(rest, key || "", expectedRevision).catch(modelsError);
        void modelDirectory.load();
      },
      async remove(id, expectedRevision) {
        await window.dsh.modelsRemove(id, expectedRevision).catch(modelsError);
        void modelDirectory.load();
      },
      async listModels(draft) {
        const r = await window.dsh.modelsList({ baseUrl: draft.baseUrl, apiKey: draft.key }).catch(modelsError);
        return (r.models || []).map((id) => ({ id, name: id, contextWindow: "", maxTokens: "", image: false }));
      },
    };

    // 输入区的模型选择器共用同一份注册表：选定即写默认指针，下一轮请求就按它装配。
    // 目录状态只在宿主里，这里只做快照投影与订阅通知，不留第二份「已选模型」。
    const modelDirectory = (() => {
      let snapshot = { current: null, groups: [], failures: [], status: "idle", pending: null, error: null, routable: null };
      const listeners = new Set();
      let revision = 0, seq = 0;
      const publish = (next) => { snapshot = next; for (const fn of listeners) fn(); };
      const apply = (view) => {
        revision = view.revision;
        const groups = (view.providers || []).map((p) => ({
          id: p.id, name: p.name || p.id, credentialKind: "api-key",
          models: (p.models || []).map((m) => ({ id: m.id, name: m.name || m.id, image: m.image === true })),
        }));
        const chosen = view.defaultProviderId && view.defaultModel
          ? { provider: view.defaultProviderId, model: view.defaultModel } : null;
        const routable = groups.some((g) => chosen && g.id === chosen.provider
          && g.models.some((m) => m.id === chosen.model));
        publish({ current: chosen, groups, failures: [], status: "ready", pending: null, error: null, routable });
      };
      return {
        getSnapshot: () => snapshot,
        subscribe(invalidate) { listeners.add(invalidate); return () => listeners.delete(invalidate); },
        async load() {
          const generation = ++seq;
          publish({ ...snapshot, status: "loading" });
          try {
            const view = await window.dsh.modelsDescribe();
            if (generation === seq) apply(view);
          } catch (e) {
            if (generation === seq) publish({ ...snapshot, status: "error", error: String((e && e.message) || e) });
          }
        },
        async select(value) {
          if (!value || !value.provider || !value.model) throw Error("bad-model-selection");
          const generation = ++seq;
          publish({ ...snapshot, status: "selecting", pending: value });
          try {
            const view = await window.dsh.modelsSetDefault(value.provider, value.model, revision);
            if (generation === seq) apply(view);
          } catch (e) {
            if (generation === seq) publish({ ...snapshot, status: "error", pending: null, error: String((e && e.message) || e) });
            throw e;
          }
        },
      };
    })();
    void modelDirectory.load();

    function imageDraftAllowed() {
      if (!attachments.value.some((a) => a.kind === 'image')) return true;
      const view = modelDirectory.getSnapshot();
      const group = view.groups.find((g) => g.id === view.current?.provider);
      const model = group?.models.find((m) => m.id === view.current?.model);
      if (view.status === 'ready' && model?.image === true) return true;
      error.value = "当前模型未声明支持图片，请选择支持图片的模型或移除图片附件。";
      return false;
    }
    void refreshQueue();

    async function send() {
      if(sendBusy.value) return;
      if(turn.value.running){await enqueueDraft();return;}
      const generation=sessionGeneration;
      const text = draft.value, revision=draftRevision;
      if (!text.trim()) return;
      const ticket=++sendTicket;
      if (!imageDraftAllowed()) return;
      let acknowledged=false;
      // 附件还没落盘就不能发：宁可挡在发送这一步，也不发一条引用了不存在对象的消息
      if (attachments.value.some((a) => !a.receiptId)) {
        error.value = attachments.value.some((a) => (uploads.value[a.id] || {}).status === "error")
          ? "有附件上传失败，请重试或先移除" : "附件还在上传，请等它就绪";
        return;
      }
      const receipts = attachments.value.map((a) => a.receiptId);
      sendBusy.value=true;
      error.value = "";
      try {
        // 渲染层只说「用户说了什么」加上自己拿到的凭证，事件类型由核心决定：不给它伪造 system/message 的口子
        await window.dsh.userSend(text, receipts);
        if (generation!==sessionGeneration) return;
        acknowledged=true;
        sendBusy.value=false;
        // 核心确认成功后才清空；在途请求不能覆盖用户随后编辑的新草稿。
        if(draftRevision===revision) { clearEnhance(); updateDraft(""); }
        clearAttachments();
        await refresh();
        await refreshCatalog();
        // 消息落进会话只是半件事：产品链路上发完就要起一轮，否则装了也收不到答复。
        await startTask();
      } catch (e) {
        if (generation!==sessionGeneration || ticket!==sendTicket) return;
        error.value = acknowledged ? "消息已发送，暂时无法刷新会话。" : text.length>8000 ? "消息最多支持 8000 个字符，请缩短后重试。" : "消息发送失败，请稍后重试。";
      }
      finally {if(generation===sessionGeneration && ticket===sendTicket) sendBusy.value=false;}
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
            if (kind === "projection" && body === "todos") await refresh();
            // 步边界由 runner 线程摘走即时补充：正文多了已送达的一句、清单少了一条，
            // 两边都要按核心重读，不能等这一轮结算才更新。
            else if (kind === "projection" && body === "queue") { await refresh(); await refreshQueue(); }
            else if (kind === "text") turn.value.text += body;
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
            // 结算帧先到、核心已在边界摘走条目：面板要先按核心重新读一次，
            // 不能再拿上一轮的旧清单判断「还有没有下一条」。
            await refreshQueue();
            // 队列一次只消化一条（上游轮次边界口径）：正常结算后再起一轮，轮到下一条。
            // 用户按停止的那一轮不起新轮——取消是「停下」，不是「换一条继续」；
            // 排队条目留在核心面板里，下一次发送或手动起轮时才在边界被摘走。
            if (!turn.value.cancelled && queueRows.value.length) {
              await startTask();
              // 起轮即边界：核心可能刚把队首摘成一条 user/message。正文要按新投影重画、
              // 面板要按新清单收项，否则同一条消息会同时出现在正文与队列两处。
              await refresh();
              await refreshQueue();
            }
          }
        } catch (e) {
          if (generation!==sessionGeneration) return;
          error.value = String(e.message || e);
          stopPolling();
        }
      }, 60);
    }

    // 起轮的失败码来自核心，界面只把它翻成人话：消息已经落进会话是事实，
    // 不能因为跑不动就装作没发过。
    const turnStartFailure = (code) => ({
      "model-not-configured": "还没有配置模型：消息已存入会话，请到设置 → 模型添加提供商并设为默认。",
      "model-credential-unavailable": "提供商还没有可用凭据：消息已存入会话，请到设置 → 模型填入 API 密钥。",
      "model-image-not-supported": "当前模型未声明支持图片：会话已保留，请选择支持图片的模型后重试。",
      "over-budget": "本轮额度已用满：消息已存入会话，请新建会话继续。",
      "turn-in-flight": "上一轮还在执行，请稍候。",
      "already-owned": "会话正被另一个入口占用，请稍候再试。",
      "replay-rejected": "会话日志回放被拒，消息未起轮；请检查会话文件是否完整。",
      "provider-init-failed": "连不上模型服务：消息已存入会话，请检查 API 地址与网络。",
      "flush-failed": "会话未能落盘，消息只在内存里可见。",
    })[code] || ("起轮失败：" + code);

    async function startTask() {
      const generation = sessionGeneration;
      error.value = "";
      turn.value = { running: true, settled: false, text: "", finishReason: "", cancelled: false, interrupted: false, delivered: 0, used: null, budget: null, verdict: "", over: false };
      try {
        await window.dsh.taskStart();
        if (generation !== sessionGeneration) return;
        startPolling();
      } catch (e) {
        if (generation !== sessionGeneration) return;
        // 宿主帧是「-32016 model-not-configured」，Electron 再套一层「Error: 」前缀，
        // 所以按「数字 + 空白 + 标识」取符号码；带后缀的（provider-init-failed:xxx）取到主码即止。
        const text = String(cleanErr(e));
        const code = text.match(/\d+\s+([a-z][a-z0-9-]*)/);
        error.value = turnStartFailure(code ? code[1] : text);
        turn.value.running = false;
      }
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
      const args = name === "read" ? "sacode-tool.txt" : "sacode-tool.txt hello-from-renderer";
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
      frameColumns, sidebarWidth, sidebarCollapsed, toggleSidebar, beginFrameResize, resizeFrameKey, sideOpen, diagnosticsOpen, startNewSession,
      proj, scrollSession, followingTail, tools, detailName, detailTool, sideTab, sideSplit, sideRatio, beginResize, openSide, toolCounters, draft, updateDraft, userEditDraft, enhance, clickEnhance, sendBusy, error, approval, outcome, outcomeKind, turn, attachments, uploads, addAttachments, removeAttachment, retryAttachment,
      usage, budgetDraft, budgetNote, budgetBusy, setBudget, bubbleMessages, readPreview, previewFloating, settingsOpen, settingsTab, pluginManagerOpen,
      appearanceBusy, appearanceNote, setTheme, modelsAdapter, modelDirectory,
      globalAppearance, fontBusy, fontNote, setFontSize, refreshGlobalAppearance,
      catalogOpen, catalog, catalogBusy, catalogNote, refreshCatalog, openCatalog, newSessionTitle, createSession, selectSession,
      workspaceOpen, workspace, workspaceBusy, workspaceNote, openWorkspace, chooseWorkspace, workspaceSessionLimits,
      send, runTurn, cancelTurn, askTool, answerTool,
      queueRows, queuePending, updateQueue,
    };
  },
  render() {
    const self = this;
    const currentTitle = self.catalog?.entries.find(item=>item.current)?.title || "会话";
    const emptyConversation = !self.proj.messages.length && !self.turn.running && !self.turn.text;
    const sessionLocked = self.sendBusy || self.catalogBusy || self.budgetBusy || self.appearanceBusy || self.workspaceBusy || self.turn.running || !!self.approval;
    const workspaceName = self.workspace?.configured ? self.workspace.directory.split(/[\\/]/).filter(Boolean).pop() : '工作区';
    // 默认空日志尚未形成持久会话，不在产品导航里制造一条占位会话。
    const sidebarSessions = (self.catalog?.entries || []).filter(item=>item.durable>0);
    // 分组键来自核心的逐会话工作区投影；不根据当前目录或路径相似度猜测归属。
    const workspaceGroups = new Map();
    for (const item of sidebarSessions) {
      const directory = item.workspaceDirectory || '';
      if (!workspaceGroups.has(directory)) workspaceGroups.set(directory, []);
      workspaceGroups.get(directory).push(item);
    }
    if (self.workspace?.configured && !workspaceGroups.has(self.workspace.directory)) workspaceGroups.set(self.workspace.directory, []);
    const renderSession = item=>el('button','sidebar-session'+(item.current?' selected':''),[navIcon('M4 4h16v12H9l-5 4z'),el('span',null,item.title||'未命名会话')],{
      'data-sidebar-session':item.id,'aria-current':item.current?'page':null,title:item.title||'未命名会话',disabled:sessionLocked||item.status==='replay-rejected',onClick:()=>self.selectSession(item.id)});
    const head = el("header", "top", [
      el("div", "heading", [el("h1", null, currentTitle, {id:"current-session-title", title:currentTitle, hidden:emptyConversation})]),
      el("div", "header-utilities", [
        el('button','frame-icon',[navIcon('M5 18V9 M12 18V4 M19 18v-6 M3 21h18')],{id:'open-budget','aria-label':'用量与预算',tooltip:{label:'用量与预算'},onClick:()=>self.openSide('budget-panel')}),
        el('button','frame-icon',[navIcon('M4 4h16v16H4z M14 4v16')],{id:'toggle-side','aria-label':self.sideOpen?'关闭侧栏':'打开侧栏','aria-expanded':self.sideOpen,tooltip:{label:self.sideOpen?'关闭侧栏':'打开侧栏'},onClick:()=>{self.sideOpen=!self.sideOpen;}}),
        self.approval ? el('button','frame-icon pending-approval',[navIcon('M12 3l10 18H2z M12 9v5 M12 17v1')],{'aria-label':'处理待审批请求',onClick:()=>self.openSide('tools-panel')}) : null,
      ]),
    ]);
    const nav = el("nav", "navigation", [
      el('div','sidebar-brand-row',[
        el("button", "brand", [h("img", { src: "assets/sacode-logo.png", alt: "SaCode", width: 24, height: 24 }), el("span", null, "SaCode")],{'aria-label':self.sidebarCollapsed?'打开侧边栏':'SaCode · 新建会话',onClick:()=>self.sidebarCollapsed?self.toggleSidebar():self.startNewSession()}),
        el('button','frame-icon sidebar-toggle',[navIcon('M4 4h16v16H4z M9 4v16')],{id:'toggle-sidebar','aria-label':self.sidebarCollapsed?'打开侧边栏':'收起侧边栏',tooltip:{label:self.sidebarCollapsed?'打开侧边栏':'收起侧边栏',side:'right'},onClick:self.toggleSidebar}),
      ]),
      el('button','nav-item new-session',[navIcon('M12 5v14 M5 12h14'),el('span','nav-label','新会话')],{id:'sidebar-new-session','aria-label':'新建会话',disabled:sessionLocked,onClick:self.startNewSession}),
      el('button','nav-item nav-panel',[navIcon('M9 3h6v6h6v6h-6v6H9v-6H3V9h6z'),el('span','nav-label','工具与扩展')],{'aria-label':'工具与扩展','aria-pressed':self.pluginManagerOpen,onClick:()=>{self.pluginManagerOpen=!self.pluginManagerOpen;}}),
      el('div','workspace-heading',[
        el('span','nav-label','工作区'),
        el('button','frame-icon',[navIcon('M11 4a7 7 0 1 0 0 14a7 7 0 1 0 0-14 M16 16l5 5')],{id:'open-catalog','aria-label':'本地会话列表',onClick:self.openCatalog}),
        el('button','frame-icon',[navIcon('M3 7h8l2 2h8v12H3z M17 2v6 M14 5h6')],{id:'open-workspace','aria-label':'当前会话工作区',onClick:self.openWorkspace}),
      ]),
      el('div','sidebar-session-list',[
        ...[...workspaceGroups].map(([directory,items])=>{
          const limit=self.workspaceSessionLimits.get(directory) ?? 5;
          let idle=0;
          const visible=items.filter(item=>item.current&&self.turn.running || idle++<limit);
          const hidden=items.length-visible.length;
          const label=directory ? directory.split(/[\\/]/).filter(Boolean).pop() || directory : '未分组';
          return el('section','workspace-group',[
            el('div','workspace-folder',[navIcon('M3 5h7l2 3h9v12H3z'),el('span',null,label)],{title:directory||'尚未绑定项目目录的会话'}),
            ...visible.map(renderSession),
            items.length>5 ? el('button','workspace-overflow',hidden ? `显示更多（${hidden}）` : '收起会话',{
              'data-workspace-overflow':directory,'aria-expanded':hidden===0,onClick:()=>self.workspaceSessionLimits.set(directory,hidden ? limit+5 : 5)}) : null,
          ],{'data-workspace-group':directory});
        }),
        !sidebarSessions.length ? el('div','sidebar-empty',[navIcon('M4 5h16v14H4z M8 9h8 M8 13h8'),el('span',null,'暂无会话')]) : null,
        self.catalogNote && self.catalogNote.includes('失败') ? el('p','note',self.catalogNote,{role:'status'}) : null,
      ]),
      el('div','nav-settings-row',[el("button", "nav-item nav-settings", [navIcon("M9 3h6l1 4 4 1v6l-4 1-1 4H9l-1-4-4-1V8l4-1 1-4z M9 11a3 3 0 1 0 6 0a3 3 0 1 0-6 0") , el("span", "nav-label", "设置")], { id: "open-settings", "aria-label": "SaCode 设置", "aria-keyshortcuts":"Control+, Meta+,", tooltip:{label:'设置',side:'right',shortcutKeys:['Ctrl','+',',']}, onClick: () => { self.settingsOpen = true; } })]),
    ], { "aria-label": "工作区与会话导航" });

    // 分组策略用库内置的 consecutive（连续同角色合并），不自造分组器。
    // 组标签走 prefix 槽，内容是「组内条数 × 映射角色」——两个数都能从投影数出来，
    // 不是第二真源。autoScroll 关掉：滚动由唯一 conversation-scroll 宿主管理。
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

    // 会话正文和驻留输入区在同一滚动宿主中，输入 DOM 跨空会话/活跃会话保持不变。
    const transcript = el('div','conversation-content',[el("div", "stream", msgs, { id: "messages" }), streamBox],{hidden:emptyConversation});

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
      el('details','diagnostics',[
        el('summary',null,'开发诊断'),
        el('p','note','以下轮次使用示例输出，用于验证核心执行、取消和持久化。'),
        turnBar,
        el('div','counters',[
          el('span','badge','事件 '+self.proj.events,{id:'count-events'}),
          el('span','badge','已保存 '+self.proj.durable,{id:'count-durable'}),
          el('span','badge'+(self.proj.pending?' badge-warn':' badge-ok'),'待保存 '+self.proj.pending,{id:'count-pending'}),
          el('span','badge'+(self.proj.truncatedTail?' badge-danger':''),self.proj.truncatedTail?'尾帧已截断':'记录完整',{id:'count-tail'}),
        ]),
      ],{id:'developer-diagnostics',open:self.diagnosticsOpen,onToggle:e=>{self.diagnosticsOpen=e.target.open;}}),
    ], { id: "side-page-inspect", role: "tabpanel", "aria-labelledby": "side-tab-inspect", hidden: self.sideTab !== "inspect" });
    const guide = el("div", "side-page", [
      el("section", "side-section", [
        el("h2", null, "SaCode 使用指南"),
        self.approval ? el("button", "btn", "返回处理待审批请求", { id: "guide-approval", onClick: () => self.openSide("tools-panel") }) : null,
        ...[
          ["记录任务", "在底部输入任务或补充信息，点击发送后写入当前本地会话。发送消息与启动执行是两个独立操作。"],
          ["运行与停止", "侧栏的开发诊断可验证执行与取消。当前轮次使用示例输出，真实模型任务尚未开放；执行中可点击输入区停止按钮。"],
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
      el('button','frame-icon','×',{id:'close-side','aria-label':'关闭侧栏',onClick:()=>{self.sideOpen=false;window.Vue.nextTick(()=>document.getElementById('toggle-side').focus());}}),
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
      hidden:!self.sideOpen || self.frameColumns.rightbar===0,
    });

    const composer = el("footer", "composer", [
      emptyConversation ? el('div','hero-heading',[h('img',{src:'assets/sacode-logo.png',alt:'SaCode',width:32,height:32}),el('span',null,'探索未至之境')]) : null,
      emptyConversation ? el('div','hero-workspace-row',[
        el('button','workspace-chip',[navIcon('M3 5h7l2 3h9v12H3z'),el('span',null,self.workspace?.configured?workspaceName:'选择工作区'),el('span','chip-chevron','⌄')],{'aria-label':'选择工作区',title:self.workspace?.directory,onClick:self.openWorkspace}),
      ]) : null,
      h(window.SaCodeTodo.TodoPanel,{key:'todos-'+self.scrollSession,todos:Array.isArray(self.proj.todos)?self.proj.todos:[]}),
      h(window.SaCodeQueue.QueueDock,{key:'queue-'+self.scrollSession,sessionId:String(self.scrollSession),rows:self.queueRows,pending:self.queuePending,running:self.turn.running,mutable:true,updateQueue:self.updateQueue,onNotice:(_kind,text)=>{self.error=text;}}),
      el("label", "composer-label", "发送消息", { for: "composer" }),
      el("div", "composer-card", [withDirectives(h("textarea", {
        class: "input",
        id: "composer",
        rows: 1,
        "aria-keyshortcuts":"Enter Control+Enter Meta+Enter",
        placeholder: "描述你的任务或补充信息…",
        value: self.draft,
        onInput: (e) => self.userEditDraft(e.target.value),
      }),[[autoDraftSize],[window.SaCodeAttachments.keymapDirective,{
        canSubmit:()=>!self.sendBusy&&!document.querySelector('dialog:modal'),
        submit:()=>self.send(),
      }]]),
      h(window.SaCodeAttachments.Composer,{key:'attachments-'+self.scrollSession,active:!self.pluginManagerOpen,canAcceptDrop:true,showAdd:false,attachments:self.attachments,uploads:self.uploads,limits:{count:20,size:'20 MB'},onAdd:(files,dirs)=>self.addAttachments(files,dirs),onRemove:(id)=>self.removeAttachment(id),onRetry:(id)=>self.retryAttachment(id)}),
      el("div", "composer-controls", [h(window.SaCodeAttachments.AddButton,{disabled:false,onAdd:(files,dirs)=>self.addAttachments(files,dirs)}),h(window.SaCodeModelSelect.Select,{key:self.scrollSession,directory:self.modelDirectory,locked:self.turn.running}),el("div", "composer-trailing", [el("button", "composer-enhance", [h('svg',{width:16,height:16,viewBox:'0 0 16 16','aria-hidden':'true'},[
        // 同一颗图标位换三副面孔：进行中转圈、可回退时换回退箭头，用户一改就转回增强。
        self.enhance.busy
          ? h('path',{d:'M8 1.6a6.4 6.4 0 1 1-6.3 7.5',fill:'none',stroke:'currentColor','stroke-width':'1.6','stroke-linecap':'round'})
          : self.enhance.undo
            ? h('path',{d:'M6.2 3.4 2.7 6.9l3.5 3.5M3 6.9h6.6a3.1 3.1 0 0 1 0 6.2H7.7',fill:'none',stroke:'currentColor','stroke-width':'1.5','stroke-linecap':'round','stroke-linejoin':'round'})
            : h('path',{d:'M7 1.5l1.4 3.6 3.6 1.4-3.6 1.4L7 11.5 5.6 7.9 2 6.5l3.6-1.4L7 1.5zM12.6 10.2l.7 1.7 1.7.7-1.7.7-.7 1.7-.7-1.7-1.7-.7 1.7-.7.7-1.7z',fill:'currentColor'}),
      ])], { id: "composer-enhance", type:'button', 'aria-label':self.enhance.busy?'取消增强':(self.enhance.undo?'回退增强':'增强提示词'), 'aria-busy':self.enhance.busy, 'data-state':self.enhance.busy?'busy':(self.enhance.undo?'undo':'ready'),
        disabled:!self.enhance.busy && !self.enhance.undo && !self.draft.trim(),
        tooltip:{label:self.enhance.busy?'取消增强':(self.enhance.undo?'回退增强（Ctrl+Z）':'用当前模型把这条说得更清楚'),side:'top',delayMs:500},
        // 与发送按钮一样不把焦点从输入框挪走：增强完还要接着改草稿。
        onMousedown:e=>e.preventDefault(),onClick:()=>self.clickEnhance() }),el("button", "composer-primary", [h('svg',{width:16,height:16,viewBox:'0 0 16 16','aria-hidden':'true'},[
        self.turn.running && !self.draft.trim()
          ? h('rect',{x:3,y:3,width:10,height:10,rx:3,fill:'currentColor'})
          : h('path',{d:'M8.3125 0.980183C8.66767 1.0531 8.97902 1.20418 9.2627 1.43233C9.48724 1.61297 9.73029 1.85793 9.97949 2.10714L14.707 6.83468L13.293 8.24874L9 3.95577V15.0417H7V3.95577L2.70703 8.24874L1.29297 6.83468L6.02051 2.10714C6.26971 1.85793 6.51277 1.61297 6.7373 1.43233C6.97662 1.23986 7.28445 1.04402 7.6875 0.980183C7.8973 0.947006 8.1031 0.95516 8.3125 0.980183Z',fill:'currentColor'}),
      ])], { id: "send", type:'button', 'aria-label':self.turn.running && !self.draft.trim()?'停止执行':'发送消息', 'aria-busy':self.sendBusy, disabled:self.sendBusy || (!self.turn.running && !self.draft.trim()),
        tooltip:{label:self.turn.running && !self.draft.trim()?'停止执行':'发送消息',side:'top',delayMs:500},
        // 鼠标发送不挪走输入焦点，键盘仍可 Tab 到可用的发送/停止按钮。
        onMousedown:e=>e.preventDefault(),onClick:()=>self.turn.running && !self.draft.trim()?self.cancelTurn():self.send() })])]),
      ]),
      h(window.SaCodeContextMeter.ContextMeter,{key:'context-'+self.scrollSession}),
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
      el("div", "settings-tabs", [["general", "通用设置"], ["models", "模型"], ["plugins", "内置插件"]].map(([id,label],index,tabs) => el("button", "settings-tab", [el('span','settings-nav-icon',null,{'aria-hidden':'true',style:{maskImage:`url('./assets/settings-${id}.svg')`}}),el('span','settings-nav-label',label)], {
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
        el('section','settings-row language-settings',[el('span','settings-row-title','语言'),el('output','settings-fixed-value','中文',{'aria-label':'界面语言'})]),
        el("section", "appearance-settings", [el("h2", "appearance-title", "外观"),
          el("div", "theme-choices", [["light","浅色"],["dark","深色"],["system","跟随系统"]].map(([id,label]) =>
            el("button", "theme-choice", [el('span','theme-icon',null,{'aria-hidden':'true',style:{maskImage:`url('./assets/theme-${id}.svg')`}}),el('span','theme-label',label)], { id:"theme-"+id, type:'button', "aria-pressed":self.globalAppearance.theme===id,
              disabled:self.appearanceBusy || self.fontBusy || self.globalAppearance.theme===null, onClick:()=>self.setTheme(id) })), { "aria-label":"全局主题" }),
          el("p", "note settings-feedback", self.appearanceNote, { id:"appearance-note", "aria-live":"polite" }),
        ], { "aria-busy":self.appearanceBusy }),
        el('section','font-settings',[
          el('div','font-row',[
            el('div','font-row-text',[el('label','font-title','字号大小',{id:'font-title'}),el('p','font-description','仅影响会话内容的字号')]),
            el('div','font-control',[
              el('div','font-stepper',[
                el('span','font-value',self.globalAppearance.fontSize===null?'—':String(self.globalAppearance.fontSize),{id:'font-value','aria-labelledby':'font-title'}),
                el('span','font-arrows',[[1,'增大正文字号','font-increase','M2 6l3-3 3 3'],[-1,'减小正文字号','font-decrease','M2 3l3 3 3-3']].map(([delta,label,id,path])=>window.SaCodeTooltip.wrap(h('button',{id,class:'font-arrow',type:'button','aria-label':label,disabled:self.fontBusy || self.appearanceBusy || self.globalAppearance.fontSize===null || (delta>0?self.globalAppearance.fontSize>=22:self.globalAppearance.fontSize<=10),onClick:()=>self.setFontSize(self.globalAppearance.fontSize+delta)},[h('svg',{width:9,height:9,viewBox:'0 0 10 10',fill:'none',stroke:'currentColor','stroke-width':1.4,'aria-hidden':'true'},[h('path',{d:path})])]),{label,side:'right'}))),
              ]),el('span','font-unit','像素'),
            ]),
          ]),el('p','note settings-feedback',self.fontNote,{id:'font-note','aria-live':'polite'}),
        ],{'aria-busy':self.fontBusy}),
      ], { id:"settings-page-general", role:"tabpanel", "aria-labelledby":"settings-tab-general", hidden:self.settingsTab!=="general" }),
      el("section", "settings-page", [h(window.SaCodeModels.Page, { adapter: self.modelsAdapter }),
      ], { id:"settings-page-models", role:"tabpanel", "aria-labelledby":"settings-tab-models", hidden:self.settingsTab!=="models" }),
      el("section", "settings-page", [h(window.SaCodePlugins.Page, { tools: self.tools }),
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
        el("button", "btn btn-primary", "新建会话", {id:"create-session", disabled:sessionLocked || !self.newSessionTitle.trim(), onClick:self.createSession})]),
      el("div", "catalog-list", self.catalog ? self.catalog.entries.map(item=>el("article", "catalog-card", [
        el("h3", "catalog-title", item.title || "未命名会话", {title:item.title || "未命名会话"}),
        el("span", "badge"+(item.status!=="ready" ? " badge-warn" : ""), item.current ? "当前会话" : "本地会话"),
        el("p", "note catalog-meta", item.status==="replay-rejected" ? "日志回放失败，摘要不可用" : "已保存 "+item.durable+" 条事件"+(item.status==="truncated-tail" ? " · 尾帧不完整" : "")),
        el("p", "note catalog-id", item.id==="current" ? "默认会话" : "会话目录："+item.id),
        el("button", "btn catalog-select", item.current ? "已打开" : "打开会话", {"data-select-session":item.id,
          disabled:sessionLocked || item.current || item.status==="replay-rejected", onClick:()=>self.selectSession(item.id)}),
      ], {"data-session-id":item.id})) : [], {id:"catalog-list", "aria-busy":String(self.catalogBusy)}),
      self.catalog && !self.catalog.entries.length ? el("p", "empty-card", "此目录暂无落盘会话。") : null,
      el("p", "note", "切换前会保存当前会话；待审批工单和执行任务需要先处理完毕。项目目录随会话恢复。"),
    ]);
    const workspaceDialog=h(window.SaCodeDialog,{open:self.workspaceOpen,title:"SaCode 工作区",class:"workspace-dialog",onClose:()=>{self.workspaceOpen=false;}},()=>[
      el("div","catalog-toolbar",[el("h2",null,"当前会话项目目录"),el("button","btn","选择目录…",{id:"choose-workspace",disabled:sessionLocked,onClick:self.chooseWorkspace})]),
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
    const frameHandle = (name,left,value,min,max) => el('div','frame-divider',null,{id:name+'-divider',role:'separator',tabindex:0,
      'aria-label':name==='sidebar'?'调整导航宽度':'调整侧栏宽度','aria-orientation':'vertical','aria-valuemin':min,'aria-valuemax':max,'aria-valuenow':value,
      style:{left:left+'px'},onPointerdown:e=>self.beginFrameResize(name,e),onKeydown:e=>self.resizeFrameKey(name,e)});
    const main = el('section','pane conversation',[
      withDirectives(el('div','conversation-scroll',[
        h(CLIENT_VIEWS.Outlet, { owner: { transcript, activeView: 'chat' }, sessionId: self.scrollSession && self.scrollSession !== 'initial' ? String(self.scrollSession) : undefined }),
        el('div','composer-seat',[composer],{'data-composer-seat':''}),
      ]),[[window.SaCodeConversationScroll.directive,{
        session:self.scrollSession,lastUser:self.bubbleMessages.filter(m=>m.role==='user').at(-1)?.id,
        onChange:following=>{self.followingTail=following;},
      }]]),
      !self.followingTail && !emptyConversation ? el('div','to-bottom-slot',[el('button','to-bottom',[navIcon('M6 9l6 6 6-6')],{
        id:'scroll-to-bottom','aria-label':'回到最新消息',tooltip:{label:'回到最新消息'},
        onClick:()=>window.SaCodeConversationScroll.toBottom(document.querySelector('.conversation-scroll')),
      })]) : null,
      self.error ? el('p','error',self.error,{id:'error',role:'alert'}) : null,
    ]);
    const center = self.pluginManagerOpen ? el('div','conversation-center plugin-manager-center',[h(window.SaCodePluginManager.Page)],{style:{'--conversation-width':self.frameColumns.center+'px'}}) : el('div','conversation-center'+(emptyConversation?' is-empty':''),[head,main],{style:{'--conversation-width':self.frameColumns.center+'px'}});
    return el("div", "app", [el('div','window-caption',null,{'aria-hidden':'true'}),nav,center,side,
      !self.sidebarCollapsed?frameHandle('sidebar',self.frameColumns.sidebar,self.sidebarWidth,264,420):null,
      self.sideOpen&&self.frameColumns.rightbar>0?frameHandle('rightbar',self.frameColumns.sidebar+self.frameColumns.center,self.frameColumns.rightbar,300,Math.round(innerWidth*.7)):null,
      detail, floating, settings, catalogDialog, workspaceDialog],{style:{...fontAxis,gridTemplateColumns:`${self.frameColumns.sidebar}px minmax(0,1fr) ${self.frameColumns.rightbar}px`},'data-platform':nativePlatform,'data-sidebar-collapsed':String(self.sidebarCollapsed),'data-empty-conversation':String(emptyConversation),'data-catalog-ready':String(!!self.catalog)});
  },
}).mount("#app");
