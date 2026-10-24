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
      catalogError, clearEnhance, clearAttachments, resetExecution, resetModelSelection,
      foldOpen, fileEditor,
      worktreeController, resetWorktreePanel,
      refresh, refreshTools, refreshUsage, refreshWorkspace, refreshWorkspaceFiles,
      refreshQueue, refreshGlobalAppearance,
      previewFloating, detailName,
      budgetDraft, budgetNote, appearanceNote, workspaceNote,
      focusComposer,
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
      const currentCatalogId = catalog.value?.entries.find(item => item.current)?.id;
      const oldId = [scrollSession.value, selectedScrollId.value, currentCatalogId].find(value => value && value !== 'initial' && value !== 0);
      // Invalidate outstanding trace reads before Host changes its active session.
      // This prevents a late old-session reply from repainting the source panel.
      if (deps.invalidateTrace) deps.invalidateTrace();
      try {
        await api.sessionSelect(id);
      } catch (e) {
        // Keep the current session's sources available if selection failed. The
        // explicit id also lets Host reject a stale/mismatched subscription reply.
        if (oldId && oldId !== 'initial' && deps.refreshTrace) {
          try { await deps.refreshTrace(true, oldId); } catch (_) {}
        }
        throw e;
      }
      fileEditor.reset();
      incrementSessionGeneration();
      if (deps.tipsPressure) deps.tipsPressure.value = undefined;
      if (deps.tips) deps.tips.value = null;
      selectedScrollId.value = id;
      if (oldId) sessionDrafts.set(oldId, draft.value);
      // 换会话时把在途增强撤掉：那份迟到结果属于上一个会话的输入框，
      // 留在宿主槽位里既会顶掉下一次的发起，也可能落进别的草稿。
      if (deps.enhance?.value?.busy) { api.promptCancel?.().catch(() => {}); }
      clearEnhance();
      draft.value = sessionDrafts.get(id) || '';
      resetExecution(); foldOpen.ids.clear();
      error.value = '';
      if (outcome) outcome.value = '';
      if (outcomeKind) outcomeKind.value = '';
      previewFloating.value = false; detailName.value = ''; budgetDraft.value = ''; budgetNote.value = ''; appearanceNote.value = '';
      catalogNote.value = '已切换，正在加载会话…';
      clearAttachments(); resetModelSelection();
      await refresh(); await refreshTools(); await refreshUsage(); await refreshWorkspace(); await refreshWorkspaceFiles(); await refreshQueue();
      // 换会话=换绑定：上一个会话的名称草稿与状态都必须收起，面板重新读这一条会话的绑定。
      resetWorktreePanel(); await worktreeController.restore();
      await refreshGlobalAppearance();
      if (deps.refreshTips) await deps.refreshTips();
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
      let createdId = '';
      try {
        if (taskRunning()) throw new Error('请先结算执行任务并处理待审批工单。');
        if (busy()) throw new Error('正在处理当前会话，请稍后新建。');
        const created = await api.sessionCreate(newSessionTitle.value);
        createdId = created.id;
        catalog.value = await api.sessionCatalog();
        await applySelection(created.id);
        newSessionTitle.value = '';
      } catch (e) {
        // 日志已创建但打开失败时明确告诉用户从列表重试，不让重复点击新建产生多份日志。
        catalogNote.value = (createdId ? '新会话已创建，但未能打开；请从会话列表重试。' : '') + catalogError(e);
        error.value = catalogNote.value;
      }
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

    async function mutateMetadata(id, action, value) {
      if (catalogBusy.value || busy() || taskRunning() || editorBlocked()) return false;
      const entry=catalog.value?.entries.find(item=>item.id===id);
      if(!entry || entry.status==='replay-rejected')return false;
      catalogBusy.value=true;catalogNote.value='正在保存会话信息…';
      // turn 期间 durableCount 会增长，entry.durable 作为 expectedRevision 可能过期，
      // Host 回 session-revision-conflict。此时自动重读 catalog 拿新 revision 再试一次，
      // 不把 CAS 冲突的原始码直接抛给用户。
      const attempt=async(rev)=>{
        if(action==='rename')await api.sessionRename(id,value,rev);
        else await api.sessionArchive(id,value,rev);
      };
      try{
        try{
          await attempt(entry.durable);
        }catch(e){
          if(String(e.message||e).includes('session-revision-conflict')){
            // 重读到临时变量，找到 fresh entry 才更新 catalog；否则保留原目录不覆盖。
            const freshCatalog=await api.sessionCatalog();
            const fresh=freshCatalog?.entries.find(item=>item.id===id);
            if(!fresh)throw e;
            catalog.value=freshCatalog;
            await attempt(fresh.durable);
          }else throw e;
        }
        catalog.value=await api.sessionCatalog();
        catalogNote.value=action==='rename'?'会话名称已保存。':value?'会话已归档，可在列表中恢复。':'会话已恢复。';
        return true;
      }catch(e){catalogNote.value=catalogError(e);error.value=catalogNote.value;return false;}
      finally{catalogBusy.value=false;}
    }

    return { applySelection, selectSession, createSession, startNewSession, refreshCatalog, openCatalog, mutateMetadata };
  }

  root.SaCodeSessionState = { createSessionAssembly };
})(globalThis);
