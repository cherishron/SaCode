// 工作区/文件树/会话轨迹：文件列表、目录树展开态、事件回放。
// 展开状态只是 UI 记忆，不是第二份文件系统事实。
// 经典脚本（CSP script-src 'self'）。

(function (root) {
  'use strict';

  function createWorkspaceAssembly(deps) {
    const {
      api, ref,
      workspaceOpen, workspace, workspaceBusy, workspaceNote, workspaceRecent, workspaceRecentBusy,
      workspaceFiles, workspaceFilesBusy,
      fileTreeOpen, fileTreeChildren, fileTreeBusy,
      traceEvents, traceCursor, traceMore, traceBusy, traceError,
      scrollSession, getSessionGeneration,
      incrementTraceGeneration, getTraceGeneration,
      catalogError, fileEditor,
      turn, approval, sendBusy, budgetBusy, appearanceBusy,
      refresh, refreshTools, refreshCatalog,
    } = deps;

    async function doRefreshWorkspace() {
      const generation = getSessionGeneration(), result = await api.workspaceGet();
      if (generation === getSessionGeneration()) {
        if (workspace.value?.directory !== result.directory) {
          fileTreeOpen.value = new Set(); fileTreeChildren.value = {}; workspaceFiles.value = [];
        }
        workspace.value = result;
      }
    }

    async function refreshWorkspaceFiles() {
      const generation = getSessionGeneration();
      workspaceFilesBusy.value = true;
      try {
        const result = await api.workspaceFiles('');
        if (generation !== getSessionGeneration()) return;
        workspaceFiles.value = result.files || [];
      } catch (e) { if (generation === getSessionGeneration()) workspaceFiles.value = []; }
      finally { if (generation === getSessionGeneration()) workspaceFilesBusy.value = false; }
    }

    async function toggleTreeDir(path) {
      const nextOpen = new Set(fileTreeOpen.value);
      if (nextOpen.has(path)) { nextOpen.delete(path); fileTreeOpen.value = nextOpen; return; }
      nextOpen.add(path); fileTreeOpen.value = nextOpen;
      if (fileTreeChildren.value[path]) return;
      fileTreeBusy.value = path;
      try {
        const result = await api.workspaceFiles(path);
        fileTreeChildren.value = { ...fileTreeChildren.value, [path]: result.files || [] };
      } catch (e) { fileTreeChildren.value = { ...fileTreeChildren.value, [path]: [] }; }
      fileTreeBusy.value = '';
    }

    async function refreshTrace(reset) {
      const session = scrollSession.value;
      if (!session || session === 'initial' || session === 0) {
        traceEvents.value = []; traceCursor.value = 0; traceMore.value = false; traceError.value = ''; return;
      }
      const generation = incrementTraceGeneration();
      const cursor = reset ? 0 : traceCursor.value;
      traceBusy.value = true; traceError.value = '';
      try {
        const r = await api.sessionEvents(cursor, 64);
        if (generation !== getTraceGeneration()) return;
        const events = Array.isArray(r && r.events) ? r.events : [];
        const merged = reset ? events : [...traceEvents.value, ...events];
        traceEvents.value = merged;
        traceCursor.value = (r && typeof r.nextCursor === 'number') ? r.nextCursor : cursor;
        traceMore.value = !!(r && r.more);
      } catch (e) {
        if (generation === getTraceGeneration()) traceError.value = String((e && e.message) || e);
      } finally {
        if (generation === getTraceGeneration()) traceBusy.value = false;
      }
    }

    async function openWorkspace() {
      if (workspaceBusy.value) return;
      if (workspaceOpen.value) { workspaceOpen.value = false; return; }
      const generation = getSessionGeneration();
      workspaceOpen.value = true;
      workspaceNote.value = ''; workspaceRecentBusy.value = true;
      try {
        const result = await api.workspaceRecent();
        if (generation !== getSessionGeneration()) { workspaceOpen.value = false; return; }
        workspaceRecent.value = result.entries || [];
        await doRefreshWorkspace();
      } catch (e) { workspaceNote.value = catalogError(e); }
      finally { workspaceRecentBusy.value = false; }
    }

    async function changeWorkspace(select) {
      if (fileEditor.state.busy || fileEditor.dirty()) { workspaceNote.value = '请先保存或放弃文件编辑中的修改。'; return; }
      if (sendBusy.value || workspaceBusy.value || budgetBusy.value || appearanceBusy.value || turn.value.running || approval.value) return;
      const generation = getSessionGeneration();
      workspaceBusy.value = true; workspaceNote.value = '请选择项目文件夹…';
      try {
        const result = await select();
        if (generation !== getSessionGeneration()) return;
        if (result.cancelled) { workspaceNote.value = '已取消选择，目录未变更。'; return; }
        await doRefreshWorkspace(); await refreshWorkspaceFiles(); await refresh(); await refreshTools(); await refreshCatalog();
        workspaceNote.value = '已保存当前会话的项目目录。';
        workspaceOpen.value = false;
      } catch (e) { workspaceNote.value = catalogError(e); }
      finally { workspaceBusy.value = false; }
    }
    function chooseWorkspace() { return changeWorkspace(() => api.workspaceChoose()); }
    function selectRecentWorkspace(recentId) {
      if (!workspace.value?.sessionId) return;
      return changeWorkspace(() => api.workspaceSelectRecent(recentId, workspace.value.sessionId));
    }

    return { refreshWorkspace: doRefreshWorkspace, refreshWorkspaceFiles, toggleTreeDir, refreshTrace, openWorkspace, chooseWorkspace, selectRecentWorkspace };
  }

  root.SaCodeWorkspace = { createWorkspaceAssembly };
})(globalThis);
