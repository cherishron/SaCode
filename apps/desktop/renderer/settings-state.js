// 全局设置/外观：主题、字体、预算、用量、通用偏好。
// 经典脚本（CSP script-src 'self'）。

(function (root) {
  'use strict';

  function createSettingsAssembly(deps) {
    const {
      api, ref,
      globalAppearance, fontBusy, fontNote, appearanceBusy, appearanceNote,
      budgetDraft, budgetNote, budgetBusy, usage,
      generalPrefs, generalPrefsBusy, generalPrefsNote,
      getSessionGeneration, cleanErr,
      busySendSaving, busySendNote, busySendError,
      tips, tipsHidden, tipsPressure, tipsBusy, tipsNote, tipsError, catalogError,
    } = deps;

    async function showStartupTip() {
      try { const r = await api.tipsStartup(); if (r && r.id && r.text) tips.value = { kind: 'startup', text: r.text, reliable: false }; }
      catch (e) { tipsError.value = true; tipsNote.value = catalogError(e); }
    }
    async function showContextTip() {
      try {
        const r = await api.tipsAfterReply();
        if (r && Number.isFinite(r.window) && r.window > 0 && Number.isFinite(r.used) && r.used >= 0) tipsPressure.value = { projectedTokens: r.used, contextWindow: r.window };
        if (r && r.id && r.text) tips.value = { kind: 'context', text: r.text, reliable: Number.isFinite(r.percent) };
      } catch (e) { tipsError.value = true; tipsNote.value = catalogError(e); }
    }
    async function refreshTips() {
      try {
        const r = await api.tipsGet();
        tipsHidden.value = !!r.hidden; tipsError.value = false;
        if (r.reliable && Number.isFinite(r.window) && r.window > 0 && Number.isFinite(r.used)) tipsPressure.value = { projectedTokens: r.used, contextWindow: r.window };
      } catch (e) { tipsError.value = true; }
    }
    async function setTipsHidden(value) {
      if (tipsBusy.value) return;
      tipsBusy.value = true; tipsError.value = false; tipsNote.value = '正在保存提醒偏好…';
      try {
        const r = await api.tipsSetHidden(value);
        tipsHidden.value = !!r.hidden; tipsNote.value = '已保存，界面立即停止出提醒。';
        if (value) tips.value = null;
      } catch (e) { tipsError.value = true; tipsNote.value = fontError(e); }
      finally { tipsBusy.value = false; }
    }
    const dismissTips = () => setTipsHidden(true);

    function fontError(e) {
      const message = String(e.message || e);
      if (message.includes('settings-already-owned')) return '另一入口正在保存配置，请稍后重试。';
      if (message.includes('settings-replay-rejected')) return '全局外观配置损坏，未保存变更。';
      return '无法读取或保存全局外观配置，请检查用户配置目录。';
    }
    async function refreshGlobalAppearance() {
      try { globalAppearance.value = await api.globalAppearanceGet(); busySendError.value = false; busySendNote.value = ''; }
      catch (e) { fontNote.value = fontError(e); busySendError.value = true; busySendNote.value = fontError(e); }
    }
    async function setBusySend(value) {
      if (busySendSaving.value) return;
      busySendSaving.value = true; busySendError.value = false; busySendNote.value = '正在保存发送偏好…';
      try { globalAppearance.value = await api.globalAppearanceSetBusySend(value); busySendNote.value = '已保存，下一次发送生效。'; }
      catch (e) { busySendError.value = true; busySendNote.value = fontError(e); }
      finally { busySendSaving.value = false; }
    }
    async function setFontSize(value) {
      if (fontBusy.value || appearanceBusy.value) return;
      fontBusy.value = true; fontNote.value = '正在保存全局正文字号…';
      try { globalAppearance.value = await api.globalAppearanceSetFontSize(value); fontNote.value = '已保存全局正文字号。'; }
      catch (e) { fontNote.value = fontError(e); }
      finally { fontBusy.value = false; }
    }
    async function setTheme(theme) {
      if (appearanceBusy.value || fontBusy.value) return;
      appearanceBusy.value = true; appearanceNote.value = '正在保存全局主题…';
      try { globalAppearance.value = await api.globalAppearanceSetTheme(theme); appearanceNote.value = '已保存全局主题，切换会话后保持。'; }
      catch (e) { appearanceNote.value = fontError(e); }
      finally { appearanceBusy.value = false; }
    }

    async function refreshUsage() {
      const generation = getSessionGeneration();
      const u = await api.usageStatus();
      if (generation !== getSessionGeneration()) return;
      usage.value = { used: u.used, budget: u.budget, over: !!u.over, verdict: u.verdict || '' };
    }

    async function setBudget() {
      if (budgetBusy.value) return;
      const raw = String(budgetDraft.value);
      const n = Number(raw);
      if (raw === '' || !Number.isInteger(n) || n < 0) {
        budgetNote.value = '预算要填非负整数';
        return;
      }
      budgetBusy.value = true;
      budgetNote.value = '正在提交预算…';
      try {
        const r = await api.usageSetBudget(n);
        await refreshUsage();
        budgetNote.value = r.applied ? '已收紧到 ' + r.budget : '拒绝放宽：仍停在 ' + r.budget;
      } catch (e) {
        budgetNote.value = cleanErr(e);
      } finally {
        budgetBusy.value = false;
      }
    }

    async function refreshGeneralPrefs() {
      try {
        const r = await api.globalSettingsGet();
        if (r && typeof r === 'object') {
          generalPrefs.value = {
            transcriptView: r.transcriptView === 'compact' || r.transcriptView === 'expanded' ? r.transcriptView : 'default',
            composerEnter: r.composerEnter === 'newline' ? 'newline' : 'send',
            sessionLog: r.sessionLog === 'on' ? 'on' : 'off',
          };
        }
      } catch (e) { generalPrefsNote.value = '配置读取失败：' + String(e.message || e); }
    }

    async function setGeneralPref(key, value) {
      if (generalPrefsBusy.value) return;
      generalPrefsBusy.value = key; generalPrefsNote.value = '';
      try {
        const r = await api.globalSettingsSet(key, value);
        if (r && typeof r === 'object') {
          generalPrefs.value = {
            transcriptView: r.transcriptView === 'compact' || r.transcriptView === 'expanded' ? r.transcriptView : 'default',
            composerEnter: r.composerEnter === 'newline' ? 'newline' : 'send',
            sessionLog: r.sessionLog === 'on' ? 'on' : 'off',
          };
        }
      } catch (e) { generalPrefsNote.value = '保存失败：' + String(e.message || e); } finally { generalPrefsBusy.value = ''; }
    }

    return {
      refreshGlobalAppearance, setFontSize, setTheme, setBusySend, fontError,
      refreshUsage, setBudget,
      refreshGeneralPrefs, setGeneralPref,
      showStartupTip, showContextTip, refreshTips, setTipsHidden, dismissTips,
    };
  }

  function bindDesktopKeys({ target, document, settingsOpen, enhance, undoEnhance, openSide }) {
    function desktopKeys(event) {
      if (event.isComposing || event.repeat || event.altKey || !(event.ctrlKey || event.metaKey)) return;
      const key = event.key.toLowerCase();
      if (key === 'z' && !event.shiftKey) {
        if (enhance.value.undo && event.target && event.target.id === 'composer' && !document.querySelector('dialog:modal')) {
          event.preventDefault();
          undoEnhance();
        }
        return;
      }
      const settings = key === ',' && !event.shiftKey;
      const composer = key === 'l' && !event.shiftKey;
      const preview = key === 'p' && event.shiftKey;
      const search = key === 'k' && !event.shiftKey;
      if (!settings && !composer && !preview && !search) return;
      event.preventDefault();
      if (document.querySelector('dialog:modal')) return;
      if (settings) settingsOpen.value = !settingsOpen.value;
      else if (composer) document.getElementById('composer').focus();
      else if (search) document.getElementById('sidebar-search').focus();
      else if (preview) openSide('preview-panel');
    }
    target.addEventListener('keydown', desktopKeys);
    return () => target.removeEventListener('keydown', desktopKeys);
  }

  function renderSettings(self, { h, el, navIcon }) {
    return h(window.SaCodeDialog, { open: self.settingsOpen, title: "SaCode 设置", class: "settings-dialog", customFrame:true,
      onClose: () => { self.settingsOpen = false; } }, () => [
      el('nav','settings-nav',[
      el('h2','settings-title','SaCode 设置'),
      el("div", "settings-tabs", [["general", "通用"], ["appearance", "外观"], ["conversation", "对话与输入"], ["model-center", "模型中心"], ["plugins", "内置插件"], ["shortcuts", "快捷键"], ["privacy", "隐私与数据"], ["profile", "个人资料"], ["about", "关于"]].map(([id,label],index,tabs) => el("button", "settings-tab", [navIcon(({general:'M4 6h16M4 12h16M4 18h16M8 3v6M16 9v6',appearance:'M12 3v2M12 19v2M3 12h2M19 12h2M8 12a4 4 0 1 0 8 0 4 4 0 0 0-8 0',conversation:'M4 4h16v13H9l-5 4z','model-center':'M3 4h7v7H3zM14 4h7v7h-7zM3 15h7v7H3zM14 15h7v7h-7z',plugins:'M9 3h6v5h5v6h-5v6H9v-6H4V8h5z',shortcuts:'M3 6h18v12H3zM6 10h2M10 10h2M14 10h2M6 14h12',privacy:'M12 3l8 4v5c0 5-8 9-8 9s-8-4-8-9V7z',profile:'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8M4 21a8 8 0 0 1 16 0',about:'M12 8v1M12 11v7M3 12a9 9 0 1 0 18 0 9 9 0 0 0-18 0'})[id]),el('span','settings-nav-label',label)], {
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
        el('section','settings-row',[el('div',null,[el('strong',null,'新会话默认权限'),el('p','note','Plan / Build / Yolo / Auto Review 的默认权限契约尚未接入。')]),el('button','btn','待接入',{disabled:true})]),
        el('section','settings-row',[el('div',null,[el('strong',null,'开机自启'),el('p','note','尚无系统启动项接口，当前不会修改系统设置。')]),el('button','btn','待接入',{disabled:true})]),
      ], { id:"settings-page-general", role:"tabpanel", "aria-labelledby":"settings-tab-general", hidden:self.settingsTab!=="general" }),
      el("section", "settings-page", [
        el('h2','settings-section-title','外观'),
        el("section", "appearance-settings", [el("h2", "appearance-title", "主题"),
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
      ], { id:"settings-page-appearance", role:"tabpanel", "aria-labelledby":"settings-tab-appearance", hidden:self.settingsTab!=="appearance" }),
      el("section", "settings-page", [el('h2','settings-section-title','对话与输入'),
        h(self.generalSettings.Outlet,{owner:{visibleRows:['busy-send','transcript-view','composer-enter','tips'],
          'busy-send':{value:self.globalAppearance.busySend,busy:self.busySendSaving,note:self.busySendNote,error:self.busySendError,change:self.setBusySend,retry:self.refreshGlobalAppearance},
          'tips':{value:self.tipsHidden,busy:self.tipsBusy,note:self.tipsNote,error:self.tipsError,change:self.setTipsHidden,retry:self.refreshTips},
          'transcript-view':{value:self.generalPrefs.transcriptView,busy:!!self.generalPrefsBusy,change:(v)=>self.setGeneralPref('transcript-view',v)},
          'composer-enter':{value:self.generalPrefs.composerEnter,busy:!!self.generalPrefsBusy,change:(v)=>self.setGeneralPref('composer-enter',v)},
          'session-log':{value:self.generalPrefs.sessionLog,busy:!!self.generalPrefsBusy,change:(v)=>self.setGeneralPref('session-log',v)},
        }}),
        el('p','note',self.generalPrefsNote,{role:'status','aria-live':'polite'}),
        el('p','note','Shift+Enter 始终换行；增强直接替换草稿，Ctrl/Cmd+Z 回退。'),
      ], { id:"settings-page-conversation", role:"tabpanel", "aria-labelledby":"settings-tab-conversation", hidden:self.settingsTab!=="conversation" }),
      el('section','settings-page',[el('h2','settings-section-title','快捷键'),
        ...[['打开设置','Ctrl / Cmd + ,'],['聚焦输入框','Ctrl / Cmd + L'],['打开文件预览','Ctrl / Cmd + Shift + P'],['回退提示词增强','Ctrl / Cmd + Z'],['关闭弹窗或菜单','Esc']].map(([label,key])=>el('div','settings-row',[el('span',null,label),el('kbd',null,key)])),
        el('p','note','以上为当前桌面绑定，快捷键自定义尚未接入。'),
      ],{id:'settings-page-shortcuts',role:'tabpanel','aria-labelledby':'settings-tab-shortcuts',hidden:self.settingsTab!=='shortcuts'}),
      el('section','settings-page',[el('h2','settings-section-title','隐私与数据'),
        h(self.generalSettings.Outlet,{owner:{visibleRows:['session-log'],'session-log':{value:self.generalPrefs.sessionLog,busy:!!self.generalPrefsBusy,change:v=>self.setGeneralPref('session-log',v)}}}),
        el('p','note',self.generalPrefsNote,{role:'status','aria-live':'polite'}),
        el('p','note','此项仅保存日志偏好；上传服务是否执行需单独验收。数据导出、清理与保留管理尚未接入。'),
      ],{id:'settings-page-privacy',role:'tabpanel','aria-labelledby':'settings-tab-privacy',hidden:self.settingsTab!=='privacy'}),
      el('section','settings-page',[el('h2','settings-section-title','个人资料'),el('div','profile-summary',[navIcon('M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8M4 21a8 8 0 0 1 16 0'),el('div',null,[el('strong',null,'本地用户'),el('p','note','无需官方账号')])]),el('p','note','昵称、头像与资料持久化接口尚未接入。')],{id:'settings-page-profile',role:'tabpanel','aria-labelledby':'settings-tab-profile',hidden:self.settingsTab!=='profile'}),
      el('section','settings-page',[el('h2','settings-section-title','SaCode'),el('p',null,'自主开发工作台'),el('p','note','仓颉共享核心 · Electron · Vue runtime · OpenTiny'),el('p','note','版本与更新检测接口尚未接入，不显示猜测版本。')],{id:'settings-page-about',role:'tabpanel','aria-labelledby':'settings-tab-about',hidden:self.settingsTab!=='about'}),
      self.modelCenter ? el("section", "settings-page", [h(self.modelCenter.Outlet, { owner: self.modelCenterOwner || { value: null } })], { id:"settings-page-model-center", role:"tabpanel", "aria-labelledby":"settings-tab-model-center", hidden:self.settingsTab!=="model-center" }) : el("section", "settings-page", [el("p","note","模型中心组件未加载")], { id:"settings-page-model-center", hidden:true }),
      el("section", "settings-page", [h(window.SaCodePlugins.Page, {
        tools: self.tools,
        // 插件清单适配器：包 = 已装插件，行 = 包内声明的工具。映射只搬数据，不冒充本地状态。
        adapter: self.pluginsInventoryAdapter,
      }),
      ], { id:"settings-page-plugins", role:"tabpanel", "aria-labelledby":"settings-tab-plugins", hidden:self.settingsTab!=="plugins" }),
      ]),
      ]),
    ]);
  }

  root.SaCodeSettings = { createSettingsAssembly, bindDesktopKeys, renderSettings };
})(globalThis);
