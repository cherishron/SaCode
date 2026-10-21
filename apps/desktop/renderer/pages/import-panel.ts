// F19 数据导入面板。
// 六步：来源选择 → 本地预览 → 字段映射 → 确认条目 → 进度 → 报告。
// 只使用 Vue runtime + h()，运行时无模板编译器、无模块加载器，符合 CSP script-src 'self'。
//
// 约束：不修改 preload.cjs。通道由 props.channels 传入；未传时从 window.sacode 解析
// importSources/importPickFile/... 若缺通道则显示 preload 提示、禁用文件选择，
// 不伪造计划、不假装已读取文件。真正的预览、去重与落库由 Host 负责。
import { defineComponent, h, ref, watch, onMounted, onBeforeUnmount, type PropType } from 'vue';
import {
  ACTION_LABEL,
  DECISION_LABEL,
  JOB_STATUS_LABEL,
  PHASE_LABEL,
  STEP_LABEL,
  STEP_ORDER,
  allowedDecisions,
  channelsMissingText,
  createImportPanel,
  decisionFor,
  isItemSelected,
  isTerminalStatus,
  kindLabel,
  resolveImportChannels,
  selectionSummary,
  summarizeReport,
} from './import-panel-state';
import type {
  ImportAction,
  ImportChannels,
  ImportDecision,
  ImportJob,
  ImportMapping,
  ImportPanelState,
  ImportPlanItem,
  ImportReport,
  ImportReportTarget,
  ImportScope,
  ImportSource,
  ImportStep,
  LocalPreviewIssue,
} from './import-panel-state';

const STEP_HINT: Record<ImportStep, string> = {
  source: '来源卡片与文件选择器',
  preview: '本地解析摘要；随后由 Host 重新校验',
  mapping: '标题、作用域、冲突与更新策略',
  decision: '逐条或批量确认写入范围',
  progress: '泵模型推进；取消保留已提交项',
  report: '逐项状态、原因与目标',
};

function phaseBadgeClass(phase: ImportPanelState['phase']): string {
  if (phase === 'completed') return 'badge-ok';
  if (phase === 'partial' || phase === 'applying' || phase === 'previewing') return 'badge-warn';
  if (phase === 'failed') return 'badge-danger';
  return '';
}

function actionBadgeClass(action: ImportAction): string {
  if (action === 'new') return 'badge-ok';
  if (action === 'conflict') return 'badge-warn';
  if (action === 'invalid') return 'badge-danger';
  return '';
}

function limitText(limits: Record<string, number>): string {
  const parts: string[] = [];
  if (limits.bytes) parts.push(`≤ ${(limits.bytes / 1048576).toFixed(0)} MiB`);
  if (limits.items) parts.push(`≤ ${limits.items} 条`);
  if (limits.messages) parts.push(`≤ ${limits.messages} 条消息`);
  if (limits.nodes) parts.push(`≤ ${limits.nodes} 节点`);
  return parts.length ? `限额：${parts.join(' · ')}` : '';
}

