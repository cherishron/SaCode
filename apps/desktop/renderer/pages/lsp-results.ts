// LSP 语义查询结果面板：7 类 verb 的查询入口 + 结果渲染。
// 复用 preload.cjs 已有 lspDefine/lspLookup/lspReferences/lspImplementation/
// lspCallHierarchy/lspDiagnostics/lspRename 通道，不新增 IPC。
// rename 只展示变更预览，不落盘——差异审查走 F08 execution/review-apply 通路。
import { defineComponent, h, ref, computed } from 'vue';

// —— LSP 响应类型（与 core/src/lsp_contract.cj 的 JSON 序列化对齐）——
type LspPosition = { line: number; character: number };
type LspRange = { start: LspPosition; end: LspPosition };
type LspLocation = { path: string; range: LspRange };
type LspCallItem = { name: string; kind: string; location: LspLocation };
type LspDiagnostic = {
  path: string; range: LspRange; severity: string;
  source: string; code: string; message: string;
};
type LspTextEdit = { range: LspRange; newText: string };
type LspFileEdits = { path: string; edits: LspTextEdit[] };
type LspResponse = {
  verb: string; ok: boolean; reason: string;
  nonSemantic: boolean; label: string; previewOnly: boolean;
  hover: string; diagnosticSnapshot: string;
  locations: LspLocation[];
  callItems: LspCallItem[];
  diagnostics: LspDiagnostic[];
  editFiles: LspFileEdits[];
  clues: string[];
};

const VERBS: { id: string; label: string; needsPosition: boolean; needsDirection: boolean; needsNewName: boolean; needsIncludeDecl: boolean }[] = [
  { id: 'define', label: '跳转定义', needsPosition: true, needsDirection: false, needsNewName: false, needsIncludeDecl: false },
  { id: 'lookup', label: '类型信息', needsPosition: true, needsDirection: false, needsNewName: false, needsIncludeDecl: false },
  { id: 'references', label: '查找引用', needsPosition: true, needsDirection: false, needsNewName: false, needsIncludeDecl: true },
  { id: 'implementation', label: '实现位置', needsPosition: true, needsDirection: false, needsNewName: false, needsIncludeDecl: false },
  { id: 'call-hierarchy', label: '调用层次', needsPosition: true, needsDirection: true, needsNewName: false, needsIncludeDecl: false },
  { id: 'diagnostics', label: '诊断', needsPosition: false, needsDirection: false, needsNewName: false, needsIncludeDecl: false },
  { id: 'rename', label: '重命名预览', needsPosition: true, needsDirection: false, needsNewName: true, needsIncludeDecl: false },
];

const SEVERITY_CLASS: Record<string, string> = {
  error: 'lsp-sev-error', warning: 'lsp-sev-warn',
  info: 'lsp-sev-info', hint: 'lsp-sev-hint',
};
const SEVERITY_LABEL: Record<string, string> = {
  error: '错误', warning: '警告', info: '提示', hint: '建议',
};

function fmtPos(p: LspPosition): string {
  return `${p.line + 1}:${p.character + 1}`;
}
function fmtRange(r: LspRange): string {
  return `${fmtPos(r.start)}–${fmtPos(r.end)}`;
}
function shortPath(path: string, directory: string): string {
  if (directory && path.startsWith(directory)) {
    const rel = path.slice(directory.length).replace(/^[\\/]/, '');
    return rel || path;
  }
  // 只保留最后两级目录 + 文件名
  const parts = path.replace(/\\/g, '/').split('/');
  if (parts.length <= 3) return path;
  return '…/' + parts.slice(-2).join('/');
}

