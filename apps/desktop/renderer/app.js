/* 渲染层：Vue 3 运行时构建 + h()（CSP 禁 unsafe-eval，所以不带运行时模板编译器）。
   这里不持有会话真源——消息列表只来自核心投影，流式文本只来自 turn/poll，
   工具与审批态只来自 extension/list 与 extension/call 的实际应答。 */
"use strict";
const { createApp, h, ref, onMounted, withDirectives } = window.Vue;
const nativePlatform = new URLSearchParams(location.search).get('platform') || 'web';

// Next SDK 初始化：注册 WebMCP 页面工具，让模型能调用页面工具（读 DOM、点击、输入、滚动）。
if (globalThis.__nextSDK && globalThis.__nextSDK.initializeBuiltinWebMCP) {
  try { globalThis.__nextSDK.initializeBuiltinWebMCP(); } catch(e) { /* SDK 初始化失败不阻塞应用 */ }
}

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

// 状态段的取值直接抄核心目录投影发的那三个 status，界面不另立一套状态词。

// 目录树递归渲染：目录在前文件在后，展开目录递归取下一层；数据每次都从宿主取，
// 展开态只是 UI 记忆。depth 控制缩进——不靠 CSS 嵌套，方便跨深度的对齐。
const FOLDER_ICON = "M3 5h7l2 3h9v12H3z";
const FILE_ICON = "M6 3h8l4 4v14H6zM14 3v5h4";
const formatBytes = (n) => n > 1048576 ? (n / 1048576).toFixed(1) + "MB" : n > 1024 ? (n / 1024).toFixed(1) + "KB" : n + "B";
// contextWindow 在注册表里是带后缀的字符串（"128K"/"1M"），用量条要数字分母。
// 解析规则与核心 checkCapacity 对齐：数字 + 可选单个 k/K/m/M；空串与无法解析返回 undefined。
const parseCapacity = (s) => {
  if (typeof s !== "string") return undefined;
  const m = /^(\d+(?:\.\d+)?)([kKmM])?$/.exec(s.trim());
  if (!m) return undefined;
  let n = parseFloat(m[1]);
  if (m[2] === "k" || m[2] === "K") n *= 1024;
  else if (m[2] === "m" || m[2] === "M") n *= 1024 * 1024;
  return Number.isFinite(n) && n > 0 ? Math.round(n) : undefined;
};
const renderTreeEntries = (entries, prefix, depth, ctx) => {
  const dirs = entries.filter((f) => f.isDir);
  const files = entries.filter((f) => !f.isDir);
  const indent = { style: { marginLeft: depth * 14 + "px" } };
  const nodes = [];
  for (const d of dirs) {
    const childPath = prefix ? prefix + "/" + d.name : d.name;
    const open = ctx.open.has(childPath);
    nodes.push(h("div", Object.assign({ class: "file-tree-entry file-tree-dir", role: "button", "aria-label": "目录 " + d.name, tabindex: 0, "aria-expanded": open, onClick: () => ctx.toggle(childPath), onKeydown: e => { if(e.key === "Enter" || e.key === " "){e.preventDefault();ctx.toggle(childPath);} } }, indent), [
      h("span", { class: "file-chevron" + (open ? " is-open" : ""), "aria-hidden": "true" }, open ? "▾" : "▸"),
      navIcon(FOLDER_ICON),
      h("span", null, d.name),
      h("span", { class: "file-size" }, ctx.busy === childPath ? "加载中…" : "目录"),
    ]));
    if (open) {
      const kids = ctx.children[childPath];
      if (Array.isArray(kids)) nodes.push(...renderTreeEntries(kids, childPath, depth + 1, ctx));
    }
  }
  for (const f of files) {
    nodes.push(h("div", Object.assign({ class: "file-tree-entry file-tree-file", role:"button", tabindex:0, "aria-label": "打开文件 "+f.name, onClick:()=>ctx.select?.(prefix?prefix+"/"+f.name:f.name),onKeydown:e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();ctx.select?.(prefix?prefix+"/"+f.name:f.name);}} }, indent), [
      navIcon(FILE_ICON),
      h("span", null, f.name),
      h("span", { class: "file-size" }, formatBytes(f.size)),
    ]));
  }
  return nodes;
};

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
const FOLD = window.SaCodeMsgFold;
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
    // 会话内历史对话导航：条目取自投影里的用户提问，当前条目取自唯一滚动宿主播报的锚点。
    // 在尾部时宿主交还空锚点，高亮就回落到最后一轮——侧栏不自算滚动位置，避免出现第二个定位所有者。
    const turnAnchor = ref("");
    const turnOutline = window.Vue.computed(() => FOLD.turnOutline(proj.value.messages || [], proj.value.messageRows));
    const turnActive = window.Vue.computed(() => {
      const entries = turnOutline.value;
      if (!entries.length) return -1;
      if (!turnAnchor.value) return entries.length - 1;
      const ids = bubbleMessages.value.map((m) => m.id);
      const at = ids.indexOf(turnAnchor.value);
      if (at < 0) return -1;
      let active = -1;
      for (let i = 0; i < entries.length; i++) {
        const entryAt = ids.indexOf(entries[i].id);
        if (entryAt < 0 || entryAt > at) break;
        active = i;
      }
      return active;
    });
    const tools = ref([]);
    const detailName = ref("");
    const goalEditorRequest = ref(0);
    const sideTab = ref("files"), workbenchExpanded = ref(false);
    const filePreviewRevision = ref(0);
    const fileEditorRevision = ref(0);
    function editorRead(path){
      if(turn.value.running||sendBusy.value||catalogBusy.value||workspaceBusy.value||approval.value)throw Error('请先结算任务与当前会话操作。');
      const tool=tools.value.find(t=>t.name==='read');
      if(!tool||tool.needsApproval)throw Error('当前读取工具不可用于文件编辑。');
      return window.sacode.toolCall('read',JSON.stringify({path}),0);
    }
    const fileEditor=window.SaCodeSlots.createFileEditor({read:editorRead,ask:(path,text)=>window.sacode.approvalAsk('write',JSON.stringify({path,content:text})),answer:(id,decision)=>window.sacode.approvalAnswer(id,decision),write:(path,text,id)=>window.sacode.toolCall('write',JSON.stringify({path,content:text}),id)},()=>{fileEditorRevision.value++;});
    function openFileEditor(path){sideOpen.value=true;sideTab.value='editor';void fileEditor.open(path);}
    window.Vue.onBeforeUnmount(()=>fileEditor.dispose());
    const filePreview = window.SaCodeSlots.createFilePreview(async path=>{
      if(fileEditor.state.busy)throw Error('文件编辑正在读取或保存，请稍后重试。');
      if(turn.value.running)throw Error("任务正在执行，请在本轮结束后读取文件。");
      const tool=tools.value.find(t=>t.name==="read");
      if(!tool)throw Error("读取工具尚未登记。");
      if(tool.needsApproval)throw Error("该读取工具需要审批，请先在工具页处理。");
      return window.sacode.toolCall("read",path,0);
    },()=>{filePreviewRevision.value++;});
    window.Vue.onBeforeUnmount(()=>filePreview.dispose());
    function openWorkspaceFile(path){sideOpen.value=true;sideTab.value="preview";void filePreview.open(path);}
    window.Vue.watch(()=>scrollSession.value,()=>filePreview.close());
    const managementPage = ref('');
    const managementDrafts = window.Vue.reactive({});
    const userKnowledgeDraft = window.Vue.reactive({});
    const managementDraft = page => {
      const project=workspace.value?.configured?workspace.value.directory:'';
      const key=page+':'+(page==='knowledge'?project:String(scrollSession.value)+':'+project);
      const draft=managementDrafts[key]||(managementDrafts[key]={});
      if(page==='knowledge')draft.user=userKnowledgeDraft;
      return draft;
    };
    const viewport = ref(window.innerWidth), sidebarWidth = ref(280), rightWidth = ref(380);
    const sidebarClosed = ref(false), narrowExpanded = ref(false), sideOpen = ref(false), diagnosticsOpen = ref(false);
    const workspaceSessionLimits = ref(new Map());
    const workspaceGroupExpanded = ref(new Set());
    // 检索词与状态筛选是核心目录投影上的纯派生量：不发宿主请求，也不写回用户的展开记忆。
    const sidebarQuery = ref(''), catalogStatus = ref('all');
    const sidebarCollapsed = window.Vue.computed(() => sidebarClosed.value || (viewport.value < 1024 && !narrowExpanded.value));
    const frameColumns = window.Vue.computed(() => workbenchExpanded.value&&!pluginManagerOpen.value&&!managementPage.value?{sidebar:0,center:0,rightbar:viewport.value}:window.SaCodeFrame.columns(viewport.value, sidebarCollapsed.value ? 0 : sidebarWidth.value,
      sideOpen.value&&!pluginManagerOpen.value&&!managementPage.value ? rightWidth.value ?? viewport.value * .45 : 0, nativePlatform==='win32' || nativePlatform==='darwin' ? 0 : 56));
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
    const generalSettings = window.SaCodeGeneralSettings.createGeneralSettingsAssembly();
    window.Vue.onBeforeUnmount(()=>generalSettings.dispose());
    const pluginManagerOpen = ref(false);
    window.Vue.watch(pluginManagerOpen,open=>{if(open)managementPage.value='';});
    // 插件管理器适配器只建一次：每次渲染都新建会让轮询定时器与在途状态跨实例泄漏。
    // 通道不齐时工厂整体返回 null，页面据此保持 unconnected，不用假适配器冒充已接后端。
    const pluginManagerAdapter = window.SaCodePluginManager && window.SaCodePluginManager.createSacodePluginManagerAdapter
      ? window.SaCodePluginManager.createSacodePluginManagerAdapter(window.sacode)
      : null;
    // 模型中心装配：四页（模型/供应商/费用统计/迁移）通过槽位系统注册。
    const modelCenter = window.SaCodeSlots && window.SaCodeSlots.createModelCenterAssembly
      ? window.SaCodeSlots.createModelCenterAssembly()
      : null;
    window.Vue.onBeforeUnmount(()=>modelCenter && modelCenter.dispose());
    const modelCenterOwner = ref(null);
    const settingsTab = ref("general");
    const catalogOpen = ref(false), catalog = ref(null), catalogBusy = ref(false), catalogNote = ref("");
    let sessionGeneration = 0;
    let selectedScrollId = 'initial';
    const workspaceOpen=ref(false), workspace=ref(null), workspaceBusy=ref(false), workspaceNote=ref("");
    const workspaceRecent=ref([]),workspaceRecentBusy=ref(false);
    const workspaceFiles=ref([]), workspaceFilesBusy=ref(false);
    // 目录树展开态：openPaths 收已展开的相对子路径，treeChildren 收各路径的子目录列表，
    // 数据每次都从宿主拿——展开状态只是 UI 记忆，不是第二份文件系统事实。
    const fileTreeOpen=ref(new Set()), fileTreeChildren=ref({}), fileTreeBusy=ref("");
    // 会话轨迹：只回放已落盘（durable）事件——投影里的 pending 不算已发生的事实。
    const traceEvents=ref([]), traceCursor=ref(0), traceMore=ref(false), traceBusy=ref(false), traceError=ref("");
    let traceGeneration = 0;
    window.Vue.watch(() => [sideTab.value, scrollSession.value], ([tab]) => {
      if (tab === "trace") void refreshTrace(true);
    });
    const teamSessionId = ref(""), teamSnapshot = ref(null), teamBusy = ref(false), teamError = ref("");
    let teamTimer = null, teamGeneration = 0, teamNavigationId = "", teamDisposed = false;
    const teamActive = () => !teamDisposed && sideOpen.value && sideTab.value === "agents" && !pluginManagerOpen.value && !managementPage.value;
    const teamAssembly = window.SaCodeTeamState.createTeamAssembly({
      api: window.sacode, sideOpen, sideTab, pluginManagerOpen, scrollSession,
      teamSessionId, teamSnapshot, teamBusy, teamError,
      teamTimerRef: { get value() { return teamTimer; }, set value(v) { teamTimer = v; } },
      teamGenerationRef: { get value() { return teamGeneration; }, set value(v) { teamGeneration = v; } },
      teamNavigationIdRef: { get value() { return teamNavigationId; }, set value(v) { teamNavigationId = v; } },
      teamDisposedRef: { get value() { return teamDisposed; }, set value(v) { teamDisposed = v; } },
      selectSession: id => selectSession(id), getSelectedSession: () => selectedScrollId,
    });
    const { stopTeamRefresh, refreshTeam, addTeamMember, sendTeamMessage, createTeamTask, assignTeamTask, stopTeamMember, selectTeamSession } = teamAssembly;
    window.Vue.watch(() => [sideOpen.value, sideTab.value, pluginManagerOpen.value, managementPage.value, scrollSession.value], () => {
      const current = String(scrollSession.value || "");
      if (current && current !== "initial" && current !== teamNavigationId && current !== teamSessionId.value) {
        stopTeamRefresh(); teamSessionId.value = current; teamSnapshot.value = null; teamError.value = ""; teamNavigationId = "";
      }
      if (!teamActive()) { stopTeamRefresh(); return; }
      if (!teamSessionId.value) { teamError.value = "请先选择可用会话，再读取团队。"; return; }
      if (teamTimer === null) { void refreshTeam(); teamTimer = setInterval(refreshTeam, 3000); }
    });
    window.Vue.onBeforeUnmount(() => { teamDisposed = true; stopTeamRefresh(); });
    // 通用设置的三个持久化偏好：值与保存都走宿主 global/settings，失败时回显真实回读值。
    const generalPrefs = ref({ transcriptView: null, composerEnter: null, sessionLog: null });
    const generalPrefsBusy = ref(""), generalPrefsNote = ref("");
    // 插件清单适配器：宿主 packages 的每一项是一个已装插件；有工具行的包也作为会话预设组。
    // 全局插件列表 = 全部包；会话预设 = 有 rows 的包，每包一组。坏包只坏自己，不连坐。
    const pluginsInventoryAdapter = {
      async list() {
        const r = await window.sacode.pluginsDescribe();
        const packages = Array.isArray(r && r.packages) ? r.packages : [];
        const entries = packages.map((p) => ({
          moduleName: p.name, entryId: null,
          title: p.title || p.name, description: p.description, descriptionZhCN: p.descriptionZhCN,
          enabled: p.enabled === true,
          phase: p.error ? "failed" : p.installed === false ? null : "active",
          metadataError: p.error && p.error.reason ? p.error.reason : undefined,
        }));
        const presets = [];
        for (const p of packages) {
          const rows = Array.isArray(p.rows) ? p.rows : [];
          if (!rows.length) continue;
          presets.push({
            id: p.name, name: p.title || p.name,
            isDefault: presets.length === 0,
            broken: p.error && p.error.reason ? p.error.reason : undefined,
            rows: rows.map((r) => ({
              moduleName: r.moduleName, entryId: r.entryId || null,
              title: r.title || r.name, description: r.description, descriptionZhCN: r.descriptionZhCN,
              enabled: r.enabled === true, phase: r.phase || null,
            })),
          });
        }
        return { entries, presets };
      },
    };
    // 会话级隔离工作树：绑定按会话生效，面板只消费主进程逐字段校验过的 describe 视图。
    // 用 reactive 而不是 ref：输入草稿、在途标记与拒绝原因都落在同一个对象上，
    // 失败时一个也不清空——草稿是用户的输入，不是可以随手丢弃的中间状态。
    const worktreeState = window.Vue.reactive({ view: null, name: "", reference: "", error: "", busy: false, dialog: null, discardChanges: false, cleaned: null });
    function resetWorktreePanel() {
      worktreeState.name = ""; worktreeState.reference = ""; worktreeState.dialog = null;
      worktreeState.cleaned = null; worktreeState.error = ""; worktreeState.view = null;
    }
    const worktreeController = window.SaCodeWorktree.createController(worktreeState, window.sacode, async () => {
      // 进入与退出都换了会话的有效目录：目录显示、文件树与投影一起重读，
      // 不能让面板说「在隔离工作树里」而文件树还指着原目录。
      await workspaceAssembly.refreshWorkspace(); await workspaceAssembly.refreshWorkspaceFiles(); await refresh();
    });
    // 在途轮次、待审批工单与发送中都锁面板：本轮的 workingDirectory 已在宿主冻结，
    // 这时切目录只会得到「两个入口说的是两个不同目录」。
    function worktreeLocked() { return turn.value.running === true || !!approval.value || sendBusy.value === true; }
    const newSessionTitle = ref("");
    const sessionDrafts = new Map();
    function catalogError(e) {
      return window.SaCodeSessionCatalog.catalogError(e);
    }

    function focusComposerCaret() {
      window.Vue.nextTick(() => {
        const box = document.getElementById("composer");
        if (!box) { return; }
        box.focus();
        try { box.setSelectionRange(box.value.length, box.value.length); } catch (_) {}
      });
    }
    // 会话管理：委托给 session-state.js（经典脚本，CSP 兼容）
    // 工厂调用放在所有依赖声明之后，避免 TDZ。
    const selectedScrollIdRef = { get value() { return selectedScrollId; }, set value(v) { selectedScrollId = v; } };
    // 使用提醒条：正文不进消息投影，占用比例全部由核心算——
    // 核心没给可靠分子时，这里连百分比都不会出现。
    const tips=ref(null),tipsHidden=ref(null),tipsPressure=ref(undefined),tipsBusy=ref(false),tipsNote=ref(''),tipsError=ref(false);
    const globalAppearance = ref({theme:null,fontSize:null,busySend:null}), fontBusy=ref(false), fontNote=ref('');
    const busySendSaving=ref(false),busySendNote=ref(''),busySendError=ref(false);
    const appearanceBusy = ref(false), appearanceNote = ref("");
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
    const error = ref("");
    const { attachments, uploads, addAttachments, removeAttachment, retryAttachment, clearAttachments } =
      window.SaCodeAttachmentState.createAttachmentState({
        ref, upload: (...args) => window.sacode.attachmentUpload(...args),
        getGeneration: () => sessionGeneration, error, formatError: catalogError,
      });
    let rpcSeq = 0;
    let draftRevision=0, sendTicket=0;
    function updateDraft(value) { draftRevision++; draft.value=value; }
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

    // 提示词增强：委托给 enhance.js（经典脚本，CSP 兼容）
    const enhanceAssembly = window.SaCodeEnhance.createEnhanceAssembly({
      ref, draft, getDraftRevision: () => draftRevision, getSessionGeneration: () => sessionGeneration,
      error, catalogError, updateDraft, focusComposerCaret,
    });
    const { enhance, clickEnhance, startEnhance, cancelEnhance, undoEnhance, clearEnhance, userEditDraft } = enhanceAssembly;
    window.Vue.onBeforeUnmount(() => enhanceAssembly.stopEnhancePoll());

    let pollGeneration = 0, modelApprovalsSuppressed = false, modelTurnRequestId = null;
    let disposeDesktopKeys;
    onMounted(() => { disposeDesktopKeys = window.SaCodeSettings.bindDesktopKeys({ target: window, document, settingsOpen, enhance, undoEnhance, openSide }); });
    window.Vue.onBeforeUnmount(() => { disposeDesktopKeys?.(); stopPolling(); });

    async function refresh() {
      const generation=sessionGeneration, result=await window.sacode.projection();
      if (generation===sessionGeneration) {proj.value=result;scrollSession.value=selectedScrollId;}
    }

    async function refreshTools() {
      const generation=sessionGeneration;
      const r = await window.sacode.toolsList();
      if (generation!==sessionGeneration) return;
      tools.value = r.tools;
      toolCounters.value = { misses: r.misses, guardDenials: r.guardDenials };
    }

    function refreshQueue() { return sendQueue.refreshQueue(); }

    // 发送/队列/轮次控制：委托给 send-queue-state.js（经典脚本，CSP 兼容）
    // startPolling/stopPolling 由 turn-poll 装配后回填，send-queue 里用的是箭头闭包。

    // 输入区的模型选择器共用同一份注册表：选定即写默认指针，下一轮请求就按它装配。
    // 目录状态只在宿主里，这里只做快照投影与订阅通知，不留第二份「已选模型」。
    // 供应商管理页的适配器由 pages/model-center-adapter.ts 按宿主动词逐条映射，
    // 这里只在供应商写动作之后刷新目录——两处是同一份注册表的投影，不能一新一旧。
    const modelDirectory = window.SaCodeModelDirectory.createModelDirectory(window.sacode);
    void modelDirectory.load();
    // 发送入口的自定义模型候选只从核心读（custom/describe 的 models），
    // 未启用的条目不给选；空选中态表示「不指定」，Host 沿用注册表默认指针。
    const customModels = ref([]), selectedCustomModel = ref("");
    async function loadCustomModels() {
      try {
        const view = await window.sacode.customsDescribe();
        customModels.value = (view.models || []).filter((m) => m.enabled === true);
        if (selectedCustomModel.value && !customModels.value.some((m) => m.id === selectedCustomModel.value)) selectedCustomModel.value = "";
      } catch (e) { customModels.value = []; }
    }
    void loadCustomModels();
    // 输入区只有一个模型入口，但它背后有两种来源：注册表默认指针与自定义模型。
    // 两个指针同时生效时界面显示的那颗不一定是真正被发送的那颗，所以选中注册表模型
    // 时顺手清掉自定义指针，让「显示 = 发送」恒等；反向则由选择器回调负责。
    const composerDirectory = {
      getSnapshot: () => modelDirectory.getSnapshot(),
      subscribe: (invalidate) => modelDirectory.subscribe(invalidate),
      load: () => Promise.all([modelDirectory.load(),loadCustomModels()]),
      select: async (value) => { await modelDirectory.select(value); selectedCustomModel.value = ''; },
    };
    const settingsAssembly = window.SaCodeSettings.createSettingsAssembly({
      api: window.sacode, globalAppearance, fontBusy, fontNote, appearanceBusy, appearanceNote,
      budgetDraft, budgetNote, budgetBusy, usage, generalPrefs, generalPrefsBusy, generalPrefsNote,
      busySendSaving, busySendNote, busySendError,
      tips, tipsHidden, tipsPressure, tipsBusy, tipsNote, tipsError, catalogError,
      getSessionGeneration: () => sessionGeneration, cleanErr: e => cleanErr(e),
    });
    const { refreshGlobalAppearance, setFontSize, setTheme, setBusySend, refreshUsage, setBudget, refreshGeneralPrefs, setGeneralPref, showStartupTip, showContextTip, refreshTips, setTipsHidden, dismissTips } = settingsAssembly;
    void refreshGeneralPrefs();
    const sessionAssembly = window.SaCodeSessionState.createSessionAssembly({
      api: window.sacode, ref,
      catalog, catalogBusy, catalogNote, catalogOpen, newSessionTitle,
      draft, error, selectedScrollId: selectedScrollIdRef, scrollSession,
      turn, approval, sendBusy, budgetBusy, appearanceBusy, workspaceBusy,
      sessionDrafts, getSessionGeneration: () => sessionGeneration, incrementSessionGeneration: () => { sessionGeneration += 1; },
      catalogError, clearEnhance, clearAttachments, stopPolling,
      foldOpen, loadCustomModels, fileEditor,
      worktreeController, resetWorktreePanel,
      refresh, refreshTools, refreshUsage,
      refreshWorkspace: () => workspaceAssembly.refreshWorkspace(),
      refreshWorkspaceFiles: () => workspaceAssembly.refreshWorkspaceFiles(),
      refreshQueue, refreshGlobalAppearance,
      selectedCustomModel, previewFloating, detailName,
      budgetDraft, budgetNote, appearanceNote, workspaceNote,
      queuePending, focusComposer: focusComposerCaret,
      tipsPressure, tips, refreshTips,
      outcome, outcomeKind, enhance,
    });
    const { applySelection, selectSession, createSession, startNewSession, refreshCatalog, openCatalog } = sessionAssembly;
    // 工作区/文件树/会话轨迹：委托给 workspace-state.js（经典脚本，CSP 兼容）
    const workspaceAssembly = window.SaCodeWorkspace.createWorkspaceAssembly({
      api: window.sacode, ref,
      workspaceOpen, workspace, workspaceBusy, workspaceNote, workspaceRecent, workspaceRecentBusy,
      workspaceFiles, workspaceFilesBusy,
      fileTreeOpen, fileTreeChildren, fileTreeBusy,
      traceEvents, traceCursor, traceMore, traceBusy, traceError,
      scrollSession, getSessionGeneration: () => sessionGeneration,
      incrementTraceGeneration: () => ++traceGeneration, getTraceGeneration: () => traceGeneration,
      catalogError, fileEditor,
      turn, approval, sendBusy, budgetBusy, appearanceBusy,
      refresh, refreshTools, refreshCatalog,
    });
    const { refreshWorkspace, refreshWorkspaceFiles, toggleTreeDir, refreshTrace, openWorkspace, chooseWorkspace, selectRecentWorkspace } = workspaceAssembly;
    const modelCenterAdapters = window.SaCodeSlots.createModelCenterAdapters(window.sacode);
    // 供应商写动作之后刷新输入区的模型目录：同一份注册表的两份投影必须同步走。
    for (const verb of ["save", "saveCredential", "createInstance", "setDefault", "remove", "reorder", "pullModels"]) {
      const inner = modelCenterAdapters["provider-settings"][verb].bind(modelCenterAdapters["provider-settings"]);
      modelCenterAdapters["provider-settings"][verb] = async (...args) => {
        try { return await inner(...args); } finally { void modelDirectory.load(); }
      };
    }
    for (const verb of ["upsert", "remove", "bindingUpsert", "bindingRemove", "bindingReorder"]) {
      const inner = modelCenterAdapters["custom-models"][verb].bind(modelCenterAdapters["custom-models"]);
      modelCenterAdapters["custom-models"][verb] = async (...args) => {
        try { return await inner(...args); } finally { void loadCustomModels(); }
      };
    }
    modelCenterOwner.value = { adapters: modelCenterAdapters };

    const modelApprovalsSuppressedRef = { get value() { return modelApprovalsSuppressed; }, set value(v) { modelApprovalsSuppressed = v; } };
    const modelTurnRequestIdRef = { get value() { return modelTurnRequestId; }, set value(v) { modelTurnRequestId = v; } };
    const sendQueue = window.SaCodeSendQueue.createSendQueueAssembly({
      api: window.sacode, ref,
      draft, error, turn, approval, sendBusy,
      queuePending, queueRows,
      fileEditor, attachments, uploads,
      selectedCustomModel, modelDirectory,
      globalAppearance,
      getSessionGeneration: () => sessionGeneration, getDraftRevision: () => draftRevision,
      getSendTicket: () => sendTicket, incrementSendTicket: () => ++sendTicket,
      getRpcSeq: () => rpcSeq, incrementRpcSeq: () => ++rpcSeq,
      modelApprovalsSuppressed: modelApprovalsSuppressedRef, modelTurnRequestId: modelTurnRequestIdRef,
      getPollGeneration: () => pollGeneration,
      startPolling: () => turnPolling.start(), stopPolling: () => turnPolling.stop(),
      clearEnhance, clearAttachments, removeAttachment,
      updateDraft, refresh, refreshCatalog, projectQueueRow: window.SaCodeQueue.projectQueueRow,
    });
    const { send, enqueueDraft, startTask, runTurn, cancelTurn, imageDraftAllowed, cleanErr, updateQueue } = sendQueue;
    void refreshQueue();

    // 轮询装配：startTask 来自 send-queue；send-queue 的 startPolling/stopPolling 用箭头闭包回填 turnPolling。
    const turnPolling = window.SaCodeTurnPoll.createTurnPoll({
      poll: () => window.sacode.turnPoll(), getGeneration: () => sessionGeneration,
      getEpoch: () => pollGeneration, invalidate: () => { pollGeneration++; },
      getApprovalContext: () => ({ suppressed: modelApprovalsSuppressed, sessionId: String(selectedScrollId), requestId: modelTurnRequestId }),
      selectProposal: window.SaCodeModelApproval.selectProposal,
      turn, usage, approval, error, queueRows, refresh, refreshTools, refreshQueue, showContextTip, startTask,
    });
    function stopPolling() { turnPolling.stop(); }
    function startPolling() { turnPolling.start(); }

    // 工具审批：委托给 tool-approval-state.js（经典脚本，CSP 兼容）
    const toolApproval = window.SaCodeToolApproval.createToolApprovalAssembly({
      api: window.sacode, ref,
      turn, approval, error, outcome, outcomeKind,
      fileEditor,
      getSessionGeneration: () => sessionGeneration, getPollGeneration: () => pollGeneration,
      modelApprovalsSuppressed: modelApprovalsSuppressedRef,
      selectedScrollId: selectedScrollIdRef, modelTurnRequestId: modelTurnRequestIdRef,
      cleanErr, refreshTools, refresh,
    });
    const { askTool, answerTool, callTool } = toolApproval;


    onMounted(async () => {
      await refreshGlobalAppearance();
      try {
        await refresh();
        await refreshTools();
        // 开机就把账读出来：重启后「已经花掉多少、停在哪个档」不该等到跑完一轮才知道
        await refreshUsage();
        await refreshCatalog();
        await refreshWorkspace();
        // 开机就把绑定读出来：工作树是会话状态的一部分，不该等用户点「恢复当前状态」才知道自己在哪。
        await worktreeController.restore();
      } catch (e) {
        error.value = catalogError(e);
      }
      // 提醒面单独吞错：读不到提示不能让工作台变成一屏错误。
      await refreshTips();
      if (tipsHidden.value !== true) await showStartupTip();
    });

    // 失败重试：把会话里最后一条用户消息放回输入框再发一次。会话日志是只追加的，
    // 重试会在日志里留下第二条同样的消息——这是「再问一次」的真实语义，不做假删除。
    const lastUserMessage = window.Vue.computed(() => {
      // 用气泡投影而不是原始投影：角色名是在 msgfold 的映射表里统一过的，
      // 直接读原始行会拿到宿主侧的 role 串，两处口径不能各写各的。
      const rows = bubbleMessages.value || [];
      for (let i = rows.length - 1; i >= 0; i--) {
        const m = rows[i];
        if (m.role === 'user' && typeof m.content === 'string' && m.content.trim()) return m.content;
      }
      return '';
    });
    const canRetryLastTurn = window.Vue.computed(() => !!error.value && !turn.value.running && !!lastUserMessage.value);
    async function retryLastTurn() {
      const text = lastUserMessage.value;
      if (!text || sendBusy.value) return;
      updateDraft(text);
      await window.Vue.nextTick();
      await send();
    }

    return {
      fileEditor,fileEditorRevision,openFileEditor,
      frameColumns, sidebarWidth, sidebarCollapsed, toggleSidebar, beginFrameResize, resizeFrameKey, sideOpen, diagnosticsOpen, startNewSession,
      proj, scrollSession, followingTail, tools, detailName, detailTool, sideTab, workbenchExpanded, filePreview, filePreviewRevision, openWorkspaceFile, sideSplit, sideRatio, beginResize, openSide, toolCounters, draft, updateDraft, userEditDraft, enhance, clickEnhance, sendBusy, error, canRetryLastTurn, retryLastTurn, approval, outcome, outcomeKind, turn, attachments, uploads, addAttachments, removeAttachment, retryAttachment,
      worktreeState, worktreeController, worktreeLocked,
      usage, budgetDraft, budgetNote, budgetBusy, setBudget, bubbleMessages, readPreview, previewFloating, settingsOpen, settingsTab, managementPage, managementDraft, pluginManagerOpen, pluginManagerAdapter,
      appearanceBusy, appearanceNote, setTheme, modelDirectory, composerDirectory, customModels, selectedCustomModel,
      globalAppearance, fontBusy, fontNote, setFontSize, refreshGlobalAppearance,
      generalSettings, generalPrefsNote, busySendSaving, busySendNote, busySendError, setBusySend,
      tips, tipsHidden, tipsBusy, tipsNote, tipsError, tipsPressure, setTipsHidden, dismissTips, refreshTips,
      fileTreeOpen, fileTreeChildren, fileTreeBusy, toggleTreeDir,
      traceEvents, traceMore, traceBusy, traceError, refreshTrace,
      teamSessionId, teamSnapshot, teamBusy, teamError, refreshTeam, addTeamMember, sendTeamMessage, createTeamTask, assignTeamTask, stopTeamMember, selectTeamSession,
      turnOutline, turnActive, turnAnchor,
      generalPrefs, generalPrefsBusy, setGeneralPref,
      pluginsInventoryAdapter,
      modelCenter, modelCenterOwner,
      catalogOpen, catalog, catalogBusy, catalogNote, refreshCatalog, openCatalog, newSessionTitle, createSession, selectSession,
      workspaceOpen, workspace, workspaceBusy, workspaceNote, workspaceRecent, workspaceRecentBusy, workspaceFiles, workspaceFilesBusy, openWorkspace, chooseWorkspace, selectRecentWorkspace, workspaceSessionLimits, workspaceGroupExpanded,
      sidebarQuery, catalogStatus,
      send, runTurn, cancelTurn, askTool, answerTool,
      queueRows, queuePending, updateQueue, goalEditorRequest,
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
    // 首屏只按标题或工作区检索；日志完整性筛选仅作用于本地会话弹窗。
    const groupLabel = (directory)=>directory ? directory.split(/[\\/]/).filter(Boolean).pop() || directory : '未分组';
    const sidebarQueryText = String(self.sidebarQuery || '').trim().toLowerCase();
    const sidebarSearching = sidebarQueryText.length > 0;
    const matchingSessions = sidebarSessions.filter((item)=>{
      if (!sidebarQueryText) return true;
      return (item.title || '未命名会话').toLowerCase().includes(sidebarQueryText)
        || groupLabel(item.workspaceDirectory || '').toLowerCase().includes(sidebarQueryText);
    });
    // 分组键来自核心的逐会话工作区投影；不根据当前目录或路径相似度猜测归属。
    const workspaceGroups = new Map();
    for (const item of matchingSessions) {
      const directory = item.workspaceDirectory || '';
      if (!workspaceGroups.has(directory)) workspaceGroups.set(directory, []);
      workspaceGroups.get(directory).push(item);
    }
    // 「当前工作区还没有会话」的占位分组只在无检索时有意义：筛选中留空组只会制造一条点不动的树。
    if (self.workspace?.configured && !sidebarSearching && !workspaceGroups.has(self.workspace.directory)) workspaceGroups.set(self.workspace.directory, []);
    const renderSession = item=>el('button','sidebar-session'+(item.current?' selected':''),[navIcon('M4 4h16v12H9l-5 4z'),el('span',null,item.title||'未命名会话')],{
      'data-sidebar-session':item.id,'aria-current':item.current?'page':null,title:item.title||'未命名会话',disabled:sessionLocked||item.status==='replay-rejected',onClick:()=>{self.pluginManagerOpen=false;self.managementPage='';self.selectSession(item.id);}});
    const head = el("header", "top", [
      el("div", "heading", [el("h1", null, currentTitle, {id:"current-session-title", title:currentTitle, hidden:emptyConversation && nativePlatform!=="win32"})]),
      el("div", "header-utilities", [
        el('button','frame-icon',[navIcon('M4 4h16v16H4z M14 4v16')],{id:'toggle-side','aria-label':self.sideOpen?'关闭侧栏':'打开侧栏','aria-expanded':self.sideOpen,tooltip:{label:self.sideOpen?'关闭侧栏':'打开侧栏'},onClick:()=>{self.sideOpen=!self.sideOpen;}}),
        self.approval ? el('button','frame-icon pending-approval',[navIcon('M12 3l10 18H2z M12 9v5 M12 17v1')],{'aria-label':'处理待审批请求',onClick:()=>self.openSide('tools-panel')}) : null,
      ]),
    ]);
    const nav = el("nav", "navigation", [
      el('div','sidebar-brand-row',[
        el("button", "brand", [h("img", { src: "assets/sacode-logo.png", alt: "SaCode", width: 24, height: 24 })],{'aria-label':self.sidebarCollapsed?'打开侧边栏':'SaCode · 新建会话',onClick:()=>self.sidebarCollapsed?self.toggleSidebar():self.startNewSession()}),
        el('button','frame-icon sidebar-toggle',[navIcon('M4 4h16v16H4z M9 4v16')],{id:'toggle-sidebar','aria-label':self.sidebarCollapsed?'打开侧边栏':'收起侧边栏',tooltip:{label:self.sidebarCollapsed?'打开侧边栏':'收起侧边栏',side:'right'},onClick:self.toggleSidebar}),
      ]),
      el('button','nav-item new-session',[navIcon('M12 5v14 M5 12h14'),el('span','nav-label','新会话')],{id:'sidebar-new-session','aria-label':'新建会话',disabled:sessionLocked,onClick:()=>{self.managementPage='';self.pluginManagerOpen=false;self.startNewSession();}}),
      el('label','sidebar-search-box',[navIcon('M11 4a7 7 0 1 0 0 14a7 7 0 1 0 0-14 M16 16l5 5'),
        el('input','sidebar-search',null,{id:'sidebar-search',type:'search',value:self.sidebarQuery,placeholder:'搜索会话',
          'aria-label':'搜索会话','aria-keyshortcuts':'Control+K Meta+K',disabled:sessionLocked,
          onInput:(e)=>{self.sidebarQuery=e.target.value;}})]),
      el('div','workspace-heading',[
        el('span','nav-label','工作区'),
        el('button','frame-icon',[navIcon('M11 4a7 7 0 1 0 0 14a7 7 0 1 0 0-14 M16 16l5 5')],{id:'open-catalog','aria-label':'本地会话列表',onClick:self.openCatalog}),
        el('button','frame-icon',[navIcon('M3 7h8l2 2h8v12H3z M17 2v6 M14 5h6')],{id:'open-workspace','aria-label':'选择项目文件夹','aria-haspopup':'dialog','aria-controls':'project-picker','aria-expanded':self.workspaceOpen,disabled:sessionLocked,onClick:self.openWorkspace}),
      ]),
      el('div','sidebar-session-list',[
        ...[...workspaceGroups].map(([directory,items])=>{
          const limit=self.workspaceSessionLimits.get(directory) ?? 5;
          let idle=0;
          const visible=items.filter(item=>item.current&&self.turn.running || idle++<limit);
          const hidden=items.length-visible.length;
          const label=groupLabel(directory);
          // 检索/筛选中整棵树强制展开：命中却藏在折叠分组里等于没搜到。
          // 展开只由筛选派生，不写进 workspaceGroupExpanded——清掉筛选词后仍回到用户自己的记忆。
          const expanded=sidebarSearching || self.workspaceGroupExpanded.has(directory);
          return el('section','workspace-group'+(expanded?' expanded':''),[
            // 筛选中分组不可折叠（折叠一个只剩命中的树没有意义），所以这一行退化成纯标题，不留点不动的箭头。
            sidebarSearching ? el('div','workspace-folder',[
              navIcon('M3 5h7l2 3h9v12H3z'),
              el('span','workspace-label',label),
            ],{ title:directory||'尚未绑定项目目录的会话' }) : el('button','workspace-folder'+(expanded?' tree-expanded':''),[
              navIcon(expanded?'M9 5l7 7-7 7':'M5 9l7 7 7-7'),
              navIcon('M3 5h7l2 3h9v12H3z'),
              el('span','workspace-label',label),
            ],{
              'aria-expanded':expanded,
              'aria-label':expanded?'折叠工作区':'展开工作区',
              title:directory||'尚未绑定项目目录的会话',
              onClick:()=>{expanded?self.workspaceGroupExpanded.delete(directory):self.workspaceGroupExpanded.add(directory);},
            }),
            expanded ? [...visible.map(renderSession),
            items.length>5 ? el('button','workspace-overflow',hidden ? `显示更多（${hidden}）` : '收起会话',{
              'data-workspace-overflow':directory,'aria-expanded':hidden===0,onClick:()=>self.workspaceSessionLimits.set(directory,hidden ? limit+5 : 5)}) : null] : [],
          ],{ 'data-workspace-group':directory });
        }),
        !matchingSessions.length ? el('div','sidebar-empty',[navIcon('M4 5h16v14H4z M8 9h8 M8 13h8'),el('span',null,sidebarSessions.length ? '无匹配会话' : '暂无会话')]) : null,
        self.catalogNote && self.catalogNote.includes('失败') ? el('p','note',self.catalogNote,{role:'status'}) : null,
      ]),
      el('div','sidebar-product-links',[
        ...[['knowledge','知识库','M3 4h8l1 2 1-2h8v16h-8l-1 1-1-1H3zM12 6v15'],['automation','自动化','M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18M12 7v5l4 2'],['extensions','扩展','M9 3h6v6h6v6h-6v6H9v-6H3V9h6z'],['connections','连接','M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-2 2M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l2-2']].map(([id,label,path])=>el('button','nav-item nav-panel',[navIcon(path),el('span','nav-label',label)],{id:'open-'+id,'aria-label':id==='extensions'?'扩展管理':label,'aria-pressed':id==='extensions'?self.pluginManagerOpen:self.managementPage===id,onClick:()=>{if(id==='extensions'){self.pluginManagerOpen=!self.pluginManagerOpen;self.managementPage='';}else{self.pluginManagerOpen=false;self.managementPage=self.managementPage===id?'':id;}}})),
      ]),
      el('footer','sidebar-footer',[
        h(window.SaCodeSlots.AccountMenu,{theme:self.globalAppearance.theme,busy:self.appearanceBusy||self.fontBusy,note:self.appearanceNote,onTheme:self.setTheme,onSettings:id=>{self.settingsTab=id;self.settingsOpen=true;}}),
        el('button','frame-icon sidebar-settings',[navIcon('M9 3h6l1 4 4 1v6l-4 1-1 4H9l-1-4-4-1V8l4-1 1-4z M9 11a3 3 0 1 0 6 0a3 3 0 1 0-6 0')],{
          id:'open-settings','aria-label':'SaCode 设置','aria-keyshortcuts':'Control+, Meta+,',
          tooltip:{label:'设置',side:'right',shortcutKeys:['Ctrl','+',',']},onClick:()=>{self.settingsOpen=!self.settingsOpen;}}),
      ],{'aria-label':'本地用户与设置'}),
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
    // 会话正文和驻留输入区在同一滚动宿主中，输入 DOM 跨空会话/活跃会话保持不变。
    const transcript = el('div','conversation-content',[el("div", "stream", msgs, { id: "messages" }), streamBox],{hidden:emptyConversation && nativePlatform!=="win32"});

    const sidePanels = window.SaCodeSidePanels.renderPanels(self, { h, el, navIcon, turnBar, renderTreeEntries, verdictName });
    const { sideTabs, inspection, filesPage, tracePage, guide, previewBody } = sidePanels;
    const searchPage = el('div','side-page',[h(window.SaCodeSlots.WorkspaceSearch,{key:'search-'+self.scrollSession,active:self.sideOpen&&self.sideTab==='search'&&!self.pluginManagerOpen&&!self.managementPage,configured:!!self.workspace?.configured,directory:self.workspace?.directory||'',listFiles:path=>window.sacode.workspaceFiles(path),onOpen:self.openWorkspaceFile,onChoose:self.openWorkspace})],{id:'side-page-search',role:'tabpanel','aria-labelledby':'side-tab-search',hidden:self.sideTab!=='search'});
    const editorPage=el('div','side-page',[h(window.SaCodeSlots.FileEditor,{editor:self.fileEditor,revision:self.fileEditorRevision})],{id:'side-page-editor',role:'tabpanel','aria-labelledby':'side-tab-editor',hidden:self.sideTab!=='editor'});
    const terminalPage=el('div','side-page',[h(window.SaCodeSlots.TerminalOutput,{key:'terminal-'+self.scrollSession,executionApi:window.sacode,sessionId:String(self.scrollSession),active:self.sideOpen&&self.sideTab==='terminal'&&!self.pluginManagerOpen&&!self.managementPage,read:cursor=>window.sacode.terminalOutput(String(self.scrollSession),cursor,16)})],{id:'side-page-terminal',role:'tabpanel','aria-labelledby':'side-tab-terminal',hidden:self.sideTab!=='terminal'});
    const gitPage=el('div','side-page',[h(window.SaCodeSlots.GitWorkbench,{key:'git-'+self.scrollSession,sessionId:String(self.scrollSession),directory:self.workspace?.directory||'',configured:!!self.workspace?.configured,active:self.sideOpen&&self.sideTab==='git'&&!self.pluginManagerOpen&&!self.managementPage,status:()=>window.sacode.workspaceGitStatus(String(self.scrollSession),self.workspace.directory),diff:(path,scope)=>window.sacode.workspaceGitDiff(String(self.scrollSession),self.workspace.directory,path,scope),onOpen:self.openWorkspaceFile,onBrowse:path=>{self.sideTab='files';self.toggleTreeDir(path.slice(0,-1));},onChoose:self.openWorkspace}),window.SaCodeWorktree.renderPanel(h,self.worktreeState,self.worktreeController,self.worktreeLocked())],{id:'side-page-git',role:'tabpanel','aria-labelledby':'side-tab-git',hidden:self.sideTab!=='git'});
    const diffPage=el('div','side-page',[h(window.SaCodeSlots.FileEditor,{editor:self.fileEditor,revision:self.fileEditorRevision,diffOnly:true})],{id:'side-page-diff',role:'tabpanel','aria-labelledby':'side-tab-diff',hidden:self.sideTab!=='diff'});
    const preview = el("div", "side-page", previewBody("preview"), { id: "side-page-preview", role: "tabpanel", "aria-labelledby": "side-tab-preview", hidden: self.sideTab !== "preview" });
    const teamPage=el('div','side-page',[self.teamSnapshot?h(window.SaCodeSlots.TeamPanel,{key:self.teamSessionId,snapshot:self.teamSnapshot,busy:self.teamBusy,error:self.teamError,onAddMember:self.addTeamMember,onSendMessage:self.sendTeamMessage,onCreateTask:self.createTeamTask,onAssignTask:self.assignTeamTask,onStopMember:self.stopTeamMember,onSelectSession:self.selectTeamSession,onRefresh:self.refreshTeam}):el('section','team-panel',[el('h2',null,'智能体团队'),self.teamBusy?el('p','note','正在读取团队…',{role:'status'}):null,self.teamError?el('div','resource-error',[el('strong',null,'团队读取失败'),el('p','note',self.teamError.includes('timeout')?'请求超时，未取得团队状态。可重试读取。':'未取得团队状态。请检查连接后重试。'),el('details',null,[el('summary',null,'错误详情'),el('pre',null,self.teamError)])],{role:'alert'}):null,el('button','btn','刷新',{disabled:self.teamBusy,onClick:self.refreshTeam})])],{id:'side-page-agents',role:'tabpanel','aria-labelledby':'side-tab-agents',hidden:self.sideTab!=='agents'});
    const side = el("aside", "pane side", [sideTabs, el("div", "side-content" + (self.sideSplit ? " side-split" : ""), [
      el("div", "side-primary", [!self.sideTab?el("div","empty-card",[el("h3",null,"暂无打开的资源"),el("p","note","使用右上角 ＋ 添加工作台标签。")]):null,inspection, filesPage, searchPage, editorPage, diffPage, gitPage, terminalPage, teamPage, tracePage, preview, guide], { style: { flex: self.sideSplit ? self.sideRatio : 1 } }),
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
      "aria-label": "工作台",
      hidden:!!self.managementPage||self.pluginManagerOpen||!self.sideOpen || self.frameColumns.rightbar===0,
      onKeydown:e=>{if(e.key==="Escape"&&self.workbenchExpanded){e.preventDefault();self.workbenchExpanded=false;window.Vue.nextTick(()=>document.getElementById("expand-workbench")?.focus());}},
    });

    const composer = el("footer", "composer", [
      emptyConversation ? el('div','hero-heading',[h('img',{src:'assets/sacode-logo.png',alt:'SaCode',width:32,height:32}),el('span',null,'让灵感，有迹可循。')]) : null,
      emptyConversation ? el('div','hero-workspace-row',[
        el('button','workspace-chip',[navIcon('M3 5h7l2 3h9v12H3z'),el('span',null,self.workspace?.configured?workspaceName:'选择项目'),el('span','chip-chevron',navIcon('m6 9 6 6 6-6'),{'aria-hidden':'true'})],{'aria-label':'选择项目文件夹','aria-haspopup':'dialog','aria-controls':'project-picker','aria-expanded':self.workspaceOpen,title:self.workspace?.directory,disabled:sessionLocked,onClick:self.openWorkspace}),
      ]) : null,
      h(window.SaCodeTodo.TodoPanel,{key:'todos-'+self.scrollSession,todos:Array.isArray(self.proj.todos)?self.proj.todos:[]}),
      h(window.SaCodeQueue.QueueDock,{key:'queue-'+self.scrollSession,sessionId:String(self.scrollSession),rows:self.queueRows,pending:self.queuePending,running:self.turn.running,mutable:true,updateQueue:self.updateQueue,onNotice:(_kind,text)=>{self.error=text;}}),
      self.scrollSession!=='initial' && self.scrollSession!==0 ? h(window.SaCodeGoal.GoalBar,{key:'goal-'+self.scrollSession,hideCreate:true,editRequest:self.goalEditorRequest,adapter:{describe:()=>window.sacode.goalDescribe(String(self.scrollSession)),create:text=>window.sacode.goalCreate(String(self.scrollSession),text),edit:(revision,text)=>window.sacode.goalEdit(String(self.scrollSession),revision,text),pause:revision=>window.sacode.goalPause(String(self.scrollSession),revision),resume:revision=>window.sacode.goalResume(String(self.scrollSession),revision),clear:revision=>window.sacode.goalClear(String(self.scrollSession),revision)}}):null,
      // 使用提醒条：贴在输入区上方，与会话正文分开——它不是消息，也不进投影。
      h(window.SaCodeTips.TipsBar,{key:'tips-'+self.scrollSession,entry:self.tips,busy:self.tipsBusy,onDismiss:self.dismissTips}),
      el("label", "composer-label", "发送消息", { for: "composer" }),
      el("div", "composer-card", [withDirectives(h("textarea", {
        class: "input",
        id: "composer",
        rows: 1,
        "aria-keyshortcuts":"Enter Control+Enter Meta+Enter",
        placeholder: "描述你的任务或补充信息…",
        value: self.draft,
        onInput: (e) => {const v=e.target.value;self.userEditDraft(v);if(v==='/'){self.slashTrigger=(self.slashTrigger||0)+1;}},
      }),[[autoDraftSize],[window.SaCodeAttachments.keymapDirective,{
        canSubmit:()=>!self.sendBusy&&!document.querySelector('dialog:modal'),
        submit:accelerated=>self.send(accelerated),
      }]]),
      h(window.SaCodeAttachments.Composer,{key:'attachments-'+self.scrollSession,active:!self.pluginManagerOpen,canAcceptDrop:true,showAdd:false,attachments:self.attachments,uploads:self.uploads,limits:{count:20,size:'20 MB'},onAdd:(files,dirs)=>self.addAttachments(files,dirs),onRemove:(id)=>self.removeAttachment(id),onRetry:(id)=>self.retryAttachment(id)}),
      el("div", "composer-controls", [h(window.SaCodeAttachments.AddButton,{key:'menu-'+self.scrollSession,disabled:self.catalogBusy,goalAvailable:self.scrollSession!=='initial'&&self.scrollSession!==0,workspaceConfigured:!!self.workspace?.configured,listFiles:path=>window.sacode.workspaceFiles(path),slashTrigger:self.slashTrigger,onAdd:(files,dirs)=>self.addAttachments(files,dirs),onGoal:()=>{self.goalEditorRequest++;},onReference:path=>{self.userEditDraft(self.draft+(self.draft?'\n':'')+'工作区文件：'+path);window.Vue.nextTick(()=>document.getElementById('composer').focus());},onExtensions:()=>{self.pluginManagerOpen=true;},onCommand:(name)=>{if(name==='clear'){proj.value={...proj.value,messages:[]};}}}),h(window.SaCodeModelSelect.Select,{key:self.scrollSession,directory:self.composerDirectory,locked:self.turn.running,customs:self.customModels,customId:self.selectedCustomModel,onPickCustom:id=>{self.selectedCustomModel=id;}}),h(window.SaCodeSlots.PermissionMenu,{key:'permission-'+self.scrollSession}),el("div", "composer-trailing", [el("button", "composer-enhance", [h('svg',{width:16,height:16,viewBox:'0 0 16 16','aria-hidden':'true'},[
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
        onMousedown:e=>e.preventDefault(),onClick:()=>self.clickEnhance() }),el('button','composer-voice',[navIcon('M9 4a3 3 0 0 1 6 0v7a3 3 0 0 1-6 0zM5 10v1a7 7 0 0 0 14 0v-1M12 18v4M8 22h8')],{type:'button',disabled:true,'aria-label':'语音输入待接入',title:'当前版本尚未支持语音输入'}),h(window.SaCodeContextMeter.ContextMeter,{key:'context-'+self.scrollSession,pressure:(()=>{const v=self.modelDirectory.getSnapshot();const s=self.tipsPressure;return {contextWindow:parseCapacity(v&&v.contextWindow)||undefined,projectedTokens:(s&&Number.isFinite(s.projectedTokens))?s.projectedTokens:undefined};})()}),el("button", "composer-primary", [h('svg',{width:16,height:16,viewBox:'0 0 16 16','aria-hidden':'true'},[
        self.turn.running && !self.draft.trim()
          ? h('rect',{x:3,y:3,width:10,height:10,rx:3,fill:'currentColor'})
          : h('path',{d:'M8.3125 0.980183C8.66767 1.0531 8.97902 1.20418 9.2627 1.43233C9.48724 1.61297 9.73029 1.85793 9.97949 2.10714L14.707 6.83468L13.293 8.24874L9 3.95577V15.0417H7V3.95577L2.70703 8.24874L1.29297 6.83468L6.02051 2.10714C6.26971 1.85793 6.51277 1.61297 6.7373 1.43233C6.97662 1.23986 7.28445 1.04402 7.6875 0.980183C7.8973 0.947006 8.1031 0.95516 8.3125 0.980183Z',fill:'currentColor'}),
      ])], { id: "send", type:'button', 'aria-label':self.turn.running && !self.draft.trim()?'停止执行':'发送消息', 'aria-busy':self.sendBusy, disabled:self.sendBusy || (!self.turn.running && !self.draft.trim()),
        tooltip:{label:self.turn.running && !self.draft.trim()?'停止执行':'发送消息',side:'top',delayMs:500},
        // 鼠标发送不挪走输入焦点，键盘仍可 Tab 到可用的发送/停止按钮。
        onMousedown:e=>e.preventDefault(),onClick:()=>self.turn.running && !self.draft.trim()?self.cancelTurn():self.send() })])]),
      ]),
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
    const settings = window.SaCodeSettings.renderSettings(self, { h, el, navIcon });
    const catalogDialog = h(window.SaCodeDialog, { open:self.catalogOpen, title:"SaCode 本地会话", class:"catalog-dialog",
      onClose:()=>{self.catalogOpen=false;} }, ()=>[
      el("div", "catalog-toolbar", [el("h2", null, "落盘会话"), el("button", "btn", self.catalogBusy ? "读取中…" : "刷新", {
        id:"refresh-catalog", disabled:self.catalogBusy, onClick:self.refreshCatalog })]),
      self.catalog ? el("p", "note catalog-root", "目录："+self.catalog.root, {id:"catalog-root"}) : null,
      el("p", "note", self.turn.running || self.approval ? "请先结算执行任务并处理待审批工单。" : self.budgetBusy || self.appearanceBusy ? "正在保存当前会话配置，请稍后切换。" : self.catalogNote, {id:"catalog-note", role:"status", "aria-live":"polite"}),
      el('div','catalog-filter',[
        el('span','note','日志状态'),
        ...[['all','全部'],['ready','可正常回放'],['truncated-tail','尾部不完整'],['replay-rejected','日志回放失败']].map(([status,label])=>
          el('button','catalog-filter-btn',label,{'data-catalog-status':status,'aria-pressed':self.catalogStatus===status,
            disabled:sessionLocked,onClick:()=>{self.catalogStatus=status;}})),
      ],{role:'group','aria-label':'按会话日志状态筛选'}),
      el("label", "field-label", "新会话名称", {for:"new-session-title"}),
      el("div", "catalog-create", [el("input", "input", null, {id:"new-session-title", value:self.newSessionTitle, maxlength:80, disabled:self.catalogBusy,
        placeholder:"例如：整理项目文档", onInput:e=>{self.newSessionTitle=e.target.value;} }),
        el("button", "btn btn-primary", "新建会话", {id:"create-session", disabled:sessionLocked || !self.newSessionTitle.trim(), onClick:self.createSession})]),
      el("div", "catalog-list", self.catalog ? self.catalog.entries.filter(item=>self.catalogStatus==='all'||item.status===self.catalogStatus).map(item=>el("article", "catalog-card", [
        el("h3", "catalog-title", item.title || "未命名会话", {title:item.title || "未命名会话"}),
        el("span", "badge"+(item.status!=="ready" ? " badge-warn" : ""), item.current ? "当前会话" : "本地会话"),
        el("p", "note catalog-meta", item.status==="replay-rejected" ? "日志回放失败，摘要不可用" : "已保存 "+item.durable+" 条事件"+(item.status==="truncated-tail" ? " · 尾帧不完整" : "")),
        el("p", "note catalog-id", item.id==="current" ? "默认会话" : "会话目录："+item.id),
        el("button", "btn catalog-select", item.current ? "已打开" : "打开会话", {"data-select-session":item.id,
          disabled:sessionLocked || item.current || item.status==="replay-rejected", onClick:()=>self.selectSession(item.id)}),
      ], {"data-session-id":item.id})) : [], {id:"catalog-list", "aria-busy":String(self.catalogBusy)}),
      self.catalog && !self.catalog.entries.length ? el("p", "empty-card", "此目录暂无落盘会话。") : null,
      self.catalog?.entries.length && !self.catalog.entries.some(item=>self.catalogStatus==='all'||item.status===self.catalogStatus) ? el('p','empty-card','无匹配会话',{id:'catalog-filter-empty',role:'status'}) : null,
      el("p", "note", "切换前会保存当前会话；待审批工单和执行任务需要先处理完毕。项目目录随会话恢复。"),
    ]);
    const workspaceDialog=h(window.SaCodeSlots.ProjectPicker,{open:self.workspaceOpen,busy:sessionLocked,loading:self.workspaceRecentBusy,
      workspace:self.workspace,recent:self.workspaceRecent,note:self.workspaceNote,onClose:()=>{self.workspaceOpen=false;},
      onBrowse:self.chooseWorkspace,onSelect:self.selectRecentWorkspace});
    const size=self.globalAppearance.fontSize;
    const fontAxis=Number.isInteger(size)?{'--fs-content':size+'px','--line-content':(size+10)+'px','--line-user':(size+8)+'px','--content-delta':(size-14)+'px'}:{};
    const frameHandle = (name,left,value,min,max) => el('div','frame-divider',null,{id:name+'-divider',role:'separator',tabindex:0,
      'aria-label':name==='sidebar'?'调整导航宽度':'调整侧栏宽度','aria-orientation':'vertical','aria-valuemin':min,'aria-valuemax':max,'aria-valuenow':value,
      style:{left:left+'px'},onPointerdown:e=>self.beginFrameResize(name,e),onKeydown:e=>self.resizeFrameKey(name,e)});
    const main = el('section','pane conversation',[
      withDirectives(el('div','conversation-scroll',[
        h(CLIENT_VIEWS.Outlet, { owner: { transcript, activeView: 'chat' }, sessionId: String(self.scrollSession) }),
        el('div','composer-seat',[composer],{'data-composer-seat':''}),
      ]),[[window.SaCodeConversationScroll.directive,{
        session:self.scrollSession,lastUser:self.bubbleMessages.filter(m=>m.role==='user').at(-1)?.id,
        onChange:following=>{self.followingTail=following;},
        onAnchor:id=>{self.turnAnchor=id;},
      }]]),
      !self.followingTail && !emptyConversation ? el('div','to-bottom-slot',[el('button','to-bottom',[navIcon('M6 9l6 6 6-6')],{
        id:'scroll-to-bottom','aria-label':'回到最新消息',tooltip:{label:'回到最新消息'},
        onClick:()=>window.SaCodeConversationScroll.toBottom(document.querySelector('.conversation-scroll')),
      })]) : null,
      // 历史对话侧栏：覆盖在对话区右缘，不改 .conversation 的盒子（框架列宽判据依赖它）。
      // 窄对话列或不足两轮时不出现——一条历史不需要导航。
      self.frameColumns.center>=760 && self.turnOutline.length>1 ? el('nav','turn-nav',self.turnOutline.map((entry,index)=>el('button','turn-nav-entry'+(index===self.turnActive?' active':''),[
        el('span','turn-nav-tick'),el('span','turn-nav-title',entry.title),
        el('span','turn-nav-card',[el('span','turn-nav-card-title',entry.title),el('span','turn-nav-card-text',entry.content),
          el('span','turn-nav-card-meta',entry.replies.length ? `回复 ${entry.replies.length} 条 · ${entry.replies[0].role==='assistant'?'助手':'工具'}：${entry.replies[0].text}` : '该轮还没有回复')]),
      ],{type:'button','data-turn-anchor':entry.id,'aria-label':`跳到第 ${index+1} 轮：${entry.title}`,
        'aria-current':index===self.turnActive?'true':null,
        onClick:()=>window.SaCodeConversationScroll.jumpTo(document.querySelector('.conversation-scroll'),entry.id)})),{'aria-label':'历史对话导航'}) : null,
      self.error ? el('div','error-bar',[el('p','error',self.error,{id:'error',role:'alert'}),self.canRetryLastTurn?el('button','btn btn-small',self.sendBusy?'重试中…':'重试上一条',{id:'retry-last-turn',type:'button',disabled:self.sendBusy,onClick:self.retryLastTurn}):null]) : null,
    ]);
    const center = self.managementPage ? el('div','conversation-center product-management-center',[h(window.SaCodeSlots.ProductManagementPage,{key:self.managementPage+':'+self.scrollSession+':'+(self.workspace?.directory||''),page:self.managementPage,draft:self.managementDraft(self.managementPage),directory:self.workspace?.configured?self.workspace.directory:'',models:self.customModels,recent:self.workspaceRecent,readRecent:()=>window.sacode.workspaceRecent(),onModels:()=>{self.settingsTab='model-center';self.settingsOpen=true;},onBack:()=>{const previous=self.managementPage;self.managementPage='';window.Vue.nextTick(()=>requestAnimationFrame(()=>{if(!self.managementPage&&!self.pluginManagerOpen){const entry=document.getElementById('open-'+previous);(entry?.getClientRects().length?entry:document.getElementById('toggle-sidebar'))?.focus();}}));}})],{style:{'--conversation-width':self.frameColumns.center+'px'}}) : self.pluginManagerOpen ? el('div','conversation-center plugin-manager-center',[el('header','management-header',[el('h1',null,'扩展管理'),el('button','btn',[navIcon('m14 6-6 6 6 6'),el('span',null,'返回对话')],{id:'back-to-chat',type:'button',onClick:()=>{self.pluginManagerOpen=false;window.Vue.nextTick(()=>document.getElementById('open-extensions')?.focus());}})]),h(window.SaCodePluginManager.Page,{adapter:self.pluginManagerAdapter?.adapter||undefined,unwired:self.pluginManagerAdapter?.unwired||undefined})],{style:{'--conversation-width':self.frameColumns.center+'px'}}) : el('div','conversation-center'+(emptyConversation?' is-empty':''),[head,main],{style:{'--conversation-width':self.frameColumns.center+'px'}});
    return el("div", "app", [el('div','window-caption',null,{'aria-hidden':'true'}),nav,center,side,
      !self.workbenchExpanded&&!self.sidebarCollapsed?frameHandle('sidebar',self.frameColumns.sidebar,self.sidebarWidth,264,420):null,
      !self.workbenchExpanded&&self.sideOpen&&self.frameColumns.rightbar>0?frameHandle('rightbar',self.frameColumns.sidebar+self.frameColumns.center,self.frameColumns.rightbar,300,Math.round(innerWidth*.7)):null,
      detail, floating, settings, catalogDialog, workspaceDialog],{style:{...fontAxis,'--caption-left':(self.sidebarCollapsed?88:self.frameColumns.sidebar)+'px',gridTemplateColumns:`${self.frameColumns.sidebar}px minmax(0,1fr) ${self.frameColumns.rightbar}px`},'data-platform':nativePlatform,'data-management-page':self.managementPage||(self.pluginManagerOpen?'extensions':'chat'),'data-workbench-expanded':String(self.workbenchExpanded),'data-sidebar-collapsed':String(self.sidebarCollapsed),'data-empty-conversation':String(emptyConversation),'data-catalog-ready':String(!!self.catalog)});
  },
}).mount("#app");
