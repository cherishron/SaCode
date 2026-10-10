// 会话管理：切换、新建、刷新目录。切换=换绑定，旧草稿存回、新草稿恢复，
// 在途增强/附件/审批/轮询全撤，面板重新按新会话读一次。
// 经典脚本（CSP script-src 'self'）。

(function (root) {
  'use strict';

  function createSessionAssembly(deps) {
    const {
      api,
      ref,
      catalog, catalogBusy, catalogNote, catalogOpen, newSessionTitle,
      draft, error, selectedScrollId, scrollSession,
      turn, approval, sendBusy, budgetBusy, appearanceBusy, workspaceBusy,
      sessionDrafts, getSessionGeneration, incrementSessionGeneration,
      catalogError, clearEnhance, clearAttachments, stopPolling,
      foldOpen, loadCustomModels, fileEditor,
      worktreeController, resetWorktreePanel,
      refresh, refreshTools, refreshUsage, refreshWorkspace, refreshWorkspaceFiles,
      refreshQueue, refreshGlobalAppearance,
      selectedCustomModel, previewFloating, detailName,
      budgetDraft, budgetNote, appearanceNote, workspaceNote,
      queuePending, focusComposer,
      outcome, outcomeKind,
    } = deps;

    function busy() {
      return sendBusy.value || budgetBusy.value || appearanceBusy.value || workspaceBusy.value;
    }

    function taskRunning() {
      return turn.value.running || !!approval.value;
    }

    function editorBlocked() {
      return fileEditor.state.busy || fileEditor.dirty();
    }

    async function applySelection(id) {
      if (editorBlocked()) throw Error('请先保存或放弃文件编辑中的修改，再切换会话。');
      if (taskRunning()) throw new Error('请先结算执行任务并处理待审批工单。');
      if (busy()) throw new Error('正在处理当前会话，请稍后切换。');
      const oldId = catalog.value?.entries.find(item => item.current)?.id;
      await api.sessionSelect(id);
      fileEditor.reset();
      incrementSessionGeneration();
      selectedScrollId.value = id;
      if (oldId) sessionDrafts.set(oldId, draft.value);
      // 换会话时把在途增强撤掉：那份迟到结果属于上一个会话的输入框，
      // 留在宿主槽位里既会顶掉下一次的发起，也可能落进别的草稿。
      if (deps.enhance?.value?.busy) { api.promptCancel?.().catch(() => {}); }
      clearEnhance();
      draft.value = sessionDrafts.get(id) || '';
      stopPolling(); foldOpen.ids.clear();
      turn.value = { running: false, settled: false, text: '', finishReason: '', cancelled: false, interrupted: false, delivered: 0 };
      approval.value = null; error.value = '';
      if (outcome) outcome.value = '';
      if (outcomeKind) outcomeKind.value = '';
      previewFloating.value = false; detailName.value = ''; budgetDraft.value = ''; budgetNote.value = ''; appearanceNote.value = '';
      catalogNote.value = '已切换，正在加载会话…';
      queuePending.value = [];
      clearAttachments(); selectedCustomModel.value = ''; void loadCustomModels();
      await refresh(); await refreshTools(); await refreshUsage(); await refreshWorkspace(); await refreshWorkspaceFiles(); await refreshQueue();
      // 换会话=换绑定：上一个会话的名称草稿与状态都必须收起，面板重新读这一条会话的绑定。
      resetWorktreePanel(); await worktreeController.restore();
      await refreshGlobalAppearance();
      workspaceNote.value = '';
      catalog.value = await api.sessionCatalog();
      catalogOpen.value = false;
      focusComposer();
    }

    async function selectSession(id) {
      if (catalogBusy.value) return;
      if (catalog.value?.entries.some(item => item.current && item.id === id)) return;
      catalogBusy.value = true; catalogNote.value = '正在保存并切换会话…';
      try { await applySelection(id); }
      catch (e) { catalogNote.value = catalogError(e); error.value = catalogNote.value; }
      finally { catalogBusy.value = false; }
    }

    async function createSession() {
      if (editorBlocked()) { catalogNote.value = '请先保存或放弃文件编辑中的修改。'; return; }
      if (catalogBusy.value || !newSessionTitle.value.trim()) return;
      catalogBusy.value = true; catalogNote.value = '正在新建会话…';
      try {
        if (taskRunning()) throw new Error('请先结算执行任务并处理待审批工单。');
        if (busy()) throw new Error('正在处理当前会话，请稍后新建。');
        const created = await api.sessionCreate(newSessionTitle.value);
        newSessionTitle.value = '';
        catalog.value = await api.sessionCatalog();
        await applySelection(created.id);
      } catch (e) { catalogNote.value = catalogError(e); error.value = catalogNote.value; }
      finally { catalogBusy.value = false; }
    }

    async function startNewSession() {
      if (editorBlocked()) { catalogNote.value = '请先保存或放弃文件编辑中的修改。'; return; }
      if (busy() || catalogBusy.value || taskRunning()) return;
      newSessionTitle.value = '新会话';
      await createSession();
    }

    async function refreshCatalog() {
      if (catalogBusy.value) return;
      catalogBusy.value = true; catalogNote.value = '正在读取本地会话…';
      try {
        catalog.value = await api.sessionCatalog();
        if (selectedScrollId.value === 'initial') {
          selectedScrollId.value = catalog.value.entries.find(item => item.current)?.id || 'initial';
          scrollSession.value = selectedScrollId.value;
        }
        catalogNote.value = '已读取落盘会话；列表不包含尚未保存的事件。';
      } catch (e) { catalogNote.value = '读取失败：' + String(e.message || e); }
      finally { catalogBusy.value = false; }
    }

    function openCatalog() { catalogOpen.value = true; refreshCatalog(); }

    return { applySelection, selectSession, createSession, startNewSession, refreshCatalog, openCatalog };
  }

  root.SaCodeSessionState = { createSessionAssembly };
})(globalThis);
