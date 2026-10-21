// 工作台右侧面板装配：工具与审批、开发诊断、工作区文件、会话轨迹、使用指南、文档预览。
// 这批面板原先长在 app.js 的 render 里；这里只搬同一套装配，不新增状态——
// 会话事实仍由 core 投影，界面只保留布局与控件接线。
// 经典脚本（CSP script-src 'self'）。
(function (root) {
  'use strict';
  const sourceTraceSession = new WeakMap();
  const safeAuditText = (value, limit) => typeof value === 'string' ? value.slice(0, limit || 512) : '';
  const parseRetrievalAudit = (event) => {
    if (!event || typeof event.data !== 'string') return null;
    try {
      const value = JSON.parse(event.data);
      if (!value || typeof value !== 'object' || Array.isArray(value) ||
          typeof value.status !== 'string' || typeof value.workspace !== 'string' || !Array.isArray(value.matches)) return null;
      return value;
    } catch (_) { return null; }
  };
  const retrievalStatus = (value) => ({
    matched: '已匹配', partial: '部分匹配', 'no-match': '未匹配', skipped: '未执行检索',
    'budget-exhausted': '上下文预算不足', 'discarded-changed-snapshot': '快照变化，结果已丢弃',
  }[value] || '未知状态');
  // 对话与手动工具面共用同一工单视图；模型工单只在当前运行会话展示。
  function renderApprovalCard(self, { el }) {
    const proposal = self.approval;
    if (!proposal) return null;
    if (proposal.source === 'model' && (!self.turn.running || proposal.sessionId !== String(self.scrollSession))) return null;
    return el('section', 'approval', [
      el('p', null, '等待审批：' + ({ write:'写入文件', read:'读取文件' }[proposal.name] || proposal.name) + '（工单 #' + proposal.approvalId + '，仅本次调用）'),
      proposal.source === 'model' ? el('pre', 'model-approval-arguments', proposal.displayArguments, { tabindex:0, 'aria-label':'完整工具参数' }) : null,
      el('p', 'note', '请核对完整参数；工单过期后将拒绝执行。'),
      el('div', 'approval-row', [
        el('button', 'btn btn-primary', '允许一次', { id:'allow-once', onClick:()=>self.answerTool('allowed-once') }),
        el('button', 'btn btn-danger', '拒绝', { id:'deny', onClick:()=>self.answerTool('denied') }),
      ]),
    ], { id:'approval', role:'region', 'aria-label':'当前工具调用审批' });
  }
  function renderPanels(self, { h, el, navIcon, turnBar, renderTreeEntries }) {
    const refreshSources = () => {
      const session = self.scrollSession;
      // 首次打开时无法证明现存 traceEvents 属于当前会话；清掉未绑定会话身份的旧页后再取当前记录。
      if (!sourceTraceSession.has(self) || sourceTraceSession.get(self) !== session) {
        self.traceEvents = [];
        self.traceMore = false;
        self.traceError = '';
      }
      sourceTraceSession.set(self, session);
      self.refreshTrace(true, session);
    };
    // 来源页复用当前会话的持久轨迹。会话在来源页打开时切换，也要重新读取，避免展示上一会话的审计。
    if (self.sideTab === 'sources' && (!sourceTraceSession.has(self) || sourceTraceSession.get(self) !== self.scrollSession)) refreshSources();
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

    const approvalBox = self.approval && self.approval.source !== 'model'
      ? [renderApprovalCard(self, { el })] : [];

    const sideTabs = h(window.SaCodeSlots.WorkbenchTabs,{active:self.sideTab,pendingApproval:!!self.approval,expanded:self.workbenchExpanded,split:self.sideSplit,
      onSelect:id=>{self.sideTab=id;if(id==='sources')refreshSources();},onClose:id=>{if(id==='preview')self.filePreview.close();},
      onExpand:()=>{self.workbenchExpanded=!self.workbenchExpanded;window.Vue.nextTick(()=>document.getElementById('expand-workbench')?.focus());},
      onSplit:()=>{self.sideSplit=!self.sideSplit;},
      onClosePanel:()=>{self.workbenchExpanded=false;self.sideOpen=false;window.Vue.nextTick(()=>document.getElementById('toggle-side')?.focus());},
    });
    const inspection = el("div", "side-page", [
      el("section", "side-section", [el("h2", null, "工具与审批"),
      toolBtns,
      approvalBox,
      self.outcome ? el("div", self.outcomeKind || "outcome", self.outcome, { id: "outcome" }) : null,
      el("p", "note", "未登记 " + self.toolCounters.misses + " · 安全校验拒绝 " + self.toolCounters.guardDenials, { id: "tool-counters" }),
      ], { id: "tools-panel", tabindex: -1 }),
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
    const filesPage = el("div", "side-page", [
      el("section", "side-section", [el("h2", null, "工作区文件"),
        self.workspaceFilesBusy ? el("p", "note", "加载中…", { role: "status", "aria-live": "polite" }) :
        !self.workspaceFiles.length ? el("p", "note", self.workspace?.configured ? "工作区暂无文件" : "尚未配置工作区目录") : null,
        ...renderTreeEntries(self.workspaceFiles, "", 0, {
          open: self.fileTreeOpen, children: self.fileTreeChildren, busy: self.fileTreeBusy, toggle: self.toggleTreeDir, select:self.openWorkspaceFile,
        }),
      ], { id: "files-panel", tabindex: -1 }),
    ], { id: "side-page-files", role: "tabpanel", "aria-labelledby": "side-tab-files", hidden: self.sideTab !== "files" });
    const sourceView = self.sideTab === 'sources';
    const traceEvents = Array.isArray(self.traceEvents) ? self.traceEvents : [];
    const retrievalEvents = traceEvents.filter(ev => ev && ev.type === 'knowledge/retrieval');
    const tracePage = el("div", "side-page", [sourceView ?
      el("section", "side-section", [
        el("div", "preview-heading", [el("h2", null, "来源"),
          el("button", "btn", self.traceBusy ? "刷新中…" : "刷新", {
            id: "refresh-sources", disabled: !!self.traceBusy, onClick: () => self.refreshTrace(true, self.scrollSession),
          }),
        ]),
        el("p", "note", "当前会话已持久化的知识检索来源；仅显示审计元数据，不显示知识正文。"),
        self.traceError ? el("p", "note", "读取来源审计失败，请检查会话连接后重试。", { role: "alert", id: "sources-error" }) : null,
        self.traceBusy && !retrievalEvents.length ? el("p", "note", "正在读取来源…", { role: "status" }) : null,
        !self.traceBusy && !self.traceError && !retrievalEvents.length ? el("div", "empty-card", [
          el("h3", null, "当前会话暂无知识检索来源"),
          el("p", "note", "完成一次包含知识库检索的任务后，来源审计会显示在这里。"),
        ], { id: "sources-empty" }) : null,
        retrievalEvents.length ? el("div", "trace-timeline", retrievalEvents.slice().reverse().map((event, eventIndex) => {
          const audit = parseRetrievalAudit(event);
          if (!audit) return el("article", "trace-event", [
            el("span", "trace-type", "来源审计格式无法识别"),
          ], { key: "invalid-" + String(event.seq || eventIndex) });
          const matches = audit.matches.filter(match => match && typeof match === 'object' && !Array.isArray(match));
          return el("article", "trace-event", [
            el("div", "source-audit", [
              el("strong", null, "检索状态：" + retrievalStatus(safeAuditText(audit.status, 64))),
              el("p", "note", "工作区：" + (safeAuditText(audit.workspace) || "未记录")),
              matches.length ? el("div", "source-matches", matches.map((match, matchIndex) => {
                const scope = safeAuditText(match.scope, 64) || "未知范围";
                const id = safeAuditText(match.id, 160) || "未知来源";
                const revision = Number.isSafeInteger(match.revision) && match.revision >= 0 ? String(match.revision) : "未知";
                const sourcePath = safeAuditText(match.sourcePath) || "（无文件路径）";
                return el("div", "source-match", [
                  el("strong", null, scope + " · " + id),
                  el("span", "trace-type", "修订 " + revision),
                  el("p", "preview-path", sourcePath),
                ], { key: String(event.seq || eventIndex) + "-" + matchIndex });
              })) : el("p", "note", "此检索没有匹配到来源。"),
            ]),
          ], { key: String(event.seq || eventIndex) });
        })) : null,
        self.traceMore ? el("button", "btn", "加载更早的来源", { disabled: !!self.traceBusy, onClick: () => self.refreshTrace(false, self.scrollSession) }) : null,
      ], { id: "sources-panel", tabindex: -1 }) :
      el("section", "side-section", [el("h2", null, "会话轨迹"),
        el("p","note","当前会话已落盘的事件时间线（按 seq 倒序显示最近一页）。"),
        self.traceError ? el("p","note","读取失败："+self.traceError,{role:"alert"}) : null,
        self.traceBusy && !traceEvents.length ? el("p","note","加载中…",{role:"status"}) : null,
        !self.traceBusy && !traceEvents.length && !self.traceError ? el("p","note","尚无已落盘事件") : null,
        traceEvents.length ? el("div","trace-timeline",traceEvents.slice().reverse().map(ev=>el("div","trace-event",[
          el("span","trace-seq","#"+ev.seq),
          el("span","trace-type",String(ev.type||"event")),
        ]))) : null,
        self.traceMore ? el("button","btn","加载更早的事件",{onClick:()=>self.refreshTrace(false)}) : null,
      ], { id: "trace-panel", tabindex: -1 }),
    ], { id: sourceView ? "side-page-sources" : "side-page-trace", role: "tabpanel", "aria-labelledby": sourceView ? "side-tab-sources" : "side-tab-trace", hidden: !sourceView && self.sideTab !== "trace" });
    const guide = el("div", "side-page", [
      el("section", "side-section", [
        el("h2", null, "SaCode 使用指南"),
        self.approval ? el("button", "btn", "返回处理待审批请求", { id: "guide-approval", onClick: () => self.openSide("tools-panel") }) : null,
        ...[
          ["记录任务", "在底部输入任务或补充信息，点击发送后写入当前本地会话。发送消息与启动执行是两个独立操作。"],
          ["运行与停止", "侧栏的开发诊断可验证执行与取消。当前轮次使用示例输出，真实模型任务尚未开放；执行中可点击输入区停止按钮。"],
          ["工具与审批", "在工具页查看工具说明。需要审批的操作只有允许一次或拒绝两种选择；查看详情不会执行工具。"],
          ["模型用量与保存", "在设置的模型中心查看用量、预算及费用统计。已保存表示内容已落盘，待保存表示仍有未提交记录；审批或工具调用后应留意保存状态。"],
          ["快捷键", "Ctrl+, 打开设置；Ctrl+L 聚焦输入；Ctrl+Shift+P 打开文档预览；输入区 Ctrl+Enter 发送。弹窗打开时全局操作暂停，Escape 只关闭最上层。"],
        ].map(([title, text]) => el("article", "guide-card", [el("h3", null, title), el("p", "note", text)])),
      ], { id: "guide-panel", tabindex: -1 }),
    ], { id: "side-page-guide", role: "tabpanel", "aria-labelledby": "side-tab-guide", hidden: self.sideTab !== "guide" });
    void self.filePreviewRevision;
    const previewBody = (prefix) => [
      el("section", "side-section", [
        el("div", "preview-heading", [el("h2", null, "文档预览"),
          prefix !== "float-preview" ? el("button", "btn", "浮动预览", { id: prefix + "-float", onClick: () => { self.previewFloating = true; } }) : null,
        ]),
        self.filePreview.state.path && prefix!=="split-preview" ? [
          el("p","preview-path",self.filePreview.state.path),
          self.filePreview.state.busy?el("p","note","正在通过读取工具获取文件…",{role:"status"}):null,
          self.filePreview.state.error?el("div","file-preview-error",[el("p","note",self.filePreview.state.error,{role:"alert"}),el("button","btn","重新读取",{onClick:()=>self.openWorkspaceFile(self.filePreview.state.path)})]):null,
          self.filePreview.state.loaded?el("pre","preview-text",self.filePreview.state.text,{tabindex:0}):null,
          el("p","note","本次工具读取快照；内容可能按核心规则截断，重新读取会走工具授权与记录流程。"),
          el('button','btn','编辑文件',{disabled:!self.filePreview.state.loaded||self.filePreview.state.busy,onClick:()=>self.openFileEditor(self.filePreview.state.path)}),
          el("p","note","编辑可查看保存前差异；Git 标签可查看索引与工作区变更。"),
        ] : self.readPreview ? [
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
    return { sideTabs, inspection, filesPage, tracePage, guide, previewBody };
  }
  root.SaCodeSidePanels = Object.freeze({ renderPanels, renderApprovalCard });
})(globalThis);
