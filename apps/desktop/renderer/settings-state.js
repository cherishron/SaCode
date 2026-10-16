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
      autoLaunch, autoLaunchBusy, autoLaunchNote,
      getSessionGeneration, cleanErr,
      busySendSaving, busySendNote, busySendError,
      tips, tipsHidden, tipsPressure, tipsBusy, tipsNote, tipsError, catalogError,
      profile, profileDraft, profileBusy, profileNote, profileError,
      aboutVersion,
    } = deps;

    let profileEpoch = 0, profileDisposed = false, profileReading = false;
    const profileFailure = e => {
      const message = String(e.message || e);
      if (message.includes('bad-profile-nickname')) return '昵称请输入1–40个字符，不能包含控制字符。';
      if (message.includes('profile-revision-conflict')) return '资料已由其他窗口修改；请重新读取后再保存，输入已保留。';
      if (message.includes('profile-already-owned')) return '另一窗口正在保存资料，请稍后重试。';
      if (message.includes('profile-replay-rejected') || message.includes('profile-path-rejected')) return '资料文件无法安全读取，未覆盖原文件。';
      if (message.includes('profile-owner-unknown')) return '无法确认资料写锁的归属，未保存变更。';
      return '无法读取或保存本机资料，请检查D盘用户数据目录。';
    };
    function checkedProfile(value) {
      if (!value || typeof value.nickname !== 'string' || !value.nickname.trim() || !Number.isSafeInteger(value.revision) || value.revision < 0) throw Error('invalid-profile-response');
      return { nickname: value.nickname, revision: value.revision };
    }
    async function refreshProfile() {
      if (!profile || profileDisposed || profileBusy.value || profileReading) return;
      profileReading = true;
      const epoch = ++profileEpoch, before = profile.value, draftBefore = profileDraft.value;
      try {
        const value = checkedProfile(await api.profileGet());
        if (profileDisposed || epoch !== profileEpoch) return;
        const unchanged = profileDraft.value === draftBefore;
        const dirty = before && draftBefore !== before.nickname;
        profile.value = value;
        if (unchanged && !dirty) profileDraft.value = value.nickname;
        profileError.value = false; profileNote.value = '';
      } catch (e) {
        if (!profileDisposed && epoch === profileEpoch) { profileError.value = true; profileNote.value = profileFailure(e); }
      } finally { profileReading = false; }
    }
    async function saveProfile() {
      if (!profile?.value || profileDisposed || profileBusy.value) return;
      const nickname = profileDraft.value.trim(), expectedRevision = profile.value.revision;
      if (!nickname || Array.from(nickname).length > 40 || /[\x00-\x1f\x7f]/.test(nickname)) {
        profileError.value = true; profileNote.value = '昵称请输入1–40个字符，不能包含控制字符。'; return;
      }
      const epoch = ++profileEpoch;
      profileBusy.value = true; profileError.value = false; profileNote.value = '正在保存本机昵称…';
      try {
        const value = checkedProfile(await api.profileUpdate(nickname, expectedRevision));
        if (profileDisposed || epoch !== profileEpoch) return;
        profile.value = value; profileDraft.value = value.nickname; profileNote.value = '昵称已保存。';
      } catch (e) {
        if (!profileDisposed && epoch === profileEpoch) { profileError.value = true; profileNote.value = profileFailure(e); }
      } finally { if (!profileDisposed && epoch === profileEpoch) profileBusy.value = false; }
    }
    function disposeProfile() { profileDisposed = true; ++profileEpoch; }

    async function showStartupTip() {
      try { const r = await api.tipsStartup(); if (r && r.id && r.text) tips.value = { kind: 'startup', text: r.text, reliable: false }; }
      catch (e) { tipsError.value = true; tipsNote.value = catalogError(e); }
    }
    let pressureReadSequence = 0;
    function acceptPressure(r, reliable) {
      tipsPressure.value = reliable && r && Number.isFinite(r.window) && r.window > 0 && Number.isFinite(r.used) && r.used >= 0
        ? { projectedTokens: r.used, contextWindow: r.window } : undefined;
    }
    async function showContextTip() {
      const generation = getSessionGeneration(), sequence = ++pressureReadSequence;
      const current = () => generation === getSessionGeneration() && sequence === pressureReadSequence;
      try {
        const r = await api.tipsAfterReply();
        if (!current()) return;
        acceptPressure(r, !!r && Number.isFinite(r.percent) && r.percent >= 0);
        if (r && r.id && r.text) tips.value = { kind: 'context', text: r.text, reliable: Number.isFinite(r.percent) };
      } catch (e) { if (current()) { tipsPressure.value = undefined; tipsError.value = true; tipsNote.value = catalogError(e); } }
    }
    async function refreshTips() {
      const generation = getSessionGeneration(), sequence = ++pressureReadSequence;
      const current = () => generation === getSessionGeneration() && sequence === pressureReadSequence;
      try {
        const r = await api.tipsGet();
        if (!current()) return;
        tipsHidden.value = !!r.hidden; tipsError.value = false;
        acceptPressure(r, r.reliable === true);
      } catch (e) { if (current()) { tipsPressure.value = undefined; tipsError.value = true; } }
    }
    async function setTipsHidden(value) {
      if (tipsBusy.value) return;
      tipsBusy.value = true; tipsError.value = false; tipsNote.value = '正在保存提醒偏好…';
      try {
        const r = await api.tipsSetHidden(value);
        tipsHidden.value = !!r.hidden;
        tipsNote.value = tipsHidden.value ? '已保存，使用提醒已关闭。' : '已保存，使用提醒已开启。';
        if (tipsHidden.value) tips.value = null;
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

    // 通用偏好只认已知值：宿主返回未预期的值时回落保守档，不把未知串当设置生效。
    function normalizedPrefs(r) {
      return {
        transcriptView: r.transcriptView === 'compact' || r.transcriptView === 'expanded' ? r.transcriptView : 'default',
        composerEnter: r.composerEnter === 'newline' ? 'newline' : 'send',
        sessionLog: r.sessionLog === 'on' ? 'on' : 'off',
        // 新会话默认权限只认核心 PermissionPolicy 的四档；未接或读坏时回落最保守的 build。
        defaultPermissionMode: ['plan', 'build', 'auto', 'yolo'].includes(r.defaultPermissionMode) ? r.defaultPermissionMode : 'build',
      };
    }

    async function refreshGeneralPrefs() {
      try {
        const r = await api.globalSettingsGet();
        if (r && typeof r === 'object') {
          generalPrefs.value = normalizedPrefs(r);
        }
      } catch (e) { generalPrefsNote.value = '配置读取失败：' + String(e.message || e); }
    }

    async function setGeneralPref(key, value) {
      if (generalPrefsBusy.value) return;
      generalPrefsBusy.value = key; generalPrefsNote.value = '';
      try {
        const r = await api.globalSettingsSet(key, value);
        if (r && typeof r === 'object') {
          generalPrefs.value = normalizedPrefs(r);
        }
      } catch (e) { generalPrefsNote.value = '保存失败：' + String(e.message || e); } finally { generalPrefsBusy.value = ''; }
    }

    // 开机自启：状态与写入都走壳层的登录项接口，界面只呈现回读到的真实状态。
    // 读不到就置 null（界面写「读取失败」），不拿上次的值或刚提交的请求冒充当前系统设置。
    function checkedAutoLaunch(value) {
      if (!value || typeof value.openAtLogin !== 'boolean' || typeof value.packaged !== 'boolean') throw Error('invalid-autolaunch-response');
      return { openAtLogin: value.openAtLogin, packaged: value.packaged, note: typeof value.note === 'string' ? value.note : '' };
    }
    async function refreshAutoLaunch() {
      try { autoLaunch.value = checkedAutoLaunch(await api.autoLaunchGet()); }
      catch (e) { autoLaunch.value = null; }
    }
    async function setAutoLaunch(enabled) {
      if (autoLaunchBusy.value) return;
      autoLaunchBusy.value = true; autoLaunchNote.value = '';
      try {
        autoLaunch.value = checkedAutoLaunch(await api.autoLaunchSet(enabled));
      } catch (e) {
        autoLaunchNote.value = '开机自启设置失败：' + String(e.message || e);
      } finally { autoLaunchBusy.value = false; }
    }

    // 关于页只呈现壳层事实：版本与运行时都由 Electron 进程给出，不碰宿主、不猜更新状态
    // （更新检查确实尚未开放，界面如实写「尚未开放」而不是给一个跑不起来的按钮）。
    // ref 由装配方持有并随 deps 传入，与 profile/generalPrefs 同一套做法。
    function checkedVersion(value) {
      if (!value || typeof value.app !== 'string' || typeof value.electron !== 'string'
        || typeof value.chrome !== 'string' || typeof value.node !== 'string'
        || typeof value.platform !== 'string' || typeof value.arch !== 'string'
        || typeof value.packaged !== 'boolean') throw Error('invalid-version-response');
      return value;
    }
    async function refreshAboutVersion() {
      try { aboutVersion.value = checkedVersion(await api.appVersion()); }
      catch (e) { aboutVersion.value = null; }
    }

    return {
      refreshGlobalAppearance, setFontSize, setTheme, setBusySend, fontError,
      refreshUsage, setBudget,
      refreshGeneralPrefs, setGeneralPref,
      showStartupTip, showContextTip, refreshTips, setTipsHidden, dismissTips,
      refreshProfile, saveProfile, disposeProfile,
      aboutVersion, refreshAboutVersion,
      autoLaunch, autoLaunchBusy, autoLaunchNote, refreshAutoLaunch, setAutoLaunch,
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
    const about = self.aboutVersion;
    const aboutRows = about
      ? [el('p','note','版本 ' + about.app + '（' + about.platform + '-' + about.arch + ' · ' + (about.packaged ? '安装态' : '开发目录') + '）'),
         el('p','note','Electron ' + about.electron + ' · Chromium ' + about.chrome + ' · Node ' + about.node)]
      : [el('p','note','版本信息正在读取…')];
    return h(window.SaCodeDialog, { open: self.settingsOpen, title: "SaCode 设置", class: "settings-dialog", customFrame:true,
      onClose: () => { self.settingsOpen = false; } }, () => [
      el('nav','settings-nav',[
      el('h2','settings-title','SaCode 设置'),
      el("div", "settings-tabs", [["profile", "个人资料"], ["model-center", "模型中心"], ["general", "通用"], ["appearance", "外观"], ["conversation", "对话与输入"], ["plugins", "内置插件"], ["shortcuts", "快捷键"], ["privacy", "隐私与数据"], ["about", "关于"]].map(([id,label],index,tabs) => el("button", "settings-tab", [navIcon(({general:'M4 6h16M4 12h16M4 18h16M8 3v6M16 9v6',appearance:'M12 3v2M12 19v2M3 12h2M19 12h2M8 12a4 4 0 1 0 8 0 4 4 0 0 0-8 0',conversation:'M4 4h16v13H9l-5 4z','model-center':'M3 4h7v7H3zM14 4h7v7h-7zM3 15h7v7H3zM14 15h7v7h-7z',plugins:'M9 3h6v5h5v6h-5v6H9v-6H4V8h5z',shortcuts:'M3 6h18v12H3zM6 10h2M10 10h2M14 10h2M6 14h12',privacy:'M12 3l8 4v5c0 5-8 9-8 9s-8-4-8-9V7z',profile:'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8M4 21a8 8 0 0 1 16 0',about:'M12 8v1M12 11v7M3 12a9 9 0 1 0 18 0 9 9 0 0 0-18 0'})[id]),el('span','settings-nav-label',label)], {
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
        el('h2','settings-section-title','通用'),
        el('section','settings-row language-settings',[el('span','settings-row-title','语言'),el('output','settings-fixed-value','中文',{'aria-label':'界面语言'})]),
        // 新会话默认权限：四档就是核心 PermissionPolicy 的 plan/build/auto/yolo。
        // 这里只改「之后新建会话」的初始档，不动当前会话，也不等于放宽实际审批。
        el('section','settings-row',[
          el('div','settings-row-title',[
            el('strong',null,'新会话默认权限'),
            el('p','note','只作用于之后新建的会话，不改变当前会话；实际工具审批仍以核心权限裁决为准。'),
          ]),
          el('div','permission-choices',[['plan','Plan'],['build','Build'],['yolo','YOLO'],['auto','Auto Review']].map(([id,label])=>
            el('button','permission-choice',label,{
              id:'default-permission-'+id, type:'button',
              'aria-pressed': self.generalPrefs.defaultPermissionMode===id,
              disabled: !!self.generalPrefsBusy,
              onClick:()=>self.setGeneralPref('default-permission',id),
            })),{'aria-label':'新会话默认权限'}),
        ]),
        // 开机自启：开关状态取自壳层回读，读不到时不显示成已开启或已关闭。
        el('section','settings-row',[
          el('div','settings-row-title',[
            el('strong',null,'开机自启'),
            el('p','note',self.autoLaunch?(self.autoLaunch.note||'登录后自动启动本应用。'):'正在读取开机自启状态…'),
          ]),
          el('button','btn',self.autoLaunch?(self.autoLaunch.openAtLogin?'已开启':'已关闭'):'—',{
            id:'auto-launch-toggle', type:'button',
            disabled: !self.autoLaunch || !!self.autoLaunchBusy,
            onClick:()=>self.setAutoLaunch(!self.autoLaunch.openAtLogin),
          }),
        ]),
        el('p','note',self.autoLaunchNote,{role:'status','aria-live':'polite'}),
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
      el('section','settings-page',[
        el('h2','settings-section-title','个人资料'),
        el('div','profile-summary',[navIcon('M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8M4 21a8 8 0 0 1 16 0'),el('div',null,[el('strong',null,self.profile?.nickname||'本地用户'),el('p','note','本机资料，不关联云账号。')])]),
        el('form','profile-form',[
          el('label','field-label','昵称',{for:'profile-nickname'}),
          el('div','profile-edit-row',[
            el('input','input',null,{id:'profile-nickname','aria-label':'个人昵称',autocomplete:'nickname',maxlength:80,value:self.profileDraft,disabled:self.profileBusy||!self.profile,
              onInput:e=>{self.profileDraft=e.target.value;}}),
            el('button','btn btn-primary',self.profileBusy?'保存中…':'保存昵称',{id:'save-profile',type:'submit',disabled:self.profileBusy||!self.profile||!self.profileDraft.trim()}),
          ]),
          el('p','note',self.profileNote,{id:'profile-note',role:self.profileError?'alert':'status','aria-live':'polite'}),
          el('button','btn','重新读取',{id:'refresh-profile',type:'button',disabled:self.profileBusy,onClick:self.refreshProfile}),
        ],{'aria-busy':self.profileBusy,onSubmit:e=>{e.preventDefault();void self.saveProfile();}}),
        el('p','note','昵称保存在D盘本机用户数据目录；头像上传尚未开放。'),
      ],{id:'settings-page-profile',role:'tabpanel','aria-labelledby':'settings-tab-profile',hidden:self.settingsTab!=='profile'}),
      el('section','settings-page',[el('h2','settings-section-title','SaCode'),el('p',null,'自主开发工作台'),el('p','note','让灵感，有迹可循。'),...aboutRows,el('p','note','更新检查尚未开放。')],{id:'settings-page-about',role:'tabpanel','aria-labelledby':'settings-tab-about',hidden:self.settingsTab!=='about'}),
      self.modelCenter ? el("section", "settings-page", [h(self.modelCenter.Outlet, { owner: self.modelCenterOwner || { value: null } })], { id:"settings-page-model-center", role:"tabpanel", "aria-labelledby":"settings-tab-model-center", hidden:self.settingsTab!=="model-center" }) : el("section", "settings-page", [el("p","note","模型中心组件未加载")], { id:"settings-page-model-center", hidden:true }),
      el("section", "settings-page", [h(window.SaCodePlugins.Page, {
        tools: self.tools,
        // 插件清单适配器：包 = 已装插件，行 = 包内声明的工具。映射只搬数据，不冒充本地状态。
        adapter: self.pluginsInventoryAdapter,
        // 命名空间配置适配器：只有存在真实仓颉设置存储的命名空间才登记；其余保持「未接入」。
        configuration: { adapters: self.pluginConfigAdapters || {} },
      }),
      ], { id:"settings-page-plugins", role:"tabpanel", "aria-labelledby":"settings-tab-plugins", hidden:self.settingsTab!=="plugins" }),
      ]),
      ]),
    ]);
  }

  root.SaCodeSettings = { createSettingsAssembly, bindDesktopKeys, renderSettings };
})(globalThis);
