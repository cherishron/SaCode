// 团队管理：成员/任务/消息的 CRUD、快照回放、轮询刷新。
// 经典脚本（CSP script-src 'self'）。

(function (root) {
  'use strict';

  function createTeamAssembly(deps) {
    const {
      api, ref,
      sideOpen, sideTab, pluginManagerOpen, scrollSession,
      teamSessionId, teamSnapshot, teamBusy, teamError,
      teamTimerRef, teamGenerationRef, teamNavigationIdRef, teamDisposedRef,
      selectSession,
    } = deps;

    const teamActive = () => !teamDisposedRef.value && sideOpen.value && sideTab.value === 'agents' && !pluginManagerOpen.value;

    function stopTeamRefresh() {
      if (teamTimerRef.value !== null) clearInterval(teamTimerRef.value);
      teamTimerRef.value = null; teamGenerationRef.value += 1; teamBusy.value = false;
    }

    async function readTeamSnapshot(id, generation) {
      const snapshot = await api.teamDescribe(id);
      if (!snapshot || !['members', 'tasks', 'messages'].every(key => Array.isArray(snapshot[key]))) throw Error('团队快照格式异常：需要 members/tasks/messages 数组。');
      if (generation === teamGenerationRef.value && teamActive() && id === teamSessionId.value) teamSnapshot.value = snapshot;
    }

    async function refreshTeam() {
      if (!teamActive() || teamBusy.value || !teamSessionId.value) return;
      const id = teamSessionId.value, generation = teamGenerationRef.value;
      teamBusy.value = true;
      try { await readTeamSnapshot(id, generation); if (generation === teamGenerationRef.value) teamError.value = ''; }
      catch (e) { if (generation === teamGenerationRef.value) teamError.value = String(e.message || e); }
      finally { if (generation === teamGenerationRef.value) teamBusy.value = false; }
    }

    async function writeTeam(method, args) {
      if (!teamActive() || teamBusy.value || !teamSessionId.value) return;
      const id = teamSessionId.value, generation = teamGenerationRef.value;
      teamBusy.value = true; teamError.value = '';
      try {
        await api[method](id, ...args);
        if (generation === teamGenerationRef.value && teamActive()) await readTeamSnapshot(id, generation);
      } catch (e) { if (generation === teamGenerationRef.value) teamError.value = String(e.message || e); }
      finally { if (generation === teamGenerationRef.value) teamBusy.value = false; }
    }

    const addTeamMember = ({name, role}) => writeTeam('teamMemberCreate', [name, role]);
    const sendTeamMessage = ({target, text}) => writeTeam('teamMessageSend', [target, text]);
    const createTeamTask = ({title, dependencies}) => writeTeam('teamTaskCreate', [title, dependencies]);
    const assignTeamTask = ({taskId, memberId}) => writeTeam('teamTaskAssign', [taskId, memberId]);
    const stopTeamMember = memberId => writeTeam('teamMemberStop', [memberId]);

    async function selectTeamSession(id) {
      teamNavigationIdRef.value = id;
      await selectSession(id);
      if (deps.getSelectedSession() !== id) { teamNavigationIdRef.value = ''; teamError.value = '成员会话未切换，请检查当前会话操作或会话列表错误。'; }
    }

    return {
      stopTeamRefresh, refreshTeam, writeTeam,
      addTeamMember, sendTeamMessage, createTeamTask, assignTeamTask, stopTeamMember,
      selectTeamSession,
    };
  }

  root.SaCodeTeamState = { createTeamAssembly };
})(globalThis);
