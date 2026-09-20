/**
 * SaCode Desktop MVP shell.
 * Vite proxy attaches daemon Bearer server-side; WebView never holds token.
 * Sidecar bridge may pass token into memory only.
 */
import {
  DaemonClient,
  daemonHealthError,
  parseAgentsList,
  type AgentDescriptor,
} from '@cherishron/sacode-client-core';
import './styles.css';

declare const __SACODE_ENV__:
  | { SACODE_BASE_URL?: string; SACODE_AUTH_TOKEN?: string }
  | undefined;

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('#app missing');

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> & { className?: string } = {},
  children: (Node | string)[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  Object.assign(node, props);
  for (const child of children) {
    node.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return node;
}

interface DaemonTarget {
  host: string;
  port: number;
  token?: string;
}

/** In-memory only — never injected into __SACODE_ENV__ for Vite proxy mode. */
let memoryToken: string | undefined;

function parseBaseToTarget(baseUrl: string, token?: string): DaemonTarget {
  try {
    const u = new URL(baseUrl);
    return {
      host: u.hostname,
      port: Number(u.port || (u.protocol === 'https:' ? 443 : 80)),
      token,
    };
  } catch {
    return { host: '127.0.0.1', port: 8080, token };
  }
}

function readDaemonTarget(): DaemonTarget {
  const host = (document.querySelector<HTMLInputElement>('#host')?.value || '127.0.0.1').trim();
  const port = Number(document.querySelector<HTMLInputElement>('#port')?.value || 8080);
  // Manual token field is optional escape hatch; Vite proxy mode leaves it empty.
  const manual = document.querySelector<HTMLInputElement>('#token')?.value?.trim();
  return {
    host,
    port: Number.isFinite(port) ? port : 8080,
    token: manual || memoryToken,
  };
}

function client(): DaemonClient {
  const t = readDaemonTarget();
  return new DaemonClient({
    host: t.host,
    port: t.port,
    token: t.token,
    entrySource: 'desktop',
  });
}

function log(line: string) {
  const box = document.querySelector<HTMLPreElement>('#log');
  if (!box) return;
  const ts = new Date().toISOString().slice(11, 19);
  box.textContent = `[${ts}] ${line}\n${box.textContent ?? ''}`.slice(0, 12000);
}

async function refreshHealth() {
  const c = client();
  const health = await c.health();
  const badge = document.querySelector<HTMLSpanElement>('#health-badge');
  if (!badge) return;
  if (!health) {
    badge.textContent = 'daemon offline';
    badge.dataset.state = 'bad';
    log('health: offline');
    return;
  }
  const err = daemonHealthError(health);
  if (err) {
    badge.textContent = err;
    badge.dataset.state = 'warn';
  } else {
    badge.textContent = `healthy · v${health.version}`;
    badge.dataset.state = 'ok';
  }
  log(`health: ${health.status} ${health.version}`);
}

async function refreshAgents() {
  const c = client();
  const t = readDaemonTarget();
  const listEl = document.querySelector<HTMLDivElement>('#agents');
  if (!listEl) return;
  listEl.replaceChildren();
  try {
    const res = await fetch(`${c.baseUrl}/agents`, {
      headers: t.token ? { Authorization: `Bearer ${t.token}` } : {},
    });
    const body = await res.json();
    const parsed = parseAgentsList(body);
    for (const agent of parsed.agents) {
      listEl.append(renderAgent(agent, parsed.default_backend_id));
    }
    if (parsed.agents.length === 0) {
      listEl.append(el('div', { className: 'muted' }, ['No agents registered']));
    }
    log(`agents: ${parsed.agents.map((a) => a.id).join(', ') || '(none)'}`);
  } catch (e) {
    listEl.append(el('div', { className: 'muted' }, [`agents load failed: ${e}`]));
  }
}

function renderAgent(agent: AgentDescriptor, defaultId: string): HTMLElement {
  const isDefault = agent.id === defaultId;
  return el(
    'div',
    { className: 'agent-card' },
    [
      el('div', { className: 'agent-title' }, [
        el('strong', {}, [agent.display_name || agent.id]),
        el('span', { className: 'badge' }, [agent.id]),
        ...(isDefault ? [el('span', { className: 'badge default' }, ['default'])] : []),
      ]),
      el('div', { className: 'muted' }, [
        `kind=${agent.kind ?? '-'} health=${agent.health ?? '-'}`,
      ]),
    ],
  );
}

async function runTask() {
  const prompt = document.querySelector<HTMLTextAreaElement>('#prompt')?.value?.trim() || '';
  const backendId = document.querySelector<HTMLSelectElement>('#backend')?.value || 'sacode';
  const mode =
    (document.querySelector<HTMLSelectElement>('#mode')?.value as 'plan' | 'build' | 'auto') ||
    'build';
  if (!prompt) {
    log('prompt is empty');
    return;
  }
  const c = client();
  try {
    const created = await c.createTask({
      prompt,
      mode,
      backendId,
      workspaceRoot: '.',
    });
    log(`task created: ${created.task_id} status=${created.status} backend=${backendId}`);
    const resultBox = document.querySelector<HTMLPreElement>('#result');
    if (resultBox) resultBox.textContent = JSON.stringify(created, null, 2);
    void pollTask(created.task_id);
  } catch (e) {
    log(`createTask failed: ${e}`);
  }
}

async function pollTask(taskId: string) {
  const c = client();
  for (let i = 0; i < 60; i += 1) {
    await new Promise((r) => setTimeout(r, 2000));
    try {
      const st = await c.getTaskStatus(taskId);
      log(`status[${i}] ${st.status} ${st.error ?? ''}`);
      if (st.status === 'completed' || st.status === 'failed' || st.status === 'error') {
        const result = document.querySelector<HTMLPreElement>('#result');
        if (result) result.textContent = JSON.stringify(st, null, 2);
        return;
      }
    } catch (e) {
      log(`status poll error: ${e}`);
      return;
    }
  }
}

interface SidecarBridge {
  start?: () => Promise<{
    ok: boolean;
    base_url?: string;
    port?: number;
    token?: string;
    error?: string;
  }>;
  stop?: () => Promise<{ ok: boolean; error?: string }>;
}

declare global {
  interface Window {
    __SACODE_SIDECAR__?: SidecarBridge;
  }
}

async function startSidecar() {
  const bridge = typeof window !== 'undefined' ? window.__SACODE_SIDECAR__ : undefined;
  if (!bridge?.start) {
    log('sidecar bridge missing. Run in Vite (auto-proxy) or Tauri shell.');
    return;
  }
  try {
    const res = await bridge.start();
    if (!res.ok || !res.base_url) {
      log(`sidecar start failed: ${res.error || 'unknown'}`);
      return;
    }
    if (res.token) memoryToken = res.token;
    const target = parseBaseToTarget(res.base_url);
    const hostEl = document.querySelector<HTMLInputElement>('#host');
    const portEl = document.querySelector<HTMLInputElement>('#port');
    if (hostEl) hostEl.value = target.host;
    if (portEl) portEl.value = String(target.port);
    log(`sidecar started ${res.base_url}`);
    void refreshHealth();
  } catch (e) {
    log(`sidecar start error: ${e}`);
  }
}

async function stopSidecar() {
  const bridge = typeof window !== 'undefined' ? window.__SACODE_SIDECAR__ : undefined;
  if (!bridge?.stop) {
    log('sidecar stop: no bridge (kill sacode serve process manually)');
    return;
  }
  try {
    const res = await bridge.stop();
    log(res.ok ? 'sidecar stopped' : `sidecar stop failed: ${res.error}`);
  } catch (e) {
    log(`sidecar stop error: ${e}`);
  }
}

function mount() {
  const envBase = typeof __SACODE_ENV__ !== 'undefined' ? __SACODE_ENV__.SACODE_BASE_URL : '';
  // Empty SACODE_BASE_URL → Vite same-origin proxy; token never in WebView.
  const initial =
    envBase && envBase.length > 0
      ? parseBaseToTarget(envBase)
      : { host: '127.0.0.1', port: 8080 };

  app!.replaceChildren(
    el('header', { className: 'header' }, [
      el('h1', {}, ['SaCode Desktop']),
      el('span', { id: 'health-badge', className: 'badge' }, ['daemon …']),
    ]),
    el('section', { className: 'grid' }, [
      el('div', { className: 'card' }, [
        el('h2', {}, ['Daemon / Sidecar']),
        el('label', {}, ['Host ', el('input', { id: 'host', value: initial.host })]),
        el('label', {}, ['Port ', el('input', { id: 'port', value: String(initial.port) })]),
        el('label', {}, [
          'Token (optional manual) ',
          el('input', {
            id: 'token',
            type: 'password',
            placeholder: 'Vite 代理模式请留空',
          }),
        ]),
        el('div', { className: 'row' }, [
          el('button', { id: 'btn-sidecar-start', onclick: () => void startSidecar() }, [
            '启动 Sidecar',
          ]),
          el('button', { id: 'btn-sidecar-stop', onclick: () => void stopSidecar() }, [
            '停止 Sidecar',
          ]),
        ]),
        el('div', { className: 'row' }, [
          el('button', { id: 'btn-health', onclick: () => void refreshHealth() }, ['Health']),
          el('button', { id: 'btn-agents', onclick: () => void refreshAgents() }, ['Agents']),
        ]),
        el('div', { id: 'agents', className: 'agents' }),
      ]),
      el('div', { className: 'card' }, [
        el('h2', {}, ['Task']),
        el('textarea', { id: 'prompt', rows: 4, placeholder: '输入任务…' }),
        el('div', { className: 'row' }, [
          el('label', {}, [
            'Backend ',
            el(
              'select',
              { id: 'backend' },
              [
                el('option', { value: 'sacode' }, ['sacode']),
                el('option', { value: 'opencode' }, ['opencode']),
              ],
            ),
          ]),
          el('label', {}, [
            'Mode ',
            el(
              'select',
              { id: 'mode' },
              [
                el('option', { value: 'build' }, ['build']),
                el('option', { value: 'plan' }, ['plan']),
                el('option', { value: 'auto' }, ['auto']),
              ],
            ),
          ]),
          el('button', { id: 'btn-run', onclick: () => void runTask() }, ['Run']),
        ]),
        el('pre', { id: 'result', className: 'result' }),
      ]),
    ]),
    el('section', { className: 'card' }, [
      el('h2', {}, ['Log']),
      el('pre', { id: 'log', className: 'log' }),
    ]),
  );
  log(
    envBase && envBase.length > 0
      ? `env base_url=${envBase}`
      : 'Vite 代理模式（token 仅存在于 dev server 进程）',
  );
  void refreshHealth();
}

mount();