export const Page = defineComponent({
  name: 'SaCodeImport',
  props: {
    // 默认解析 preload.cjs 八通道；也可注入同签名的测试通道。
    channels: { type: Object as PropType<ImportChannels | null>, default: null },
    sessionId: { type: String, default: '' },
    workspaceDirectory: { type: String, default: '' },
    active: { type: Boolean, default: true },
  },
  emits: ['open-target'],
  setup(props, { emit }) {
    const revision = ref(0);
    const resolved = props.channels
      ? { channels: props.channels, missing: [] as string[] }
      : resolveImportChannels();
    const view = createImportPanel(
      resolved.channels,
      () => props.sessionId || '',
      () => { revision.value += 1; },
      {
        missingChannels: resolved.missing,
        workspaceAvailable: () => !!props.workspaceDirectory,
      },
    );

    const pageVisible = () => props.active !== false
      && !(typeof document !== 'undefined' && document.hidden);
    let visibilityHandler: (() => void) | null = null;
    let lastSession = props.sessionId;

    watch(
      () => props.sessionId,
      (value) => {
        if (value === lastSession) return;
        lastSession = value;
        view.reset();
        void view.loadSources();
      },
    );

    watch(
      () => props.workspaceDirectory,
      (value) => {
        if (!value && view.state.target.scope === 'project') view.setTarget({ scope: 'user' });
      },
    );

    watch(
      () => props.active,
      () => view.setActive(pageVisible()),
    );

    onMounted(() => {
      void view.loadSources();
      view.setActive(pageVisible());
      if (typeof document !== 'undefined' && document.addEventListener) {
        visibilityHandler = () => view.setActive(pageVisible());
        document.addEventListener('visibilitychange', visibilityHandler);
      }
    });

    onBeforeUnmount(() => {
      if (typeof document !== 'undefined' && document.removeEventListener && visibilityHandler) {
        document.removeEventListener('visibilitychange', visibilityHandler);
      }
      visibilityHandler = null;
      view.dispose();
    });

    // —— 通用渲染件 ——
    function badge(cls: string, text: string) {
      return h('span', { class: ['badge', cls].filter(Boolean) }, text);
    }

    function action(
      label: string,
      onClick: () => void,
      opts: { primary?: boolean; danger?: boolean; disabled?: boolean; title?: string } = {},
    ) {
      const classes = ['btn'];
      if (opts.primary) classes.push('btn-primary');
      if (opts.danger) classes.push('btn-danger');
      return h('button', {
        class: classes,
        type: 'button',
        disabled: !!opts.disabled,
        title: opts.title || '',
        onClick,
      }, label);
    }

    function actions(children: unknown[]) {
      return h('div', { class: 'import-actions' }, children);
    }

    function field(label: string, control: unknown, hint = '') {
      return h('label', { class: 'import-field' }, [
        h('span', { class: 'field-label' }, label),
        control,
        hint ? h('span', { class: 'note' }, hint) : null,
      ]);
    }

    function select(
      value: string,
      options: { value: string; label: string; disabled?: boolean }[],
      onChange: (value: string) => void,
      disabled = false,
    ) {
      return h('select', {
        class: 'import-select',
        value,
        disabled,
        onChange: (event: Event) => onChange((event.target as HTMLSelectElement).value),
      }, options.map((option) => h('option', {
        key: option.value,
        value: option.value,
        disabled: !!option.disabled,
        selected: option.value === value,
      }, option.label)));
    }

    function textInput(
      value: string,
      onInput: (value: string) => void,
      placeholder: string,
      disabled = false,
      maxLength = 200,
    ) {
      return h('input', {
        class: 'import-input',
        type: 'text',
        value,
        placeholder,
        disabled,
        maxlength: maxLength,
        onInput: (event: Event) => onInput((event.target as HTMLInputElement).value),
      });
    }

    function checkbox(checked: boolean, disabled: boolean, label: string, onChange: (checked: boolean) => void) {
      return h('label', { class: 'import-check' }, [
        h('input', {
          type: 'checkbox',
          checked,
          disabled,
          'aria-label': label,
          onChange: (event: Event) => onChange((event.target as HTMLInputElement).checked),
        }),
        h('span', { class: 'note' }, label),
      ]);
    }

    // —— 顶部与横幅 ——
    function renderHeader(s: ImportPanelState) {
      const source = s.sources.find((entry) => entry.id === s.sourceId);
      return h('header', { class: 'import-panel-heading' }, [
        h('div', {}, [
          h('h2', {}, '数据导入'),
          h('p', { class: 'note' }, '预览不写目标；取消不回滚；已提交条目保留。第三方格式由桌面主进程解析，Host 重新计算指纹并做权威去重与落库。'),
        ]),
        h('div', { class: 'import-heading-badges' }, [
          badge(phaseBadgeClass(s.phase), `阶段：${PHASE_LABEL[s.phase]}`),
          source ? badge('', `来源：${source.displayName}`) : null,
          s.kind ? badge('', `类型：${kindLabel(s.kind)}`) : null,
          s.token && s.phase !== 'applying'
            ? action('放弃本次导入', () => view.reset(), { title: '清除本地预览引用并回到来源选择；不删除已提交目标' })
            : null,
        ]),
      ]);
    }

    function renderPreloadHint(s: ImportPanelState) {
      if (s.channelsWired) return null;
      return h('div', { class: 'empty-card', role: 'status', 'aria-live': 'polite' }, [
        h('strong', {}, '导入通道未接通'),
        h('p', { class: 'note' }, channelsMissingText(s.preloadMissing)),
        h('p', { class: 'note' }, '当前只展示设计中的来源卡片与流程；文件选择已禁用，不会生成伪造计划或写入任何目标。'),
      ]);
    }

    function renderInterrupted(s: ImportPanelState) {
      if (!s.interrupted.length) return null;
      return h('section', { class: 'import-interrupted', 'aria-label': '未完成的导入' }, [
        h('h3', {}, `上次导入未完成（${s.interrupted.length} 个作业）`),
        ...s.interrupted.slice(0, 3).map((job: ImportJob) => h('div', { class: 'empty-card', key: job.jobId }, [
          h('p', {}, `作业 ${job.jobId}：已提交 ${job.counts.committed}，剩余 ${job.counts.remaining}。`),
          h('p', { class: 'note' }, `来源 ${job.sourceId || '未知'} · 类型 ${kindLabel(job.kind)} · 更新时间 ${job.updatedAt || '未知'}`),
          actions([
            action('查看报告', () => view.openInterruptedReport(job.jobId), { disabled: !s.channelsWired }),
            action('继续导入', () => void view.resume(job.jobId), { primary: true, disabled: !s.channelsWired || s.busy || !job.resumable }),
            action('放弃并新建', () => view.reset(), { title: '只结束本页显示；作业日志与已提交目标保留' }),
          ]),
        ])),
        h('p', { class: 'note' }, '不会自动继续；继续前会核对目标 provenance，无法确认的条目会如实报告。'),
      ]);
    }

    function renderAlerts(s: ImportPanelState) {
      return [
        s.error ? h('p', { class: 'error', role: 'alert' }, s.error) : null,
        s.notice ? h('p', { class: 'note', role: 'status', 'aria-live': 'polite' }, s.notice) : null,
        s.sourcesError ? h('p', { class: 'note', role: 'status' }, `来源列表读取失败：${s.sourcesError}`) : null,
      ];
    }

    function renderStepper(s: ImportPanelState) {
      const current = STEP_ORDER.indexOf(s.step);
      return h('ol', { class: 'import-stepper', 'aria-label': '导入步骤' }, STEP_ORDER.map((step, index) => h('li', {
        key: step,
        class: ['import-step', index === current ? 'is-current' : '', index < current ? 'is-done' : ''].filter(Boolean),
        'aria-current': index === current ? 'step' : undefined,
        title: STEP_HINT[step],
      }, [
        badge(index < current ? 'badge-ok' : '', String(index + 1)),
        h('span', {}, STEP_LABEL[step]),
      ])));
    }

    function renderIssues(issues: LocalPreviewIssue[], label = '损坏 / 无法导入的条目') {
      if (!issues.length) return null;
      return h('details', { class: 'import-issues note', 'aria-label': label }, [
        h('summary', {}, `${label}（${issues.length}）— 灰显区，不影响其余条目`),
        h('ul', {}, issues.slice(0, 200).map((issue, index) => h('li', {
          key: `${issue.code}-${index}`,
          class: 'note',
        }, `${issue.index >= 0 ? `第 ${issue.index + 1} 条` : '条目'} · ${issue.code} · ${issue.message}`))),
      ]);
    }

    // —— 1. 来源选择 ——
    function renderSourceCard(s: ImportPanelState, source: ImportSource) {
      const selected = s.sourceId === source.id;
      return h('button', {
        key: source.id,
        type: 'button',
        class: ['import-source-card', selected ? 'is-selected' : ''].filter(Boolean),
        'aria-pressed': selected,
        onClick: () => view.selectSource(source.id),
      }, [
        h('span', { class: 'import-source-title' }, source.displayName),
        badge(selected ? 'badge-ok' : '', selected ? '已选择' : (s.channelsWired ? '可选' : '通道未接通')),
        h('span', { class: 'note' }, `${source.kinds.map(kindLabel).join(' / ') || '类型未声明'} · 格式 ${source.formatVersion || '未声明'} · 兼容性：${source.compatibility || '未声明'}`),
        limitText(source.limits) ? h('span', { class: 'note' }, limitText(source.limits)) : null,
        ...source.notes.map((note, index) => h('span', { class: 'note', key: `note-${index}` }, note)),
      ]);
    }

    function renderSourceStep(s: ImportPanelState) {
      const source = s.sources.find((entry) => entry.id === s.sourceId) ?? null;
      return h('section', { class: 'import-step-panel', 'aria-label': '选择来源' }, [
        h('h3', {}, '1. 选择来源'),
        h('p', { class: 'note' }, '来源由主进程固定适配器解析；面板不接收任意文件路径，候选只用于 Host 预览，不展示完整正文。'),
        s.sourcesLoading ? h('p', { class: 'note', role: 'status' }, '正在读取 Host 来源列表…') : null,
        !s.sources.length
          ? h('p', { class: 'note' }, s.sourcesLoaded ? 'Host 未登记任何可用来源。' : '没有可用来源。')
          : h('div', { class: 'import-source-grid' }, s.sources.map((entry) => renderSourceCard(s, entry))),
        h('div', { class: 'empty-card', 'aria-label': '文件选择器' }, [
          h('h3', {}, source ? `已选择：${source.displayName}` : '文件选择器'),
          h('p', { class: 'note' }, source
            ? `类型：${source.kinds.map(kindLabel).join(' / ') || '未声明'}；${source.notes.join('；') || '无附加说明'}`
            : '先在来源卡片中选择一项。'),
          h('p', { class: 'note' }, '调用 importPickFile(sourceId) 获取文件适配结果；仅收到对话框需求说明时会提示“请选择文件”，不会生成预览令牌。实际候选交给 Host 重新校验。'),
          actions([
            action(s.channelsWired ? '选择文件…' : '选择文件…（通道未接通）', () => void view.pickFile(), {
              primary: true,
              disabled: !s.channelsWired || s.busy || !source,
              title: s.channelsWired ? '打开系统文件对话框' : 'preload.cjs 的 import* IPC 不完整',
            }),
            s.busy ? h('span', { class: 'note', role: 'status' }, '处理中…') : null,
          ]),
          source && source.kinds.length > 1
            ? field(
              '导入类型',
              select(
                s.kind,
                source.kinds.map((kind) => ({ value: kind, label: kindLabel(kind) })),
                (value) => view.setKind(value as ImportPanelState['kind']),
                s.busy,
              ),
            )
            : null,
        ]),
      ]);
    }

    // —— 2. 本地预览 ——
    function renderLocalItem(item: NonNullable<ImportPanelState['localPreview']>['items'][number]) {
      const detail = [
        `${item.messages} 条消息`,
        item.textBytes ? `${item.textBytes} 字节` : '',
        item.reason || '',
      ].filter(Boolean).join(' · ');
      return h('li', { key: item.candidateId, class: 'import-row' }, [
        h('span', { class: 'import-row-title' }, item.displayTitle),
        item.action ? badge(actionBadgeClass(item.action), ACTION_LABEL[item.action]) : badge('', '待 Host 校验'),
        h('span', { class: 'note' }, detail),
      ]);
    }

    function renderPreviewStep(s: ImportPanelState) {
      const local = s.localPreview;
      if (!local) return h('p', { class: 'note' }, '尚未完成本地预览。');
      const summary = local.summary;
      return h('section', { class: 'import-step-panel', 'aria-label': '本地预览' }, [
        h('h3', {}, '2. 本地预览'),
        h('p', {}, [
          badge('badge-ok', `候选 ${summary.candidates}`), ' ',
          badge('', `重复 ${summary.duplicates}`), ' ',
          badge('badge-warn', `冲突 ${summary.conflicts}`), ' ',
          badge('badge-danger', `问题 ${summary.issues}`),
        ]),
        h('p', { class: 'note' }, '本地预览只用于定位；指纹、去重与冲突判定以 Host 重新校验的结果为准，本页不会写入目标。'),
        local.items.length
          ? h('ul', { class: 'import-preview-list' }, local.items.slice(0, 100).map(renderLocalItem))
          : h('p', { class: 'note' }, '没有候选条目。'),
        local.items.length > 100 ? h('p', { class: 'note' }, `仅显示前 100 条，共 ${local.items.length} 条。`) : null,
        renderIssues(local.issues),
        actions([
          action('返回来源', () => view.backToSource(), { disabled: s.busy }),
          action('下一步：字段映射', () => view.toMapping(), { primary: true, disabled: s.busy }),
        ]),
      ]);
    }

    // —— 3. 字段映射 ——
    function renderMappingFields(s: ImportPanelState) {
      const kind = s.kind;
      const busy = s.busy || s.phase === 'applying';
      if (kind === 'conversation') {
        const titleMode = s.mapping.titleMode || 'keep';
        return [
          field('会话标题', select(titleMode, [
            { value: 'keep', label: '保留来源标题' },
            { value: 'prefix', label: '添加前缀' },
            { value: 'custom', label: '自定义标题' },
          ], (value) => view.setMapping({ titleMode: value as ImportMapping['titleMode'] }), busy)),
          titleMode === 'prefix'
            ? field('标题前缀', textInput(s.mapping.prefix || '', (value) => view.setMapping({ prefix: value }), '例如：ChatGPT-', busy, 50))
            : null,
          titleMode === 'custom'
            ? field('自定义标题', textInput(s.mapping.displayTitle || '', (value) => view.setMapping({ displayTitle: value }), '仅用于本批会话标题', busy))
            : null,
          field('工作区绑定', select(s.mapping.workspaceMode || 'none', [
            { value: 'none', label: '不绑定工作区' },
            { value: 'current', label: '绑定当前工作区', disabled: !props.workspaceDirectory },
          ], (value) => view.setMapping({ workspaceMode: value as ImportMapping['workspaceMode'] }), busy),
          props.workspaceDirectory ? `当前工作区：${props.workspaceDirectory}` : '当前没有工作区，绑定选项已禁用。'),
          h('p', { class: 'note' }, '目标：会话库（用户作用域）。导入只新建独立会话，绝不追加到当前会话，也不伪造工具、审批或执行事件。'),
        ];
      }
      if (kind === 'knowledge') {
        const titleMode = s.mapping.titleMode || 'source';
        return [
          field('知识标题', select(titleMode, [
            { value: 'source', label: '来源标题' },
            { value: 'filename', label: '文件名' },
            { value: 'prefix', label: '自定义前缀' },
          ], (value) => view.setMapping({ titleMode: value as ImportMapping['titleMode'] }), busy)),
          titleMode === 'prefix'
            ? field('标题前缀', textInput(s.mapping.titlePrefix || '', (value) => view.setMapping({ titlePrefix: value }), '例如：导入-', busy, 50))
            : null,
          field('作用域', select(s.target.scope, [
            { value: 'user', label: '用户知识' },
            { value: 'project', label: '当前项目知识', disabled: !props.workspaceDirectory },
          ], (value) => view.setTarget({ scope: value as ImportScope }), busy),
          props.workspaceDirectory ? `项目作用域使用当前工作区：${props.workspaceDirectory}` : '没有工作区时项目作用域不可选。'),
          h('p', { class: 'note' }, '知识按一次快照批量写入；容量上限 200 个文档，快照接近 2 MiB 时 Host 会警告。单条非法不拖垮整批。'),
        ];
      }
      if (kind === 'config') {
        return [
          field('更新策略', select(s.mapping.updatePolicy || 'new-only', [
            { value: 'new-only', label: '仅新增（默认）' },
            { value: 'allow-updates', label: '允许更新同 ID 配置' },
          ], (value) => view.setMapping({ updatePolicy: value as ImportMapping['updatePolicy'] }), busy)),
          h('p', { class: 'note' }, '目标：用户配置（供应商、自定义模型、绑定、预算、探测）。仅接受 config 包；secret-bundle 整包拒绝。'),
          h('p', { class: 'note' }, '凭据绑定：本页不读取密钥值。未映射到本机已有凭据引用的供应商，导入后需配置凭据并启用。'),
          h('p', { class: 'note' }, '默认只新增；覆盖更新必须逐条显式选择，不会静默覆盖本机配置。'),
        ];
      }
      return h('p', { class: 'note' }, '当前来源没有可配置的映射。');
    }

    function renderMappingStep(s: ImportPanelState) {
      return h('section', { class: 'import-step-panel', 'aria-label': '字段映射' }, [
        h('h3', {}, '3. 字段映射'),
        h('p', { class: 'note' }, '映射变化会使 Host 计划哈希变化；修改后必须重新预览才能确认导入。'),
        s.planStale ? badge('badge-warn', '映射已修改，计划已过期') : null,
        ...renderMappingFields(s),
        actions([
          action('上一步：本地预览', () => view.backToPreview(), { disabled: s.busy }),
          action(s.phase === 'previewing' ? '正在生成计划…' : '由 Host 生成计划', () => void view.previewPlan(), {
            primary: true,
            disabled: !s.channelsWired || s.busy || !s.token,
          }),
        ]),
      ]);
    }

    // —— 4. 确认条目 ——
    function planItemDetail(item: ImportPlanItem, kind: ImportPanelState['kind']): string {
      const parts: string[] = [];
      if (item.detail.messages !== undefined) parts.push(`${item.detail.messages} 条消息`);
      if (item.detail.skippedMessages) parts.push(`跳过 ${item.detail.skippedMessages} 条`);
      if (item.action === 'duplicate') parts.push('目标中已存在，不重复写入');
      if (item.action === 'invalid') parts.push(item.detail.reason || '条目非法，已跳过');
      if (item.action === 'skipped') parts.push('按策略跳过');
      if (item.action === 'conflict') {
        parts.push(kind === 'config' ? '目标已有同 ID 配置；可覆盖更新或跳过' : '来源与已导入内容不同；可作新副本或跳过');
      }
      return parts.join(' · ') || '—';
    }

    function renderDecisionRow(s: ImportPanelState, item: ImportPlanItem) {
      const allowed = allowedDecisions(item.action, s.kind);
      const selectable = allowed.includes('append') || allowed.includes('overwrite');
      const includeDecision: ImportDecision = allowed.includes('overwrite') ? 'overwrite' : 'append';
      const decision = decisionFor(s, item);
      const conflictSelect = item.action === 'conflict'
        ? select(decision, [
          { value: 'skip', label: DECISION_LABEL.skip },
          { value: includeDecision, label: DECISION_LABEL[includeDecision] },
          { value: 'dismiss', label: DECISION_LABEL.dismiss },
        ], (value) => view.setDecision(item.itemId, value as ImportDecision), s.busy)
        : null;
      return h('li', {
        key: item.itemId,
        class: ['import-row', item.action === 'invalid' ? 'note import-row-muted' : ''].filter(Boolean),
      }, [
        checkbox(
          isItemSelected(s, item),
          !selectable || s.busy,
          `${item.displayTitle}：${selectable ? '选中则写入' : '不可选'}`,
          (checked) => view.setDecision(item.itemId, checked ? includeDecision : 'skip'),
        ),
        h('div', { class: 'import-row-main' }, [
          h('div', {}, [
            h('strong', {}, item.displayTitle),
            ' ',
            badge(actionBadgeClass(item.action), ACTION_LABEL[item.action]),
          ]),
          h('p', { class: 'note' }, planItemDetail(item, s.kind)),
        ]),
        conflictSelect,
      ]);
    }

    function renderDecisionStep(s: ImportPanelState) {
      const plan = s.plan;
      if (!plan) {
        return h('section', { class: 'import-step-panel', 'aria-label': '确认条目' }, [
          h('h3', {}, '4. 确认条目'),
          h('p', { class: 'note' }, '还没有 Host 计划。请先完成字段映射并生成计划。'),
          actions([action('返回字段映射', () => view.backToMapping(), { primary: true })]),
        ]);
      }
      const summary = selectionSummary(s);
      return h('section', { class: 'import-step-panel', 'aria-label': '确认条目' }, [
        h('h3', {}, '4. 确认条目'),
        h('p', {}, [
          badge('badge-ok', `新增 ${plan.counts.new}`), ' ',
          badge('', `重复 ${plan.counts.duplicate}`), ' ',
          badge('badge-warn', `冲突 ${plan.counts.conflict}`), ' ',
          badge('badge-danger', `无效 ${plan.counts.invalid}`),
        ]),
        h('p', { class: 'note' }, '重复、无效与未选中的冲突不会写入。冲突默认不选；全选只选新增。'),
        s.planStale ? h('p', { class: 'note', role: 'alert' }, '计划已过期：字段映射或目标已修改，必须重新预览。') : null,
        actions([
          action('全选新增', () => view.batchDecision('select-new'), { disabled: s.busy }),
          s.kind === 'config'
            ? action('覆盖更新冲突', () => view.batchDecision('overwrite-conflicts'), { disabled: s.busy })
            : action('冲突作为新副本', () => view.batchDecision('new-copy-conflicts'), { disabled: s.busy }),
          action('取消所有冲突', () => view.batchDecision('dismiss-conflicts'), { disabled: s.busy }),
          action('全部跳过', () => view.batchDecision('skip-all'), { disabled: s.busy }),
        ]),
        h('ul', { class: 'import-decision-list' }, plan.items.map((item) => renderDecisionRow(s, item))),
        h('p', { class: 'note', role: 'status', 'aria-live': 'polite' },
          `将写入 ${summary.count} 条（新增 ${summary.newCount}，冲突副本 ${summary.conflictAppend}，覆盖 ${summary.conflictOverwrite}）；重复/冲突/无效未选中不会写入。`),
        renderIssues(plan.issues),
        actions([
          action('上一步：字段映射', () => view.backToMapping(), { disabled: s.busy }),
          action('重新预览', () => void view.previewPlan(), { disabled: !s.channelsWired || s.busy || !s.token }),
          action(`确认导入 ${summary.count} 条`, () => void view.apply(), {
            primary: true,
            disabled: !s.channelsWired || s.busy || summary.count === 0 || s.planStale,
          }),
        ]),
      ]);
    }

    // —— 5. 进度 ——
    function renderProgressStep(s: ImportPanelState) {
      const job = s.job;
      if (!job) return h('p', { class: 'note', role: 'status' }, '正在创建导入作业…');
      const total = job.counts.total || 0;
      const committed = job.counts.committed || 0;
      const percent = total > 0 ? Math.min(100, Math.round((committed / total) * 100)) : 0;
      return h('section', { class: 'import-step-panel', 'aria-label': '导入进度' }, [
        h('h3', {}, '5. 导入进度'),
        h('p', {}, [
          badge(phaseBadgeClass(s.phase), `阶段：${PHASE_LABEL[s.phase]}`), ' ',
          badge('', `作业：${JOB_STATUS_LABEL[job.status]}`),
        ]),
        h('progress', {
          class: 'import-progress',
          max: Math.max(total, 1),
          value: committed,
          'aria-label': '导入进度',
          'aria-valuetext': `已提交 ${committed} / ${total}`,
        }),
        h('p', { class: 'note' },
          `已提交 ${committed} / ${total}（${percent}%） · 重复 ${job.counts.duplicate} · 失败 ${job.counts.failed} · 剩余 ${job.counts.remaining}`),
        job.current ? h('p', {}, `当前：${job.current.displayTitle}`) : null,
        h('p', { class: 'note' }, '取消后已提交条目保留、未开始条目不写入；不会回滚，也不会虚报完成。'),
        s.pollFailures > 0 && !s.polling
          ? h('p', { class: 'note', role: 'alert' }, '轮询已暂停；作业可能仍在进行。')
          : null,
        actions([
          action('取消导入', () => void view.cancel(), {
            danger: true,
            disabled: !s.channelsWired || s.busy || isTerminalStatus(job.status),
          }),
          !s.polling && s.pollFailures > 0
            ? action('继续轮询', () => view.resumePolling(), { primary: true, disabled: s.busy })
            : null,
        ]),
      ]);
    }

    // —— 6. 报告 ——
    function renderTarget(target: ImportReportTarget | null) {
      if (!target || !target.id) return '—';
      const text = `${target.kind || 'target'}:${target.id}`;
      if (target.kind === 'session' || target.kind === 'knowledge') {
        return h('button', {
          class: 'btn btn-small',
          type: 'button',
          title: '打开导入目标',
          onClick: () => emit('open-target', target),
        }, `查看 ${text}`);
      }
      return text;
    }

    function renderReportTable(report: ImportReport) {
      if (!report.items.length) return h('p', { class: 'note' }, '报告没有逐项条目。');
      return h('table', { class: 'import-report-table' }, [
        h('thead', {}, h('tr', {}, ['序号', '标题', '动作', '状态', '原因', '目标'].map((label) => h('th', { key: label }, label)))),
        h('tbody', {}, report.items.map((item) => h('tr', { key: item.itemId }, [
          h('td', {}, String(item.index + 1)),
          h('td', {}, item.displayTitle),
          h('td', {}, item.action ? badge(actionBadgeClass(item.action), ACTION_LABEL[item.action]) : '—'),
          h('td', {}, item.status),
          h('td', { class: 'note' }, item.code || '—'),
          h('td', {}, renderTarget(item.target)),
        ]))),
      ]);
    }

    function renderReportStep(s: ImportPanelState) {
      const report = s.report;
      const summary = summarizeReport(report);
      return h('section', { class: 'import-step-panel', 'aria-label': '导入报告' }, [
        h('h3', {}, '6. 导入报告'),
        h('p', {}, [
          badge(phaseBadgeClass(s.phase), `阶段：${PHASE_LABEL[s.phase]}`), ' ',
          report ? badge('', `作业：${JOB_STATUS_LABEL[report.status]}`) : null,
        ]),
        h('div', { class: 'import-summary', 'aria-live': 'polite' }, [
          badge('badge-ok', `已应用 ${summary.applied}`),
          badge('', `已跳过 ${summary.skipped}`),
          badge('badge-danger', `损坏/失败 ${summary.corrupted}`),
          badge('badge-warn', `警告 ${summary.warnings}`),
        ]),
        s.reportLoading ? h('p', { class: 'note', role: 'status' }, '正在读取报告…') : null,
        report ? renderReportTable(report) : h('p', { class: 'note' }, '报告尚未读取。'),
        report ? renderIssues(report.issues, '报告中的问题与警告') : null,
        h('p', { class: 'note' }, '报告不含消息正文、凭据或完整来源路径；已提交条目不会因取消或失败而回滚。'),
        actions([
          report && report.nextOffset !== null
            ? action('加载更多', () => view.loadMoreReport(), { disabled: s.reportLoading })
            : null,
          (s.phase === 'partial' || s.phase === 'failed') && s.token
            ? action('重新预览并重试', () => view.retryFromMapping(), { primary: true })
            : null,
          s.phase === 'cancelled' && s.token
            ? action('继续剩余项（重新预览）', () => view.retryFromMapping(), { primary: true })
            : null,
          action('开始新的导入', () => view.reset()),
        ]),
      ]);
    }

    return () => {
      void revision.value;
      const s = view.state;
      return h('section', {
        class: 'import-panel',
        'aria-label': '数据导入',
        'aria-busy': s.busy || s.phase === 'applying' ? 'true' : 'false',
      }, [
        renderHeader(s),
        renderPreloadHint(s),
        renderInterrupted(s),
        renderAlerts(s),
        renderStepper(s),
        s.step === 'source' ? renderSourceStep(s)
          : s.step === 'preview' ? renderPreviewStep(s)
            : s.step === 'mapping' ? renderMappingStep(s)
              : s.step === 'decision' ? renderDecisionStep(s)
                : s.step === 'progress' ? renderProgressStep(s)
                  : renderReportStep(s),
      ]);
    };
  },
});
