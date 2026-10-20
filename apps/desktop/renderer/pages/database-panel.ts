// F16 独立面板：Vue runtime + h()；无 IPC、驱动依赖或持久化副作用。
import { defineComponent, h, ref, reactive, watch, onBeforeUnmount, type PropType } from 'vue';
import { createDatabasePanel, defaultConnectionSpec, databaseChannelHint, type DatabaseChannels, type DatabaseEngine, type DatabasePhase } from './database-panel-state';

const phaseLabels: Record<DatabasePhase, string> = {
  disconnected: '未连接', connecting: '连接中', connected: '已连接', disconnecting: '断开中', querying: '查询中', error: '错误 / 需核验',
};
function cellText(value: unknown): string {
  if (value === null) return 'NULL';
  if (value === undefined) return '—';
  try { return typeof value === 'object' ? JSON.stringify(value) : String(value); }
  catch { return '[无法显示]'; }
}
export const DatabasePanel = defineComponent({
  name: 'SaCodeDatabasePanel',
  props: {
    active: { type: Boolean, default: false },
    sessionId: { type: String, default: '' },
    projectId: { type: String, default: '' },
    channels: { type: Object as PropType<DatabaseChannels | null>, default: null },
  },
  setup(props) {
    const revision = ref(0), sql = ref(''), mode = ref<'readonly' | 'write'>('readonly');
    const draft = reactive(defaultConnectionSpec());
    const view = createDatabasePanel(() => props.channels, () => ({ sessionId: props.sessionId, projectId: props.projectId }), () => { revision.value++; });
    watch(() => [props.sessionId, props.projectId], () => {
      view.detach(); sql.value = ''; mode.value = 'readonly'; draft.credentialRef = '';
    });
    onBeforeUnmount(() => view.dispose());
    function setEngine(event: Event) {
      draft.engine = (event.target as HTMLSelectElement).value as DatabaseEngine;
      draft.port = draft.engine === 'postgresql' ? 5432 : draft.engine === 'mysql' ? 3306 : 5236;
    }
    function field(label: string, key: 'host' | 'database' | 'user' | 'credentialRef' | 'port') {
      return h('label', { class: 'db-field' }, [
        h('span', {}, label),
        h('input', { type: key === 'port' ? 'number' : 'text', value: draft[key],
          min: key === 'port' ? 1 : undefined, max: key === 'port' ? 65535 : undefined,
          autocomplete: 'off', spellcheck: false, disabled: view.state.busy || !!view.state.connectionId,
          onInput: (event: Event) => {
            const value = (event.target as HTMLInputElement).value;
            if (key === 'port') draft.port = Number(value); else draft[key] = value;
          },
        }),
      ]);
    }
    function connectionForm() {
      const s = view.state;
      return h('form', { class: 'db-connection-form', onSubmit: (event: Event) => { event.preventDefault(); void view.connect(draft); } }, [
        h('h3', {}, '连接管理'),
        h('label', {}, [h('span', {}, '驱动类型'), h('select', {
          value: draft.engine, disabled: s.busy || !!s.connectionId, onChange: setEngine,
        }, [h('option', { value: 'postgresql' }, 'PostgreSQL（pg）'), h('option', { value: 'mysql' }, 'MySQL（mysql2）'), h('option', { value: 'dm' }, '达梦（dmdb，驱动与平台待验）')])]),
        field('主机', 'host'), field('端口', 'port'), field('数据库', 'database'), field('用户名', 'user'), field('独立凭据引用（credentialRef，可留空）', 'credentialRef'),
        h('p', { class: 'note' }, '本面板不接收或保存明文密码。请先在独立凭据存储中配置，再填写引用；引用不是密码。TLS 固定校验证书。'),
        h('button', { class: 'btn btn-primary', type: 'submit', disabled: s.busy || !!s.connectionId || !props.channels || !props.sessionId || !props.projectId }, '连接'),
        h('button', { class: 'btn', type: 'button', disabled: s.busy || !s.connectionId || !props.channels, onClick: () => void view.disconnect() }, '断开'),
        s.target ? h('p', { class: 'note' }, `当前目标：${s.target.engine} · ${s.target.host}:${s.target.port} / ${s.target.database} · ${s.target.user}`) : null,
        h('p', { class: 'note' }, '单连接管理；断开后可编辑目标。连接与凭据引用仅存本组件内存，不写会话正文或浏览器存储。'),
      ]);
    }
    function queryEditor() {
      const s = view.state;
      return h('section', { class: 'db-query-editor', 'aria-label': 'SQL 查询编辑器' }, [
        h('h3', {}, '查询编辑器'),
        h('label', {}, [h('span', {}, '执行模式'), h('select', { value: mode.value, disabled: s.busy, onChange: (event: Event) => { mode.value = (event.target as HTMLSelectElement).value as 'readonly' | 'write'; } }, [
          h('option', { value: 'readonly' }, '只读（默认）'), h('option', { value: 'write' }, '写入 / DDL（需独立审批）'),
        ])]),
        h('textarea', { 'aria-label': 'SQL', rows: 8, value: sql.value, spellcheck: false, disabled: s.busy,
          placeholder: '输入由服务端只读约束校验的 SQL', onInput: (event: Event) => { sql.value = (event.target as HTMLTextAreaElement).value; } }),
        h('p', { class: 'note' }, '只读安全由 core / 驱动及服务端只读约束保证，不靠 SQL 前缀判断；无法确认只读时必须拒绝或走审批。'),
        mode.value === 'write' ? h('p', { class: 'note', role: 'status' }, '写入需进入 execution/review-apply 审阅与独立授权；当前未接审批通道，禁止执行。DDL 可能隐式提交且不可靠回滚，不能承诺撤销。') : null,
        h('button', { class: 'btn btn-primary', type: 'button', disabled: !props.channels || !s.connectionId || s.busy || !sql.value.trim() || mode.value !== 'readonly', onClick: () => void view.execute(sql.value, mode.value) }, '执行只读查询'),
        h('p', { class: 'note' }, '上限 10,000 行 / 4 MiB / 30 秒，按 100 行游标分页。没有稳定排序或唯一键时，分页结果可能漂移。'),
      ]);
    }
    function resultTable() {
      const s = view.state, result = s.result;
      if (!result) return h('p', { class: 'note' }, s.phase === 'querying' ? '查询中，等待真实结果…' : '尚无查询结果。');
      const canNext = s.pageIndex + 1 < s.pages.length || (!!result.cursorId && result.rows.length === s.pageSize && (s.pageIndex + 1) * s.pageSize < 10000);
      return h('section', { class: 'db-results', 'aria-label': '查询结果' }, [
        h('h3', {}, '查询结果'),
        h('p', { role: 'status' }, `第 ${s.pageIndex + 1} 页 · 本页 ${result.rows.length} 行` + (result.elapsedMs != null ? ` · ${result.elapsedMs} ms` : '') + (result.affectedRows != null ? ` · 影响 ${result.affectedRows} 行` : '')),
        result.truncated ? h('p', { class: 'note', role: 'status' }, '结果已截断，当前显示不代表完整结果。') : null,
        h('div', { style: { overflowX: 'auto', maxHeight: '400px', overflowY: 'auto' } }, [
          h('table', { class: 'db-result-table' }, [
            h('thead', {}, [h('tr', {}, result.columns.map((col, index) => h('th', { key: index, scope: 'col' }, [col.name, h('small', {}, ` (${col.type})`)])))]),
            h('tbody', {}, result.rows.map((row, rowIndex) => h('tr', { key: rowIndex }, result.columns.map((col, colIndex) => {
              const value = Array.isArray(row) ? row[colIndex] : row && typeof row === 'object' ? Object.prototype.hasOwnProperty.call(row, col.name) ? (row as Record<string, unknown>)[col.name] : undefined : undefined;
              const text = cellText(value), cut = text.length > 4096;
              return h('td', { key: colIndex, style: { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' } }, cut ? text.slice(0, 4096) + '…（单元格显示已截断）' : text);
            })))),
          ]),
        ]),
        !result.rows.length ? h('p', { class: 'note' }, '查询成功，结果为空。') : null,
        h('nav', { 'aria-label': '结果分页' }, [
          h('button', { class: 'btn', type: 'button', disabled: s.busy || s.pageIndex === 0, onClick: view.previousPage }, '上一页'),
          h('button', { class: 'btn', type: 'button', disabled: s.busy || !canNext, onClick: () => void view.nextPage() }, '下一页'),
        ]),
      ]);
    }
    return () => {
      void revision.value;
      return h('section', { class: 'database-panel', 'aria-label': '数据库面板', 'aria-busy': view.state.busy }, [
        h('header', {}, [h('h2', {}, '数据库'), h('span', { role: 'status' }, phaseLabels[view.state.phase])]),
        !props.channels ? h('p', { class: 'note', role: 'status' }, databaseChannelHint) : null,
        !props.sessionId || !props.projectId ? h('p', { class: 'note' }, '请先选择项目和会话；连接及结果绑定当前任务。') : null,
        connectionForm(), queryEditor(),
        view.state.error ? h('p', { class: 'editor-error', role: 'alert' }, view.state.error) : null,
        resultTable(),
      ]);
    };
  },
});
