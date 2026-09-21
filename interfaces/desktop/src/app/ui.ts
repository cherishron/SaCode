/** Desktop M2 UI layout — workspace, daemon, session, approvals, changes, settings. */
import { el } from '../dom.ts';
import type { DesktopApp } from './service.ts';

export function mountApp(root: HTMLElement, app: DesktopApp) {
  app.onChange = () => render(root, app);
  render(root, app);
  void app.init(localStorage.getItem('sacode.workspace') || undefined);
}

function render(root: HTMLElement, app: DesktopApp) {
  const scrollTimeline = root.querySelector('#timeline')?.scrollTop ?? 0;
  root.replaceChildren(buildUi(app));
  const t = root.querySelector('#timeline');
  if (t) t.scrollTop = scrollTimeline;
  bind(root, app);
}

function buildUi(app: DesktopApp) {
  const healthClass =
    !app.health || app.health.status !== 'healthy'
      ? app.health
        ? 'warn'
        : 'bad'
      : 'ok';

  return el('div', { className: 'shell' }, [
    el('header', { className: 'header' }, [
      el('h1', {}, ['SaCode Desktop']),
      el('span', { className: 'badge ' + healthClass }, [app.healthLabel()]),
      el('span', { className: 'badge' }, [app.mode === 'tauri' ? 'Tauri' : 'Vite']),
      el('span', { className: 'badge' }, [
        app.handle ? `pid ${app.handle.pid}` : 'no sidecar',
      ]),
    ]),
    el('div', { className: 'layout' }, [
      // Left column
      el('aside', { className: 'col left' }, [
        el('section', { className: 'card' }, [
          el('h2', {}, ['Workspace']),
          el('label', {}, [
            '路径 ',
            el('input', {
              id: 'workspace',
              value: app.workspace || '',
              placeholder: 'SaCode 仓库根目录（默认自动）',
            }),
          ]),
          el('div', { className: 'row' }, [
            el('button', { id: 'btn-init' }, ['连接 / 启动 Daemon']),
            el('button', { id: 'btn-stop-sidecar', className: 'ghost' }, ['停止 Sidecar']),
          ]),
        ]),
        el('section', { className: 'card' }, [
          el('h2', {}, ['Daemon / Agents']),
          el('div', { className: 'muted' }, [
            app.handle
              ? `${app.handle.base_url} · auth=${app.handle.auth_required}`
              : 'Vite 代理或未启动',
          ]),
          el('div', { id: 'agents', className: 'agents' },
            app.agents.length === 0
              ? [el('div', { className: 'muted' }, ['No agents'])]
              : app.agents.map((a) =>
                  el('div', { className: 'agent-card' }, [
                    el('strong', {}, [a.display_name || a.id]),
                    el('span', { className: 'badge' }, [a.id]),
                    a.id === app.defaultBackend
                      ? el('span', { className: 'badge default' }, ['default'])
                      : '',
                  ].filter(Boolean) as Node[]),
                ),
          ),
        ]),
        el('section', { className: 'card' }, [
          el('h2', {}, ['Settings / Diagnostics']),
          el('label', {}, [
            'Mode ',
            el('select', { id: 'mode' }, [
              el('option', { value: 'build' }, ['build']),
              el('option', { value: 'plan' }, ['plan']),
              el('option', { value: 'auto' }, ['auto']),
            ]),
          ]),
          el('label', {}, [
            'Backend ',
            el(
              'select',
              { id: 'backend' },
              (app.agents.length
                ? app.agents.map((a) => a.id)
                : ['sacode', 'opencode']
              ).map((id) =>
                el('option', { value: id, ...(id === app.defaultBackend ? { selected: true } : {}) }, [
                  id,
                ]),
              ),
            ),
          ]),
          el('div', { className: 'row' }, [
            el('button', { id: 'btn-health', className: 'ghost' }, ['Health']),
            el('button', { id: 'btn-agents', className: 'ghost' }, ['Refresh Agents']),
            el('button', { id: 'btn-diag', className: 'ghost' }, ['导出诊断 JSON']),
          ]),
        ]),
      ]),
      // Center
      el('main', { className: 'col center' }, [
        el('section', { className: 'card session' }, [
          el('h2', {}, ['Session']),
          el('div', { id: 'timeline', className: 'timeline' },
            app.timeline.length === 0
              ? [el('div', { className: 'muted' }, ['输入任务开始会话'])]
              : app.timeline.map((item) =>
                  el('div', { className: `msg ${item.kind}` }, [
                    el('div', { className: 'msg-kind' }, [item.kind]),
                    el('div', { className: 'msg-text' }, [item.text]),
                    ...(item.detail
                      ? [el('pre', { className: 'msg-detail' }, [item.detail])]
                      : []),
                  ]),
                ),
          ),
          el('textarea', {
            id: 'prompt',
            rows: 3,
            placeholder: '例如：读取 README 并总结…（build 模式可触发 fs.read 等工具）',
          }),
          el('div', { className: 'row' }, [
            el('button', { id: 'btn-run' }, ['运行']),
            el('button', { id: 'btn-stop', className: 'danger' }, ['Stop']),
            el('span', { className: 'muted' }, [
              app.currentTaskId ? `task=${app.currentTaskId}` : 'idle',
            ]),
          ]),
        ]),
        el('section', { className: 'card' }, [
          el('h2', {}, ['Approvals']),
          el('div', { id: 'approvals' },
            app.approvals.length === 0
              ? [el('div', { className: 'muted' }, ['无待审批'])]
              : app.approvals.map((a) =>
                  el('div', { className: 'approval-card' }, [
                    el('div', {}, [
                      el('strong', {}, [a.tool_name]),
                      el('span', { className: 'badge' }, [a.side_effect_level]),
                      el('span', { className: 'muted' }, [` ${a.approval_id}`]),
                    ]),
                    el('pre', { className: 'msg-detail' }, [
                      JSON.stringify(a.args, null, 2).slice(0, 600),
                    ]),
                    el('div', { className: 'row' }, [
                      el(
                        'button',
                        {
                          className: 'ok',
                          onclick: () => void app.resolveApproval(a.approval_id, true),
                        },
                        ['允许'],
                      ),
                      el(
                        'button',
                        {
                          className: 'danger',
                          onclick: () => void app.resolveApproval(a.approval_id, false, 'denied from desktop'),
                        },
                        ['拒绝'],
                      ),
                    ]),
                  ]),
                ),
          ),
        ]),
      ]),
      // Right
      el('aside', { className: 'col right' }, [
        el('section', { className: 'card' }, [
          el('h2', {}, ['Changes / Tool Writes']),
          el('div', { id: 'changes' },
            app.changes.length === 0
              ? [el('div', { className: 'muted' }, ['尚无 fs.write / git 变更事件'])]
              : app.changes.slice(-40).reverse().map((c) =>
                  el('div', { className: 'change-card' }, [
                    el('div', {}, [
                      el('span', { className: 'badge' }, [c.tool]),
                      el('span', { className: 'path' }, [' ', c.path]),
                    ]),
                    el('pre', { className: 'msg-detail' }, [c.detail]),
                  ]),
                ),
          ),
        ]),
        el('section', { className: 'card' }, [
          el('h2', {}, ['Log']),
          el('pre', { id: 'log', className: 'log' }, [
            app.timeline
              .filter((t) => t.kind === 'system' || t.kind === 'error')
              .slice(-40)
              .map((t) => `[${t.kind}] ${t.text}`)
              .join('\n'),
          ]),
        ]),
      ]),
    ]),
  ]);
}

