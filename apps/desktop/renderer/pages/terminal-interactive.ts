// F09 交互终端 Vue 组件。
// xterm.js 挂载点先用占位 div；xterm.js vendor 后续由 scripts/pack-xterm.mjs 构建期折叠。
// 当 globalThis.Xterm 不可用时，显示占位提示而非假装终端。
//
// 与 terminal-output.ts 并存（设计文档 §2）：
// - 本组件管 terminal/* 交互通道（create/input/resize/interrupt/output/close/kill）
// - terminal-output.ts 管 session/terminal-output 只读回放，不动
// - 子标签切换在后续接线时加入（本组件先独立可用）
//
// 约束：不修改 preload.cjs；通道函数由 props 传入，未接通时显示提示。
import { defineComponent, h, ref, watch, onBeforeUnmount, onMounted, type PropType } from 'vue';
import { createTerminalInteractive, type TerminalChannels, type TerminalPhase, type TerminalChunk } from './terminal-interactive-state';

const PHASE_LABEL: Record<TerminalPhase, string> = {
  idle: '未启动', creating: '启动中', running: '运行中', exiting: '停止中',
  exited: '已退出', unknown: '状态未知', 'view-closed': '视图已关',
};

const PHASE_CLASS: Record<TerminalPhase, string> = {
  idle: 'term-phase-idle', creating: 'term-phase-creating', running: 'term-phase-running',
  exiting: 'term-phase-exiting', exited: 'term-phase-exited',
  unknown: 'term-phase-unknown', 'view-closed': 'term-phase-closed',
};

