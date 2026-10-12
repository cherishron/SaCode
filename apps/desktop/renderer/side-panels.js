// 工作台右侧面板装配：工具与审批、开发诊断、工作区文件、会话轨迹、使用指南、文档预览。
// 这批面板原先长在 app.js 的 render 里；这里只搬同一套装配，不新增状态——
// 会话事实仍由 core 投影，界面只保留布局与控件接线。
// 经典脚本（CSP script-src 'self'）。
(function (root) {
  'use strict';
  function renderPanels(self, { h, el, navIcon, turnBar, renderTreeEntries }) {
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
          self.approval.source==='model' ? el('pre','model-approval-arguments',self.approval.displayArguments,{tabindex:0,'aria-label':'完整工具参数'}) : null,
          el("div", "approval-row", [
            el("button", "btn btn-primary", "允许一次", { id: "allow-once", onClick: () => self.answerTool("allowed-once") }),
            el("button", "btn btn-danger", "拒绝", { id: "deny", onClick: () => self.answerTool("denied") }),
          ]),
        ], { id: "approval" })]
      : [];

    const sideTabs = h(window.SaCodeSlots.WorkbenchTabs,{active:self.sideTab,pendingApproval:!!self.approval,expanded:self.workbenchExpanded,split:self.sideSplit,
      onSelect:id=>{self.sideTab=id;},onClose:id=>{if(id==='preview')self.filePreview.close();},
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
    const tracePage = el("div", "side-page", [
      el("section", "side-section", [el("h2", null, "会话轨迹"),
        el("p","note","当前会话已落盘的事件时间线（按 seq 倒序显示最近一页）。"),
        self.traceError ? el("p","note","读取失败："+self.traceError,{role:"alert"}) : null,
        self.traceBusy && !self.traceEvents.length ? el("p","note","加载中…",{role:"status"}) : null,
        !self.traceBusy && !self.traceEvents.length && !self.traceError ? el("p","note","尚无已落盘事件") : null,
        self.traceEvents.length ? el("div","trace-timeline",self.traceEvents.slice().reverse().map(ev=>el("div","trace-event",[
          el("span","trace-seq","#"+ev.seq),
          el("span","trace-type",String(ev.type||"event")),
        ]))) : null,
        self.traceMore ? el("button","btn","加载更早的事件",{onClick:()=>self.refreshTrace(false)}) : null,
      ], { id: "trace-panel", tabindex: -1 }),
    ], { id: "side-page-trace", role: "tabpanel", "aria-labelledby": "side-tab-trace", hidden: self.sideTab !== "trace" });
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
  root.SaCodeSidePanels = Object.freeze({ renderPanels });
})(globalThis);