function bind(root: HTMLElement, app: DesktopApp) {
  root.querySelector('#btn-init')?.addEventListener('click', () => {
    const ws = (root.querySelector('#workspace') as HTMLInputElement)?.value?.trim();
    if (ws) localStorage.setItem('sacode.workspace', ws);
    app.workspace = ws || app.workspace;
    void app.init(ws || undefined);
  });
  root.querySelector('#btn-stop-sidecar')?.addEventListener('click', () => {
    void app.stopSidecar();
  });
  root.querySelector('#btn-run')?.addEventListener('click', () => {
    const prompt = (root.querySelector('#prompt') as HTMLTextAreaElement)?.value?.trim() || '';
    const mode = ((root.querySelector('#mode') as HTMLSelectElement)?.value ||
      'build') as 'plan' | 'build' | 'auto';
    const backendId =
      (root.querySelector('#backend') as HTMLSelectElement)?.value || app.defaultBackend || 'sacode';
    if (!prompt) {
      app.error('prompt 为空');
      return;
    }
    void app.runTask({ prompt, mode, backendId });
  });
  root.querySelector('#btn-stop')?.addEventListener('click', () => {
    void app.stopTask();
  });
  root.querySelector('#btn-health')?.addEventListener('click', () => {
    void app.refreshHealth();
  });
  root.querySelector('#btn-agents')?.addEventListener('click', () => {
    void app.refreshAgents();
  });
  root.querySelector('#btn-diag')?.addEventListener('click', () => {
    const json = app.exportDiagnostics();
    const blob = new Blob([json], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `sacode-desktop-diag-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    app.log('diagnostics exported');
  });
}