export const LspResults = defineComponent({
  name: 'SaCodeLspResults',
  props: {
    api: { type: Object as () => Record<string, (...args: unknown[]) => Promise<unknown>>, required: true },
    active: { type: Boolean, default: false },
    directory: { type: String, default: '' },
    configured: { type: Boolean, default: false },
    onOpen: { type: Function as unknown as () => (path: string) => void, default: null },
  },
  setup(props) {
    const verb = ref('define');
    const filePath = ref('');
    const line = ref(0);
    const character = ref(0);
    const direction = ref('incoming');
    const newName = ref('');
    const includeDeclaration = ref(true);
    const loading = ref(false);
    const error = ref('');
    const result = ref<LspResponse | null>(null);
    const expandedCalls = ref<Set<string>>(new Set());

    const currentVerb = computed(() => VERBS.find(v => v.id === verb.value)!);

    async function query() {
      if (!filePath.value.trim()) {
        error.value = '请输入文件路径';
        result.value = null;
        return;
      }
      if (currentVerb.value.needsNewName && !newName.value.trim()) {
        error.value = '请输入新名称';
        result.value = null;
        return;
      }
      loading.value = true;
      error.value = '';
      result.value = null;
      try {
        const api = props.api as Record<string, (...args: unknown[]) => Promise<unknown>>;
        const p = filePath.value;
        const ln = line.value;
        const ch = character.value;
        let res: unknown;
        switch (verb.value) {
          case 'define': res = await api.lspDefine(p, ln, ch); break;
          case 'lookup': res = await api.lspLookup(p, ln, ch); break;
          case 'references': res = await api.lspReferences(p, ln, ch, includeDeclaration.value); break;
          case 'implementation': res = await api.lspImplementation(p, ln, ch); break;
          case 'call-hierarchy': res = await api.lspCallHierarchy(p, ln, ch, direction.value); break;
          case 'diagnostics': res = await api.lspDiagnostics(p); break;
          case 'rename': res = await api.lspRename(p, ln, ch, newName.value); break;
          default: throw new Error('未知查询类型: ' + verb.value);
        }
        result.value = res as LspResponse;
      } catch (e) {
        error.value = String((e && (e as Error).message) || e);
      } finally {
        loading.value = false;
      }
    }

    function openLocation(loc: LspLocation) {
      if (props.onOpen) props.onOpen(loc.path);
    }

    function toggleCall(key: string) {
      const s = new Set(expandedCalls.value);
      if (s.has(key)) s.delete(key); else s.add(key);
      expandedCalls.value = s;
    }

    // —— 结果渲染子函数 ——
    function renderLocations(locs: LspLocation[]): unknown[] {
      if (!locs.length) return [h('p', { class: 'lsp-empty' }, '无位置结果')];
      return locs.map((loc, i) =>
        h('button', {
          type: 'button', class: 'lsp-location-item', key: i,
          onClick: () => openLocation(loc),
          title: loc.path,
        }, [
          h('span', { class: 'lsp-loc-path' }, shortPath(loc.path, props.directory)),
          h('span', { class: 'lsp-loc-range' }, fmtRange(loc.range)),
        ]),
      );
    }

    function renderHover(md: string): unknown[] {
      if (!md) return [h('p', { class: 'lsp-empty' }, '无类型信息')];
      // 简单 markdown 代码块与行内代码渲染（不引外部 markdown-it，CSP 禁 eval）
      const lines = md.split('\n');
      const out: unknown[] = [];
      let inCode = false;
      let codeBuf: string[] = [];
      for (const ln of lines) {
        if (ln.trim().startsWith('```')) {
          if (inCode) {
            out.push(h('pre', { class: 'lsp-hover-code' }, codeBuf.join('\n')));
            codeBuf = [];
            inCode = false;
          } else { inCode = true; }
          continue;
        }
        if (inCode) { codeBuf.push(ln); continue; }
        if (ln.trim()) out.push(h('p', { class: 'lsp-hover-line' }, ln));
      }
      if (codeBuf.length) out.push(h('pre', { class: 'lsp-hover-code' }, codeBuf.join('\n')));
      return out;
    }

    function renderReferences(locs: LspLocation[]): unknown[] {
      if (!locs.length) return [h('p', { class: 'lsp-empty' }, '无引用结果')];
      // 按文件分组
      const groups = new Map<string, LspLocation[]>();
      for (const loc of locs) {
        const arr = groups.get(loc.path) || [];
        arr.push(loc);
        groups.set(loc.path, arr);
      }
      return [...groups.entries()].map(([path, items], gi) =>
        h('details', { class: 'lsp-ref-group', key: gi, open: gi < 3 }, [
          h('summary', { class: 'lsp-ref-summary' }, [
            h('span', { class: 'lsp-loc-path' }, shortPath(path, props.directory)),
            h('span', { class: 'lsp-ref-count' }, `${items.length} 处`),
          ]),
          h('div', { class: 'lsp-ref-items' }, items.map((loc, i) =>
            h('button', {
              type: 'button', class: 'lsp-location-item', key: i,
              onClick: () => openLocation(loc),
            }, [
              h('span', { class: 'lsp-loc-range' }, fmtRange(loc.range)),
            ]),
          )),
        ]),
      );
    }

    function renderCallHierarchy(items: LspCallItem[]): unknown[] {
      if (!items.length) return [h('p', { class: 'lsp-empty' }, '无调用层次结果')];
      return items.map((item, i) => {
        const key = `${item.name}:${i}`;
        const expanded = expandedCalls.value.has(key);
        return h('div', { class: 'lsp-call-item', key }, [
          h('button', {
            type: 'button', class: 'lsp-call-head',
            onClick: () => toggleCall(key),
          }, [
            h('span', { class: 'lsp-call-toggle' }, expanded ? '▾' : '▸'),
            h('span', { class: 'lsp-call-kind' }, item.kind || '—'),
            h('span', { class: 'lsp-call-name' }, item.name),
            h('span', { class: 'lsp-loc-range' }, item.location ? fmtRange(item.location.range) : ''),
          ]),
          expanded && item.location
            ? h('div', { class: 'lsp-call-detail' }, [
                h('button', {
                  type: 'button', class: 'lsp-location-item',
                  onClick: () => openLocation(item.location),
                }, [
                  h('span', { class: 'lsp-loc-path' }, shortPath(item.location.path, props.directory)),
                  h('span', { class: 'lsp-loc-range' }, fmtRange(item.location.range)),
                ]),
              ])
            : null,
        ]);
      });
    }

    function renderDiagnostics(diags: LspDiagnostic[]): unknown[] {
      if (!diags.length) return [h('p', { class: 'lsp-empty' }, '无诊断')];
      const groups = new Map<string, LspDiagnostic[]>();
      for (const d of diags) {
        const arr = groups.get(d.path) || [];
        arr.push(d);
        groups.set(d.path, arr);
      }
      return [...groups.entries()].map(([path, items], gi) =>
        h('details', { class: 'lsp-diag-group', key: gi, open: gi < 5 }, [
          h('summary', { class: 'lsp-diag-summary' }, [
            h('span', { class: 'lsp-loc-path' }, shortPath(path, props.directory)),
            h('span', { class: 'lsp-ref-count' }, `${items.length} 条`),
          ]),
          h('div', { class: 'lsp-diag-items' }, items.map((d, i) =>
            h('div', { class: ['lsp-diag-item', SEVERITY_CLASS[d.severity] || 'lsp-sev-info'], key: i }, [
              h('span', { class: 'lsp-diag-sev' }, SEVERITY_LABEL[d.severity] || d.severity),
              h('span', { class: 'lsp-diag-range' }, fmtRange(d.range)),
              d.source ? h('span', { class: 'lsp-diag-source' }, d.source + (d.code ? ':' + d.code : '')) : null,
              h('span', { class: 'lsp-diag-msg' }, d.message),
            ]),
          )),
        ]),
      );
    }

    function renderRenamePreview(files: LspFileEdits[]): unknown[] {
      if (!files.length) return [h('p', { class: 'lsp-empty' }, '无变更')];
      const totalEdits = files.reduce((n, f) => n + f.edits.length, 0);
      return [
        h('div', { class: 'lsp-rename-banner', role: 'status' }, [
          h('strong', {}, '变更预览（不直接落盘）'),
          h('span', { class: 'lsp-rename-stats' }, `${files.length} 个文件，${totalEdits} 处修改 → "${newName.value}"`),
        ]),
        ...files.map((fe, fi) =>
          h('details', { class: 'lsp-rename-group', key: fi, open: fi < 5 }, [
            h('summary', { class: 'lsp-rename-summary' }, [
              h('span', { class: 'lsp-loc-path' }, shortPath(fe.path, props.directory)),
              h('span', { class: 'lsp-ref-count' }, `${fe.edits.length} 处`),
            ]),
            h('div', { class: 'lsp-rename-items' }, fe.edits.map((ed, ei) =>
              h('div', { class: 'lsp-rename-item', key: ei }, [
                h('span', { class: 'lsp-diag-range' }, fmtRange(ed.range)),
                h('code', { class: 'lsp-rename-new' }, ed.newText),
              ]),
            )),
          ]),
        ),
        h('p', { class: 'lsp-rename-note' }, '差异审查走 F08 审查通路，不在此面板执行落盘。'),
      ];
    }

    function renderResult(): unknown[] {
      const r = result.value;
      if (!r) return [];
      if (!r.ok) {
        return [h('div', { class: 'lsp-error', role: 'alert' }, [
          h('strong', {}, '查询失败'),
          h('p', {}, r.reason || '未知原因'),
        ])];
      }
      switch (r.verb) {
        case 'define':
        case 'implementation':
          return renderLocations(r.locations || []);
        case 'lookup':
          return renderHover(r.hover || '');
        case 'references':
          return renderReferences(r.locations || []);
        case 'call-hierarchy':
          return renderCallHierarchy(r.callItems || []);
        case 'diagnostics':
          return renderDiagnostics(r.diagnostics || []);
        case 'rename':
          return renderRenamePreview(r.editFiles || []);
        default:
          return [h('p', { class: 'lsp-empty' }, '未知结果类型: ' + r.verb)];
      }
    }

    return () => {
      if (!props.active) return null;
      const cv = currentVerb.value;
      return h('section', { class: 'lsp-results-page', 'aria-label': 'LSP 语义查询' }, [
        // —— 查询表单 ——
        h('div', { class: 'lsp-query-form' }, [
          h('div', { class: 'lsp-verb-row' }, VERBS.map(v =>
            h('button', {
              type: 'button',
              class: ['lsp-verb-btn', verb.value === v.id ? 'active' : ''],
              key: v.id,
              onClick: () => { verb.value = v.id; result.value = null; error.value = ''; },
            }, v.label),
          )),
          h('div', { class: 'lsp-input-row' }, [
            h('input', {
              type: 'text', class: 'lsp-input-path',
              placeholder: '文件路径（相对项目根或绝对）',
              value: filePath.value,
              'aria-label': '文件路径',
              onInput: (e: Event) => { filePath.value = (e.target as HTMLInputElement).value; },
            }),
            cv.needsPosition ? h('input', {
              type: 'number', class: 'lsp-input-num',
              placeholder: '行', value: line.value || '',
              min: 0, 'aria-label': '行号（0 起始）',
              onInput: (e: Event) => { line.value = parseInt((e.target as HTMLInputElement).value, 10) || 0; },
            }) : null,
            cv.needsPosition ? h('input', {
              type: 'number', class: 'lsp-input-num',
              placeholder: '列', value: character.value || '',
              min: 0, 'aria-label': '列号（0 起始）',
              onInput: (e: Event) => { character.value = parseInt((e.target as HTMLInputElement).value, 10) || 0; },
            }) : null,
            cv.needsDirection ? h('select', {
              class: 'lsp-input-select',
              value: direction.value,
              'aria-label': '调用方向',
              onChange: (e: Event) => { direction.value = (e.target as HTMLSelectElement).value; },
            }, [
              h('option', { value: 'incoming' }, '谁调用了此处'),
              h('option', { value: 'outgoing' }, '此处调用了谁'),
            ]) : null,
            cv.needsIncludeDecl ? h('label', { class: 'lsp-checkbox' }, [
              h('input', {
                type: 'checkbox',
                checked: includeDeclaration.value,
                onChange: (e: Event) => { includeDeclaration.value = (e.target as HTMLInputElement).checked; },
              }),
              h('span', {}, '含声明'),
            ]) : null,
            cv.needsNewName ? h('input', {
              type: 'text', class: 'lsp-input-newname',
              placeholder: '新名称', value: newName.value,
              'aria-label': '新名称',
              onInput: (e: Event) => { newName.value = (e.target as HTMLInputElement).value; },
            }) : null,
            h('button', {
              type: 'button', class: 'btn btn-primary lsp-query-btn',
              disabled: loading.value || !props.configured,
              onClick: query,
            }, loading.value ? '查询中…' : '查询'),
          ]),
          !props.configured ? h('p', { class: 'lsp-hint' }, '请先选择项目文件夹以启用语义查询。') : null,
        ]),
        // —— 结果区域 ——
        error.value ? h('div', { class: 'lsp-error', role: 'alert' }, [
          h('strong', {}, '错误'), h('p', {}, error.value),
        ]) : null,
        result.value ? h('div', { class: 'lsp-result-area' }, [
          h('div', { class: 'lsp-result-header' }, [
            h('span', { class: 'lsp-result-label' }, result.value.label || '结果'),
            result.value.previewOnly ? h('span', { class: 'lsp-badge-preview' }, '仅预览') : null,
            result.value.nonSemantic ? h('span', { class: 'lsp-badge-nonsem' }, '非语义') : null,
          ]),
          h('div', { class: 'lsp-result-body' }, renderResult()),
        ]) : null,
      ]);
    };
  },
});
