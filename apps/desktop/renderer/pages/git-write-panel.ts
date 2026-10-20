import {defineComponent,h,ref,watch,onScopeDispose,type PropType} from 'vue';
import {
  channelsMissingText,
  createGitWritePanel,
  resolveGitWriteChannels,
  type GitStatusEntry,
  type GitWritePanelState,
} from './git-write-panel-state';

const STATUS_LABEL: Record<string, string> = { M: '修改', A: '新增', D: '删除', R: '重命名', C: '复制', U: '冲突', '?': '未跟踪' };

function statusLabel(entry: GitStatusEntry): string {
  return STATUS_LABEL[entry.x] || STATUS_LABEL[entry.y] || '变更';
}

export const Page = defineComponent({
  name: 'GitWritePanelPage',
  props: {
    channels: { type: Object as PropType<any>, default: null },
    sessionId: { type: String, required: true },
    directory: { type: String, required: true },
    active: { type: Boolean, default: true },
  },
  setup(props) {
    const revision = ref(0);
    let resolved = resolveGitWriteChannels(props.channels);
    let view = createGitWritePanel(
      resolved.channels,
      () => ({ sessionId: props.sessionId, directory: props.directory }),
      () => { revision.value++; },
    );

    watch(() => props.channels, () => {
      view.dispose();
      resolved = resolveGitWriteChannels(props.channels);
      view = createGitWritePanel(
        resolved.channels,
        () => ({ sessionId: props.sessionId, directory: props.directory }),
        () => { revision.value++; },
      );
      revision.value++;
      if (props.active) void view.refresh();
    });
    watch(() => [props.sessionId, props.directory], () => {
      view.reset();
      if (props.active) void view.refresh();
    });
    watch(() => props.active, (active) => {
      if (active) {
        if (!view.state.loaded) void view.refresh();
      } else {
        view.reset();
      }
    }, { immediate: true });
    onScopeDispose(() => view.dispose());

    function badges(entry: GitStatusEntry) {
      if (entry.conflicted) return h('span', { class: 'badge badge-danger' }, '冲突');
      if (entry.partial) return h('span', { class: 'badge badge-warn' }, '部分暂存');
      if (entry.untracked) return h('span', { class: 'badge' }, '未跟踪');
      if (entry.staged) return h('span', { class: 'badge badge-ok' }, '已暂存');
      return h('span', { class: 'badge' }, '未暂存');
    }

    function row(s: GitWritePanelState, entry: GitStatusEntry, scope: string) {
      const disabled = !s.writeWired || !s.loaded || s.truncated || s.busy || !props.active;
      let choice = null;
      if (scope === 'index' && entry.unstageable) {
        choice = h('label', { class: 'git-stage-choice' }, [
          h('input', {
            type: 'checkbox',
            'aria-label': `选择取消暂存 ${entry.path}`,
            checked: s.unstagePaths.includes(entry.path),
            disabled,
            onChange: (event: any) => view.toggleUnstagePath(entry.path, !!event.target.checked),
          }),
          h('span', { class: 'sr-only' }, `选择取消暂存 ${entry.path}`),
        ]);
      } else if (scope !== 'conflict' && entry.stageable) {
        choice = h('label', { class: 'git-stage-choice' }, [
          h('input', {
            type: 'checkbox',
            'aria-label': `选择暂存 ${entry.path}`,
            checked: s.stagePaths.includes(entry.path),
            disabled,
            onChange: (event: any) => view.toggleStagePath(entry.path, !!event.target.checked),
          }),
          h('span', { class: 'sr-only' }, `选择暂存 ${entry.path}`),
        ]);
      } else {
        choice = h('span', { class: 'git-stage-choice', title: entry.conflicted ? '冲突项不能暂存或取消暂存' : '部分暂存需逐 hunk 审阅，本面板不整文件覆盖' },
          h('span', { class: 'sr-only' }, '此路径不可整文件暂存'));
      }
      return h('div', { class: 'git-change-item', key: `${scope}:${entry.path}` }, [
        choice,
        h('span', { class: 'git-status-letter', title: `porcelain ${entry.x}${entry.y}` }, `${entry.x}${entry.y}`),
        h('span', { class: 'git-change-path' }, entry.path),
        entry.oldPath ? h('span', { class: 'note' }, `← ${entry.oldPath}`) : null,
        h('span', { class: 'note' }, statusLabel(entry)),
        badges(entry),
      ]);
    }

    function group(title: string, rows: GitStatusEntry[], scope: string) {
      if (!rows.length) return null;
      const s = view.state;
      const canSelect = scope === 'index' || scope === 'working' || scope === 'untracked';
      return h('section', { class: 'git-change-group', key: `group:${scope}` }, [
        h('div', { class: 'git-group-header' }, [
          h('h3', {}, `${title} · ${rows.length}`),
          canSelect ? h('button', {
            class: 'btn btn-mini',
            type: 'button',
            disabled: !s.loaded || s.truncated || s.busy || !props.active,
            onClick: () => (scope === 'index' ? view.selectAllUnstage() : view.selectAllStage()),
          }, '全选') : null,
        ]),
        ...rows.map((entry) => row(s, entry, scope)),
      ]);
    }

    function missingSection(s: GitWritePanelState) {
      if (!s.missing.length) return null;
      return h('div', { class: 'empty-card', role: 'status', 'aria-live': 'polite' }, [
        h('strong', {}, 'Git 通道未接通'),
        h('p', { class: 'note' }, channelsMissingText(s.missing)),
        h('p', { class: 'note' }, '当前只展示可用的只读信息；暂存、取消暂存、提交与推送按钮已禁用，不会伪造 Git 操作结果。'),
      ]);
    }

    function selectionSection(s: GitWritePanelState) {
      const blocked = !s.writeWired || !s.loaded || s.truncated || s.busy || !props.active;
      return h('section', { class: 'git-action-controls', 'aria-label': '暂存与取消暂存' }, [
        h('h3', {}, '暂存与取消暂存'),
        h('p', { class: 'note' }, '只对选中的精确路径生效；已有索引内容（包括部分暂存）不会被整文件覆盖。'),
        h('div', { class: 'row git-action-buttons' }, [
          h('button', {
            class: 'btn btn-primary',
            type: 'button',
            disabled: blocked || s.stagePaths.length === 0,
            onClick: () => void view.stageSelected(),
          }, `暂存所选 ${s.stagePaths.length} 个路径`),
          h('button', {
            class: 'btn',
            type: 'button',
            disabled: blocked || s.unstagePaths.length === 0,
            onClick: () => void view.unstageSelected(),
          }, `取消暂存所选 ${s.unstagePaths.length} 个路径`),
          h('button', {
            class: 'btn btn-mini',
            type: 'button',
            disabled: blocked || (!s.stagePaths.length && !s.unstagePaths.length),
            onClick: () => view.clearSelection(),
          }, '清空选择'),
        ]),
      ]);
    }

    function commitSection(s: GitWritePanelState) {
      const staged = s.entries.filter((entry) => entry.staged && !entry.conflicted);
      const blocked = !s.writeWired || !s.loaded || s.truncated || s.busy
        || s.entries.some((entry) => entry.conflicted) || !staged.length || !s.commitMessage.trim();
      return h('section', { class: 'git-action-controls', 'aria-label': '提交已暂存内容' }, [
        h('h3', {}, '提交已暂存内容'),
        h('p', { class: 'note' }, '提交与推送分别批准；提交只包含当前索引，不会自动推送。'),
        h('p', { class: 'note' }, `已暂存路径（${staged.length}）：${staged.length ? staged.map((entry) => entry.path).join('、') : '无'}`),
        staged.length ? h('ul', { class: 'git-staged-list' }, staged.map((entry) => h('li', { key: `staged:${entry.path}` }, [
          h('code', {}, entry.path),
          entry.partial ? h('span', { class: 'badge badge-warn' }, '部分暂存') : null,
        ]))) : null,
        h('label', { class: 'git-commit-message' }, [
          h('span', {}, '提交说明'),
          h('textarea', {
            class: 'input',
            'aria-label': '提交说明',
            rows: 3,
            maxLength: 4000,
            value: s.commitMessage,
            disabled: !s.writeWired || s.busy || s.truncated || !props.active,
            onInput: (event: any) => view.setCommitMessage(event.target.value),
          }),
        ]),
        h('label', { class: 'git-stage-choice' }, [
          h('input', {
            type: 'checkbox',
            'aria-label': '确认提交审批',
            checked: s.commitArmed,
            disabled: blocked || s.busy || !props.active,
            onChange: (event: any) => view.armCommit(!!event.target.checked),
          }),
          h('span', {}, '确认提交审批（独立审批）'),
        ]),
        h('button', {
          class: 'btn btn-primary',
          type: 'button',
          disabled: !s.commitArmed || s.busy || !props.active,
          onClick: () => void view.commit(),
        }, '提交已暂存内容（独立审批）'),
        s.commitProposal ? h('div', { class: 'empty-card' }, [
          h('strong', {}, '提交提案已生成'),
          h('p', {}, `actionId：${s.commitProposal.actionId} · revision：${s.commitProposal.revision}`),
          h('p', { class: 'note' }, `审批摘要：${s.commitProposal.approvalBody || '（未提供）'}`),
          h('p', { class: 'note' }, '等待独立审批；批准前不会执行提交。'),
        ]) : null,
      ]);
    }

    function pushSection(s: GitWritePanelState) {
      return h('section', { class: 'git-push-preview', 'aria-label': '推送预览' }, [
        h('h3', {}, '推送预览'),
        h('p', { class: 'note' }, '只使用当前分支已配置的单一上游；不提供强推、镜像推送、tags 或自动设置 upstream。'),
        h('p', { class: 'note' }, '推送会访问网络并可能运行 Git hooks 与凭据助手；推送需要独立审批。'),
        h('button', {
          class: 'btn',
          type: 'button',
          disabled: !s.pushTargetWired || s.busy || s.pushBusy || !props.active,
          onClick: () => void view.preparePush(),
        }, '读取推送预览'),
        s.pushBusy ? h('p', { class: 'note', role: 'status' }, '正在读取推送目标…') : null,
        s.pushTarget ? h('dl', { class: 'git-push-target' }, [
          h('dt', {}, '远端'), h('dd', {}, s.pushTarget.remote),
          h('dt', {}, '目标分支'), h('dd', {}, s.pushTarget.ref),
          h('dt', {}, 'HEAD OID'), h('dd', {}, h('code', {}, s.pushTarget.headOid)),
        ]) : null,
        s.pushTarget ? h('label', { class: 'git-stage-choice' }, [
          h('input', {
            type: 'checkbox',
            'aria-label': '确认推送审批',
            checked: s.pushArmed,
            disabled: !s.writeWired || !s.loaded || s.truncated || s.busy || !props.active,
            onChange: (event: any) => view.armPush(!!event.target.checked),
          }),
          h('span', {}, '确认推送审批（独立审批）'),
        ]) : null,
        h('button', {
          class: 'btn btn-primary',
          type: 'button',
          disabled: !s.pushArmed || s.busy || !props.active,
          onClick: () => void view.push(),
        }, '推送已核验提交（独立审批）'),
      ]);
    }

    function resultLine(s: GitWritePanelState) {
      if (!s.lastAction) return null;
      if (s.lastAction.status === 'succeeded') {
        return h('p', { class: 'note', role: 'status' }, s.lastAction.kind === 'commit'
          ? `提交已完成：${s.lastAction.newCommit || ''}`
          : '推送已完成。');
      }
      return h('p', { class: 'note', role: 'status' }, '结果未确认（git-outcome-unknown）；请核对实际状态。');
    }

    return () => {
      void revision.value;
      const s = view.state;
      const conflicts = s.entries.filter((entry) => entry.conflicted);
      const staged = s.entries.filter((entry) => entry.staged && !entry.conflicted);
      const unstaged = s.entries.filter((entry) => entry.unstaged && !entry.conflicted);
      const untracked = s.entries.filter((entry) => entry.untracked);
      return h('section', { class: 'git-write-panel', 'aria-label': 'Git 写操作' }, [
        h('div', { class: 'editor-heading' }, [
          h('h2', {}, 'Git 写操作'),
          h('button', {
            class: 'btn',
            type: 'button',
            disabled: !s.statusWired || s.busy || !props.active,
            onClick: () => void view.refresh(),
          }, '刷新 Git 状态'),
        ]),
        h('p', { class: 'note' }, '暂存、取消暂存、提交与推送分别生成独立提案；每次提交与推送分别批准，不会自动进入下一步。'),
        missingSection(s),
        s.error ? h('p', { class: 'editor-error', role: 'alert' }, s.error) : null,
        s.notice ? h('p', { class: 'note', role: 'status', 'aria-live': 'polite' }, s.notice) : null,
        s.truncated ? h('p', { class: 'editor-error', role: 'alert' }, 'Git 状态已截断，清单不完整；写操作已禁用。') : null,
        s.statusWired && s.busy && !s.loaded ? h('p', { class: 'note', role: 'status' }, '正在读取 Git 状态…') : null,
        s.loaded ? h('p', { class: 'note' }, `当前分支：${s.branch || '（不可用）'}；只展示真实 porcelain 状态，不推断任务差异。`) : null,
        group('冲突', conflicts, 'conflict'),
        group('已暂存', staged, 'index'),
        group('未暂存', unstaged, 'working'),
        group('未跟踪', untracked, 'untracked'),
        s.loaded && !s.entries.length ? h('p', { class: 'note' }, '当前没有变更。') : null,
        selectionSection(s),
        commitSection(s),
        pushSection(s),
        resultLine(s),
      ]);
    };
  },
});