export const TerminalInteractive = defineComponent({
  name: 'SaCodeTerminalInteractive',
  props: {
    active: { type: Boolean, default: false },
    sessionId: { type: String, default: '' },
    directory: { type: String, default: '' },
    configured: { type: Boolean, default: false },
    workspaceRevision: { type: String, default: '' },
    // 通道函数（由 preload.cjs 后续提供，未接通时为 undefined）
    channels: { type: Object as PropType<TerminalChannels | null>, default: null },
  },
  emits: ['choose'],
  setup(props, { emit }) {
    const revision = ref(0);
    const subTab = ref<'interactive' | 'history'>('interactive');
    const closeDialog = ref(false);
    const interruptBusy = ref(false);
    const xtermContainer = ref<HTMLElement | null>(null);
    const xtermReady = ref(false);
    const xtermError = ref('');
    // 在 setup 阶段就检查 xterm 全局是否可用，未加载时立即设占位提示
    // （onMounted 在测试环境不触发，渲染函数需自洽）
    if (!(globalThis as Record<string, unknown>).Xterm) {
      xtermError.value = 'xterm.js 尚未加载（vendor 构建期折叠未完成）。当前显示占位。';
    }
    // xterm 实例（非响应式，避免 Vue 深度代理）
    let xterm: { write: (data: string) => void; dispose: () => void; cols: number; rows: number; onData: (cb: (data: string) => void) => void; loadAddon: (addon: unknown) => void; reset: () => void; } | null = null;
    let fitAddon: { fit: () => void; dispose: () => void; } | null = null;
    let resizeObserver: ResizeObserver | null = null;
    let resizeRaf = 0;
    let pollTimer = 0;

    // 通道存根：未接通时用占位函数，让状态机不崩
    const stubChannels: TerminalChannels = {
      create: async () => { throw Error('终端通道未接通：preload.cjs 尚未添加 terminal/* IPC。'); },
      input: async () => { throw Error('终端通道未接通。'); },
      resize: async () => { throw Error('终端通道未接通。'); },
      interrupt: async () => { throw Error('终端通道未接通。'); },
      describe: async () => { throw Error('终端通道未接通。'); },
      output: async () => { throw Error('终端通道未接通。'); },
      close: async () => { throw Error('终端通道未接通。'); },
      kill: async () => { throw Error('终端通道未接通。'); },
    };

    const view = createTerminalInteractive(
      props.channels || stubChannels,
      () => props.sessionId || '',
      () => { revision.value++; },
    );

    // 会话/目录变更时重置
    watch(
      () => [props.sessionId, props.directory, props.configured],
      () => {
        if (view.state.sessionId) void view.closeView();
        view.reset();
        xterm?.reset();
        closeDialog.value = false;
      },
    );

    watch(
      () => props.active,
      active => {
        if (!active) {
          // 标签切走时不 close（只是不可见）；停止 poll
          if (resizeRaf) { cancelAnimationFrame(resizeRaf); resizeRaf = 0; }
        }
      },
    );

    // —— xterm.js 挂载 ——
    onMounted(() => {
      const X = (globalThis as Record<string, unknown>).Xterm as
        { Terminal: new (opts: Record<string, unknown>) => typeof xterm; FitAddon: new () => typeof fitAddon; } | undefined;
      if (!X || !xtermContainer.value) {
        xtermError.value = 'xterm.js 尚未加载（vendor 构建期折叠未完成）。当前显示占位。';
        return;
      }
      try {
        xterm = new X.Terminal({
          cols: 80, rows: 24,
          scrollback: 10000,
          fontFamily: 'monospace',
          fontSize: 14,
          cursorBlink: true,
          allowProposedApi: true,
        });
        fitAddon = new X.FitAddon();
        xterm.loadAddon(fitAddon);
        xterm.open(xtermContainer.value);
        fitAddon.fit();
        xtermReady.value = true;
        // 用户键入 → terminal/input（不经过 composer）
        xterm.onData(data => {
          if (props.active && view.state.phase === 'running') void view.writeInput(data);
        });
        // ResizeObserver → terminal/resize（防抖到 rAF）
        resizeObserver = new ResizeObserver(() => {
          if (!xterm || !fitAddon || view.state.phase !== 'running') return;
          if (resizeRaf) cancelAnimationFrame(resizeRaf);
          resizeRaf = requestAnimationFrame(() => {
            resizeRaf = 0;
            if (!xterm || !fitAddon || view.state.phase !== 'running') return;
            fitAddon.fit();
            void view.resize(xterm.cols, xterm.rows);
          });
        });
        resizeObserver.observe(xtermContainer.value);
        // 直播环轮询：与 turn/poll 同构，防 notify 丢帧；仅激活且 running 时拉取。
        // 定时器只在挂载后存在，测试环境不触发 onMounted，故不会污染单测。
        pollTimer = setInterval(() => {
          if (props.active && view.state.phase === 'running') void view.pollOutput();
        }, 150);
      } catch (e) {
        xtermError.value = String((e as Error).message || e);
      }
    });

    onBeforeUnmount(() => {
      if (pollTimer) { clearInterval(pollTimer); pollTimer = 0; }
      if (resizeRaf) cancelAnimationFrame(resizeRaf);
      resizeObserver?.disconnect();
      resizeObserver = null;
      fitAddon?.dispose();
      fitAddon = null;
      xterm?.dispose();
      xterm = null;
      view.dispose();
    });

    // —— 输出消费：将新 chunks 写入 xterm ——
    watch(revision, () => {
      if (!xterm || !xtermReady.value) return;
      const chunks = view.consumeChunks();
      for (const chunk of chunks) {
        xterm.write(chunk.data);
      }
    });

    // —— 动作 ——
    async function startTerminal(): Promise<void> {
      if (!props.configured || !props.directory) return;
      if (!props.channels) { xtermError.value = '终端通道未接通：preload.cjs 尚未添加 terminal/* IPC。'; return; }
      const cols = xterm?.cols || 80, rows = xterm?.rows || 24;
      await view.create(cols, rows, props.directory, props.workspaceRevision);
    }

    async function doInterrupt(): Promise<void> {
      if (interruptBusy.value) return;
      interruptBusy.value = true;
      try { await view.interrupt(); } finally { interruptBusy.value = false; }
    }

    async function doCloseView(): Promise<void> {
      closeDialog.value = false;
      await view.closeView();
    }

    async function doKillAndClose(): Promise<void> {
      closeDialog.value = false;
      await view.kill();
      await view.closeView();
    }

    function requestClose(): void {
      if (view.state.phase === 'running' || view.state.phase === 'exiting') {
        closeDialog.value = true;
      } else {
        void doCloseView();
      }
    }

    // —— 渲染 ——
    function renderPhaseBadge(): unknown {
      const s = view.state;
      return h('span', { class: ['term-phase-badge', PHASE_CLASS[s.phase]] }, PHASE_LABEL[s.phase]);
    }

    function renderStatusBar(): unknown {
      const s = view.state;
      return h('div', { class: 'term-status-bar' }, [
        renderPhaseBadge(),
        s.cwd ? h('span', { class: 'term-cwd', title: s.cwd }, s.cwd) : null,
        s.pid != null ? h('span', { class: 'term-pid' }, 'PID ' + s.pid) : null,
        s.exitObserved ? h('span', { class: 'term-exit' }, '退出码 ' + (s.exitCode ?? '?')) : null,
        s.truncated ? h('span', { class: 'term-truncated', role: 'status' }, '输出已截断') : null,
      ]);
    }

    function renderToolbar(): unknown {
      const s = view.state;
      const canStart = !s.busy && props.configured && (s.phase === 'idle' || s.phase === 'exited' || s.phase === 'unknown' || s.phase === 'view-closed');
      const canInterrupt = !interruptBusy.value && s.phase === 'running';
      const canClose = s.sessionId != null && s.phase !== 'view-closed';
      return h('div', { class: 'term-toolbar' }, [
        h('button', { class: 'btn', type: 'button', disabled: !canStart, onClick: () => void startTerminal() }, '启动终端'),
        h('button', { class: 'btn', type: 'button', disabled: !canInterrupt, onClick: () => void doInterrupt() }, '中断（Ctrl+C）'),
        canClose ? h('button', { class: 'btn', type: 'button', onClick: requestClose }, '关闭') : null,
      ]);
    }

    function renderXtermArea(): unknown {
      if (xtermError.value && !xtermReady.value) {
        return h('div', { class: 'term-xterm-placeholder' }, [
          h('p', { class: 'note' }, xtermError.value),
          h('p', { class: 'note' }, 'xterm.js 将由 scripts/pack-xterm.mjs 在构建期折叠为 renderer/vendor/xterm.iife.js。'),
        ]);
      }
      return h('div', { ref: xtermContainer, class: 'term-xterm-container' });
    }

    function renderCloseDialog(): unknown {
      if (!closeDialog.value) return null;
      return h('div', { class: 'term-close-dialog', role: 'dialog', 'aria-modal': 'true', 'aria-label': '关闭终端' }, [
        h('p', {}, '终端仍在运行。'),
        h('div', { class: 'row term-close-buttons' }, [
          h('button', { class: 'btn', type: 'button', onClick: () => void doCloseView() }, '仅关视图'),
          h('button', { class: 'btn btn-primary', type: 'button', onClick: () => void doKillAndClose() }, '停止并关'),
          h('button', { class: 'btn', type: 'button', onClick: () => { closeDialog.value = false; } }, '取消'),
        ]),
        h('p', { class: 'note' }, '仅关视图：终端在后台继续运行，可从历史回放恢复查看。停止并关：向进程组发停止信号，确认退出后关闭。'),
      ]);
    }

    function renderHistoryPlaceholder(): unknown {
      return h('details', { class: 'term-history-placeholder' }, [
        h('summary', {}, '历史回放（从会话日志）'),
        h('p', { class: 'note' }, '展开后将从 session/terminal-output 通道读取已落盘的终端输出。已落盘输出 ≠ 实时终端。'),
        h('p', { class: 'note' }, '此区域在后续接线时复用 terminal-output-state.ts 的只读分页逻辑。'),
      ]);
    }

    function renderNotConfigured(): unknown {
      return h('div', { class: 'empty-card' }, [
        h('strong', {}, '先选择工作区目录'),
        h('button', { class: 'btn', onClick: () => emit('choose') }, '选择工作区'),
      ]);
    }

    function renderChannelsNotConnected(): unknown {
      return h('p', { class: 'note', role: 'status' }, '终端通道未接通：preload.cjs 尚未添加 terminal/* IPC。组件已就绪，等待通道接线。');
    }

    return () => {
      void revision.value;
      const s = view.state;
      return h('section', { class: 'terminal-interactive', 'aria-label': '交互终端' }, [
        h('header', { class: 'terminal-interactive-heading' }, [
          h('h2', {}, '交互终端'),
          // 子标签切换（设计文档 §2.1）
          h('div', { class: 'term-subtabs' }, [
            h('button', { class: ['btn btn-mini', subTab.value === 'interactive' ? 'active' : ''], type: 'button', onClick: () => { subTab.value = 'interactive'; } }, '交互终端'),
            h('button', { class: ['btn btn-mini', subTab.value === 'history' ? 'active' : ''], type: 'button', onClick: () => { subTab.value = 'history'; } }, '历史回放'),
          ]),
        ]),
        !props.configured ? renderNotConfigured() : subTab.value === 'history' ? h('div', { class: 'term-history-fallback' }, [
          h('p', { class: 'note' }, '历史回放子标签：后续接线时嵌入 terminal-output.ts 内容。'),
          h('p', { class: 'note' }, '当前请使用工作台「终端」标签的现有只读回放页面。'),
        ]) : [
          renderStatusBar(),
          renderToolbar(),
          s.error ? h('p', { class: 'editor-error', role: 'alert' }, s.error) : null,
          renderXtermArea(),
          s.busy ? h('p', { class: 'note', role: 'status' }, '处理中…') : null,
          renderCloseDialog(),
          renderHistoryPlaceholder(),
          !props.channels ? renderChannelsNotConnected() : null,
          // 沙箱提示（后端设计文档 T1：一期不进 AppContainer）
          s.phase === 'running' ? h('p', { class: 'note' }, '交互终端未进入执行沙箱；模型工具仍走 execution + 沙箱。') : null,
        ],
      ]);
    };
  },
});
