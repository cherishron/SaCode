import { el } from '../dom.ts';
import type { DesktopApp } from './service.ts';
import type { KnowledgeHit, KnowledgeNote } from '@cherishron/sacode-client-core';
import { buildResizableWorkspace } from './resizable-workspace.ts';

export interface SaNativeState {
  userEntries: KnowledgeNote[];
  projectEntries: KnowledgeNote[];
  loading: boolean;
  error: string | null;
  activeScope: 'user' | 'project';
  selectedEntry: string | null;
  selectedNote: KnowledgeNote | null;
  editing: boolean;
  searchText: string;
  hits: KnowledgeHit[] | null;
  searchVersion: number;
  draft: { title: string; content: string } | null;
  splitRatio: number;
}
export function createSaNativeState(): SaNativeState {
  return { userEntries: [], projectEntries: [], loading: false, error: null,
    activeScope: 'project', selectedEntry: null, selectedNote: null, editing: false,
    searchText: '', hits: null, searchVersion: 0, draft: null, splitRatio: 0.36 };
}
export async function refreshSaNative(app: DesktopApp, state: SaNativeState, rerender: () => void) {
  const scope = state.activeScope;
  state.loading = true; state.error = null; rerender();
  try {
    const entries = await app.refreshKnowledge(scope);
    if (scope === 'project') state.projectEntries = entries;
    else state.userEntries = entries;
    if (state.activeScope === scope) {
      if (state.searchText.trim()) await searchNow(app, state, rerender);
      else state.hits = null;
    }
  } catch (error) { if (state.activeScope === scope) state.error = String(error); }
  finally { if (state.activeScope === scope) { state.loading = false; rerender(); } }
}
async function searchNow(app: DesktopApp, state: SaNativeState, rerender: () => void) {
  const version = ++state.searchVersion;
  const scope = state.activeScope;
  const query = state.searchText.trim();
  if (!query) { state.hits = null; rerender(); return; }
  try {
    const hits = await app.searchKnowledge(query, scope);
    if (state.searchVersion === version && state.activeScope === scope) { state.hits = hits; state.error = null; rerender(); }
  } catch (error) { if (state.searchVersion === version) { state.error = String(error); rerender(); } }
}
function withError(state: SaNativeState, rerender: () => void, operation: () => Promise<void>) {
  void operation().catch(error => { state.error = String(error); rerender(); });
}
export function buildSaNativeWorkspace(app: DesktopApp, state: SaNativeState, rerender: () => void): Node {
  const entries = state.activeScope === 'project' ? state.projectEntries : state.userEntries;
  const visible = state.hits
    ? state.hits.map(hit => ({ ...entries.find(note => note.id === hit.id), ...hit }))
    : entries;
  const list = el('div', { className: 'sanative-list-pane' }, [
    el('div', { className: 'sanative-scope-tabs' }, (['project', 'user'] as const).map(scope =>
      el('button', { className: `sanative-scope-tab ${state.activeScope === scope ? 'active' : ''}`,
        onclick: () => { state.activeScope = scope; state.selectedEntry = null; state.selectedNote = null;
          state.editing = false; state.draft = null; state.hits = null; state.searchVersion++; void refreshSaNative(app, state, rerender); },
      }, [scope === 'project' ? '项目' : '用户']))),
    el('div', { className: 'sanative-search' }, [el('input', {
      className: 'sanative-search-input', placeholder: '搜索笔记…', value: state.searchText,
      oninput: (event: Event) => { state.searchText = (event.target as HTMLInputElement).value; const version = ++state.searchVersion;
        if (!state.searchText.trim()) { state.hits = null; rerender(); }
        else setTimeout(() => { if (state.searchVersion === version) void searchNow(app, state, rerender); }, 300); },
    })]),
    state.error ? el('div', { className: 'sanative-error' }, [state.error]) : '',
    el('div', { className: 'sanative-content' }, [
      state.loading ? el('div', { className: 'sanative-empty' }, ['正在加载…']) :
        el('div', { className: 'sanative-entry-list' }, visible.length ? visible.map(note =>
          el('button', { className: `sanative-entry ${state.selectedEntry === note.id ? 'active' : ''}`,
            onclick: () => withError(state, rerender, async () => {
              state.selectedNote = await app.getKnowledgeNote(note.id, state.activeScope);
              state.selectedEntry = note.id; state.editing = false; state.draft = null; rerender();
            }) }, [
              el('span', { className: 'sanative-entry-name' }, [`${note.readonly ? '🔒 ' : ''}${note.title}`]),
              ...('snippet' in note && note.snippet ? [el('span', { className: 'sanative-entry-snippet' }, [String(note.snippet)])] : []),
            ])) : [el('div', { className: 'sanative-empty' }, [state.searchText ? '没有匹配结果' : '暂无笔记'])]),
    ]),
  ]);
  const detail = state.editing ? editor(app, state, rerender)
    : state.selectedNote ? reader(app, state, rerender)
      : el('div', { className: 'workspace-detail-empty' }, [
          el('strong', {}, ['选择左侧笔记']),
          el('span', {}, ['这里会显示笔记正文，也可以新建笔记。']),
        ]);
  return el('section', { className: 'sanative' }, [
    el('div', { className: 'sanative-header' }, [
      el('span', { className: 'sanative-title' }, ['笔记']),
      el('div', { className: 'sanative-header-right' }, [
        el('button', { className: 'header-btn', title: '刷新', onclick: () => void refreshSaNative(app, state, rerender) }, ['刷新']),
        el('button', { className: 'header-btn', title: '新建笔记', onclick: () => {
          state.selectedEntry = null; state.selectedNote = null; state.draft = { title: '', content: '' }; state.editing = true; rerender();
        } }, ['+ 新建笔记']),
      ]),
    ]),
    buildResizableWorkspace(state.splitRatio, ratio => { state.splitRatio = ratio; }, list, detail),
    el('div', { className: 'sanative-footer' }, [state.activeScope === 'project'
      ? `项目 .sacode/knowledge/ · docs/ 只读 · ${app.workspace || '未指定项目'}` : '用户 ~/.sacode/knowledge/']),
  ]);
}
function reader(app: DesktopApp, state: SaNativeState, rerender: () => void): Node {
  const note = state.selectedNote!;
  return el('div', { className: 'sanative-reader' }, [
    el('h3', {}, [note.title]),
    el('pre', { style: 'white-space:pre-wrap;line-height:1.65' }, [note.content || '']),
    note.readonly ? el('span', { className: 'muted' }, ['只读文档']) :
      el('div', {}, [
        el('button', { className: 'btn', onclick: () => { state.draft = { title: note.title, content: note.content || '' }; state.editing = true; rerender(); } }, ['编辑']),
        el('button', { className: 'btn ghost', onclick: () => {
          if (!window.confirm(`删除笔记“${note.title}”？`)) return;
          withError(state, rerender, async () => { await app.deleteKnowledgeNote(note.id, state.activeScope);
            state.selectedNote = null; state.selectedEntry = null; await refreshSaNative(app, state, rerender); });
        } }, ['删除']),
      ]),
  ]);
}
function editor(app: DesktopApp, state: SaNativeState, rerender: () => void): Node {
  const note = state.selectedNote;
  if (note?.readonly) return el('span', {}, ['只读文档不可编辑']);
  const draft = state.draft ?? { title: note?.title || '', content: note?.content || '' };
  state.draft = draft;
  const title = el('input', { className: 'sanative-search-input', placeholder: '标题', value: draft.title,
    oninput: (event: Event) => { draft.title = (event.target as HTMLInputElement).value; } }) as HTMLInputElement;
  const body = el('textarea', { className: 'automation-form-textarea', placeholder: 'Markdown 正文',
    style: 'min-height:220px;font-family:monospace', oninput: (event: Event) => { draft.content = (event.target as HTMLTextAreaElement).value; } }, [draft.content]) as HTMLTextAreaElement;
  return el('div', { className: 'sanative-reader' }, [title, body, el('div', {}, [
    el('button', { className: 'btn', onclick: () => withError(state, rerender, async () => {
      if (!title.value.trim()) throw new Error('请输入标题');
      const saved = await app.saveKnowledgeNote({ id: note?.id, scope: state.activeScope, title: title.value,
        content: body.value, updated_at: note?.updated_at });
      state.selectedEntry = saved.id; state.selectedNote = saved; state.editing = false; state.draft = null;
      await refreshSaNative(app, state, rerender);
    }) }, ['保存']),
    el('button', { className: 'btn ghost', onclick: () => { state.editing = false; state.draft = null; rerender(); } }, ['取消']),
  ])]);
}
