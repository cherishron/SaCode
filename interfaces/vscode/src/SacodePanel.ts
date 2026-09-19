import * as vscode from 'vscode';
import { daemonHealthError, SseClient } from './SseClient';
import { ApprovalDeduplicator } from './ApprovalDeduplicator';
import { ApprovalRequestView, approvalQuickPickOptions, resolveApprovalWithRetry } from './ApprovalUi';
import { ApprovalDiffReviewer, DiffReviewResult } from './ApprovalDiffReviewer';
import { decodeSseEvent, isRecord } from './sseEvents';
import type { ApprovalInfo } from './sseEvents';
import type { SSEEvent } from './types';
import {
    FAILURE_CATEGORY_LABELS,
    SUGGESTED_ACTION_LABELS,
    TASK_STATE_LABELS,
    isTerminalState,
} from './taskProtocol';
import type { TaskSnapshot } from './taskProtocol';

type PanelMessage =
    | { command: 'status'; connected: boolean }
    | { command: 'taskId'; id: string }
    | { command: 'selection'; text: string; length: number }
    | { command: 'message'; type: string; text: string }
    | { command: 'done' }
    | { command: 'error'; text: string };


export class SacodePanel {
    public static readonly viewType = 'sacode-panel';
    private static instance: SacodePanel | null = null;

    private panel: vscode.WebviewPanel | null = null;
    private client: SseClient;
    private currentTaskId: string | null = null;
    private abortStream: (() => void) | null = null;
    private taskGeneration = 0;
    private readonly approvals = new ApprovalDeduplicator();
    private readonly diffReviewer = new ApprovalDiffReviewer();
    private disposables: vscode.Disposable[] = [];
    private static daemonReady: boolean = false;
    private static selectedText: string = '';

    constructor(private extensionUri: vscode.Uri, client: SseClient) {
        this.client = client;
    }

    static createOrShow(extensionUri: vscode.Uri, client: SseClient) {
        if (SacodePanel.instance?.panel) {
            SacodePanel.instance.panel.reveal(vscode.ViewColumn.Beside);
            return;
        }
        const instance = new SacodePanel(extensionUri, client);
        instance.createPanel();
        SacodePanel.instance = instance;
    }

    static setDaemonReady(ready: boolean) {
        SacodePanel.daemonReady = ready;
        SacodePanel.instance?.postMessage({ command: 'status', connected: ready });
    }

    static setSelectionContext(text: string) {
        SacodePanel.selectedText = text;
        SacodePanel.instance?.postMessage({
            command: 'selection',
            text: text,
            length: text.length,
        });
    }

    static stopCurrentTask() {
        SacodePanel.instance?.stopTask();
    }

    static runWithPrompt(prompt: string) {
        SacodePanel.instance?.runTask(prompt);
    }

    static render() {
        SacodePanel.instance?.renderView();
    }

    private createPanel() {
        this.panel = vscode.window.createWebviewPanel(
            SacodePanel.viewType,
            'SaCode Agent',
            vscode.ViewColumn.Beside,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [
                    vscode.Uri.joinPath(this.extensionUri, 'media'),
                ],
            }
        );

        this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
        this.panel.webview.onDidReceiveMessage(
            (msg) => this.handleMessage(msg),
            null,
            this.disposables
        );

        this.renderView();
        this.checkConnection();
    }

    private renderView() {
        if (!this.panel) return;
        this.panel.webview.html = this.getHtml();
    }

    private getHtml(): string {
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>SaCode Agent</title>
    <style>
        :root {
            --bg: #0d1117;
            --surface: #161b22;
            --border: #30363d;
            --text: #e6edf3;
            --muted: #8b949e;
            --accent: #58a6ff;
            --success: #3fb950;
            --warning: #d29922;
        }
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: var(--bg); color: var(--text); font-size: 13px; }
        .container { display: flex; flex-direction: column; height: 100vh; }
        .header { padding: 8px 12px; background: var(--surface); border-bottom: 1px solid var(--border); display: flex; gap: 8px; align-items: center; }
        .header .status { font-size: 11px; color: var(--muted); }
        .header .status.connected { color: var(--success); }
        .header .status.disconnected { color: var(--warning); }
        .selection-bar { padding: 4px 12px; background: rgba(88, 166, 255, 0.1); border-bottom: 1px solid var(--border); font-size: 11px; color: var(--accent); display: none; }
        .selection-bar.visible { display: block; }
        .input-area { padding: 8px; border-bottom: 1px solid var(--border); }
        .input-area textarea { width: 100%; padding: 8px; background: var(--surface); border: 1px solid var(--border); color: var(--text); border-radius: 4px; resize: vertical; min-height: 60px; font-family: inherit; font-size: 13px; }
        .input-area .actions { display: flex; gap: 6px; margin-top: 6px; }
        .input-area button { padding: 4px 12px; background: var(--accent); color: #fff; border: none; border-radius: 4px; cursor: pointer; font-size: 12px; }
        .input-area button:disabled { opacity: 0.5; cursor: default; }
        .input-area button.danger { background: #da3633; }
        .messages { flex: 1; overflow-y: auto; padding: 8px; }
        .msg { padding: 6px 8px; margin-bottom: 4px; border-radius: 4px; border-left: 3px solid var(--border); }
        .msg.system { border-left-color: var(--accent); }
        .msg.tool { border-left-color: var(--warning); }
        .msg.error { border-left-color: #da3633; }
        .msg.thinking { border-left-color: var(--muted); font-style: italic; color: var(--muted); }
        .msg.diff { border-left-color: var(--success); }
        .msg .label { font-size: 10px; color: var(--muted); margin-bottom: 2px; text-transform: uppercase; }
        .msg pre { white-space: pre-wrap; word-break: break-word; margin: 0; }
        .msg .diff-add { color: var(--success); }
        .msg .diff-del { color: #da3633; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <span>SaCode</span>
            <span class="status" id="status">checking...</span>
            <span style="flex:1"></span>
            <span id="taskId" style="font-size:11px;color:var(--muted)"></span>
        </div>
        <div class="selection-bar" id="selectionBar">
            <span id="selectionInfo"></span>
        </div>
        <div class="input-area">
            <textarea id="prompt" placeholder="Describe the task to run..." rows="3"></textarea>
            <div class="actions">
                <button id="runBtn" onclick="runTask()">Run</button>
                <button id="stopBtn" class="danger" onclick="stopTask()" disabled>Stop</button>
            </div>
        </div>
        <div class="messages" id="messages"></div>
    </div>
    <script>
        const vscode = acquireVsCodeApi();
        const messages = document.getElementById('messages');
        const prompt = document.getElementById('prompt');
        const runBtn = document.getElementById('runBtn');
        const stopBtn = document.getElementById('stopBtn');
        const status = document.getElementById('status');
        const taskId = document.getElementById('taskId');
        const selectionBar = document.getElementById('selectionBar');
        const selectionInfo = document.getElementById('selectionInfo');
        let selectedText = '';

        function addMessage(type, text) {
            const div = document.createElement('div');
            div.className = 'msg ' + type;
            const label = document.createElement('div');
            label.className = 'label';
            label.textContent = type;
            div.appendChild(label);
            const pre = document.createElement('pre');

            // diff 高亮：检测 +/- 前缀行
            if (type === 'diff') {
                const lines = text.split('\\n');
                const frag = document.createDocumentFragment();
                for (const line of lines) {
                    const span = document.createElement('span');
                    if (line.startsWith('+') && !line.startsWith('+++')) {
                        span.className = 'diff-add';
                    } else if (line.startsWith('-') && !line.startsWith('---')) {
                        span.className = 'diff-del';
                    }
                    span.textContent = line + '\\n';
                    frag.appendChild(span);
                }
                pre.appendChild(frag);
            } else {
                pre.textContent = text;
            }

            div.appendChild(pre);
            messages.appendChild(div);
            messages.scrollTop = messages.scrollHeight;
        }

        function runTask() {
            const text = prompt.value.trim();
            if (!text) return;
            // 如果有选区文本，合并为前缀
            const fullPrompt = selectedText
                ? '[选区上下文]\\n' + selectedText + '\\n\\n[任务]\\n' + text
                : text;
            addMessage('system', text);
            if (selectedText) {
                addMessage('thinking', '已注入选区 ' + selectedText.length + ' 字符');
            }
            runBtn.disabled = true;
            stopBtn.disabled = false;
            prompt.value = '';
            vscode.postMessage({ command: 'runTask', text: fullPrompt });
        }

        function stopTask() {
            vscode.postMessage({ command: 'stopTask' });
            stopBtn.disabled = true;
            addMessage('system', 'Stopping task...');
        }

        window.addEventListener('message', event => {
            const msg = event.data;
            switch (msg.command) {
                case 'status':
                    status.textContent = msg.connected ? 'connected' : 'disconnected';
                    status.className = 'status ' + (msg.connected ? 'connected' : 'disconnected');
                    break;
                case 'taskId':
                    taskId.textContent = 'task: ' + msg.id;
                    break;
                case 'selection':
                    selectedText = msg.text || '';
                    if (selectedText) {
                        selectionBar.classList.add('visible');
                        selectionInfo.textContent = '已选 ' + selectedText.length + ' 字符，将作为上下文注入';
                    } else {
                        selectionBar.classList.remove('visible');
                    }
                    break;
                case 'message':
                    addMessage(msg.type, msg.text);
                    break;
                case 'done':
                    runBtn.disabled = false;
                    stopBtn.disabled = true;
                    taskId.textContent = '';
                    break;
                case 'error':
                    addMessage('error', msg.text);
                    runBtn.disabled = false;
                    stopBtn.disabled = true;
                    break;
            }
        });

        prompt.addEventListener('keydown', e => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                runTask();
            }
        });

        // Notify extension that webview is ready
        vscode.postMessage({ command: 'ready' });
    </script>
</body>
</html>`;
    }

    private async checkConnection() {
        const health = await this.client.health();
        this.postMessage({
            command: 'status',
            connected: health !== null && daemonHealthError(health) === null,
        });
    }

    private handleMessage(message: unknown): void {
        if (!isRecord(message)) return;
        const command = typeof message.command === 'string' ? message.command : undefined;
        switch (command) {
            case 'ready':
                void this.checkConnection();
                break;
            case 'runTask':
                if (typeof message.text === 'string' && message.text.trim().length > 0) {
                    void this.runTask(message.text);
                }
                break;
            case 'stopTask':
                void this.stopTask();
                break;
            default:
                // 未知 webview 消息安全忽略，不中断后续事件。
                break;
        }
    }

    private async runTask(text: string) {
        try {
            const health = await this.client.health();
            if (!health) {
                this.postMessage({ command: 'error', text: 'Daemon not running. Run "sacode serve" or restart VSCode.' });
                return;
            }
            const healthError = daemonHealthError(health);
            if (healthError) {
                this.postMessage({ command: 'error', text: healthError });
                return;
            }

            const response = await this.client.createTask(text);
            this.abortStream?.();
            const taskId = response.task_id;
            const generation = ++this.taskGeneration;
            this.currentTaskId = taskId;
            this.approvals.clear();
            this.postMessage({ command: 'taskId', id: taskId });

            this.abortStream = this.client.streamEvents(
                (event) => this.handleTaskEvent(event, taskId, generation),
                (err) => {
                    if (generation !== this.taskGeneration || this.currentTaskId !== taskId) return;
                    this.postMessage({ command: 'error', text: err.message });
                    this.finishTask(taskId, generation);
                },
                taskId,
                () => this.onStreamOpen(taskId, generation),
            );

            setTimeout(async () => {
                if (generation !== this.taskGeneration || this.currentTaskId !== taskId) return;
                try {
                    const result = await this.client.getTaskResult(taskId);
                    if (result.response) {
                        this.postMessage({ command: 'message', type: 'system', text: result.response });
                    }
                    this.finishTask(taskId, generation);
                } catch {
                    // SSE handles pending, failed and cancelled task states.
                }
            }, 30000);
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            this.postMessage({ command: 'error', text: message });
        }
    }
    /**
     * 类型化消费单个 SSE 事件。未知事件或形状不匹配一律安全忽略。
     */
    private handleTaskEvent(event: { event: string; data: unknown; task_id?: string }, taskId: string, generation: number): void {
        if (generation !== this.taskGeneration || this.currentTaskId !== taskId) return;
        const decoded = decodeSseEvent(event);

        if (decoded.approval) {
            this.handleApproval(decoded.approval, taskId);
            return;
        }

        if (decoded.toolCall) {
            const { name, input } = decoded.toolCall;
            const inputText = typeof input === 'string'
                ? input
                : JSON.stringify(input).slice(0, 200);
            this.postMessage({ command: 'message', type: 'tool', text: `[${name}] ${inputText}` });
            if (name === 'fs.edit' || name === 'fs.apply_patch') {
                const diffText = this.extractDiff(name, input);
                if (diffText) {
                    this.postMessage({ command: 'message', type: 'diff', text: diffText });
                }
            }
        }

        if (decoded.text) {
            this.postMessage({
                command: 'message',
                type: decoded.text.kind === 'thinking' ? 'thinking' : 'system',
                text: decoded.text.content,
            });
        }

        if (decoded.terminal) {
            const snapshot = decoded.snapshot;
            if (decoded.terminal.outcome === 'failed' && !snapshot) {
                const message = decoded.terminal.message ?? 'Task failed';
                this.postMessage({ command: 'error', text: String(message) });
            }
            if (snapshot) this.reportTerminal(snapshot);
            this.finishTask(taskId, generation);
            return;
        }

        if (decoded.snapshot) {
            const snapshot = decoded.snapshot;
            if (isTerminalState(snapshot.state)) {
                this.reportTerminal(snapshot);
                this.finishTask(taskId, generation);
            } else {
                this.postMessage({
                    command: 'message',
                    type: 'system',
                    text: `任务状态：${TASK_STATE_LABELS[snapshot.state]}`,
                });
            }
        }
    }

    /**
     * 流（重）连接成功后收敛状态：以 daemon 任务快照为真相源，
     * 补齐断线期间丢失的终态与待审批。
     */
    private async onStreamOpen(taskId: string, generation: number): Promise<void> {
        void this.reconcileTaskState(taskId, generation);
        await this.recoverPendingApprovals(taskId, generation);
    }

    /**
     * 断线重连后用任务真相源核对最终状态：
     * 快照显示终态而 SSE 未收到终态事件时，按快照收敛并展示一致结果。
     */
    private async reconcileTaskState(taskId: string, generation: number): Promise<void> {
        const snapshot = await this.confirmFinalState(taskId, generation);
        if (generation !== this.taskGeneration || this.currentTaskId !== taskId) return;
        if (!snapshot) return;
        this.postMessage({
            command: 'message',
            type: 'system',
            text: `已与服务端同步任务状态：${TASK_STATE_LABELS[snapshot.state]}`,
        });
        this.reportTerminal(snapshot);
        this.finishTask(taskId, generation);
    }

    /**
     * 轮询任务真相源直到返回终态快照；查询失败或仍未终态时返回 null。
     */
    private async confirmFinalState(
        taskId: string,
        generation: number,
        attempts = 5,
        intervalMs = 500,
    ): Promise<TaskSnapshot | null> {
        for (let index = 0; index < attempts; index += 1) {
            if (generation !== this.taskGeneration || this.currentTaskId !== taskId) return null;
            try {
                const status = await this.client.getTaskStatus(taskId);
                const snapshot = status.task;
                if (snapshot && isTerminalState(snapshot.state)) return snapshot;
            } catch {
                // 状态端点暂不可达时继续重试，由 SSE 保持现状。
            }
            if (index < attempts - 1) await sleep(intervalMs);
        }
        return null;
    }

    /**
     * 按终态快照渲染一致的最终结果：失败带分类与建议动作，不静默降级。
     */
    private reportTerminal(snapshot: TaskSnapshot): void {
        if (snapshot.state === 'failed') {
            const failure = snapshot.failure;
            const message = failure
                ? `${FAILURE_CATEGORY_LABELS[failure.category]}失败（${failure.code}）：${failure.safe_message}`
                : '任务失败';
            this.postMessage({ command: 'error', text: message });
            if (failure) {
                this.postMessage({
                    command: 'message',
                    type: 'system',
                    text: `建议操作：${SUGGESTED_ACTION_LABELS[failure.suggested_action]}`,
                });
            }
            return;
        }
        if (snapshot.state === 'cancelled') {
            this.postMessage({ command: 'message', type: 'system', text: '任务已取消' });
            return;
        }
        if (snapshot.result?.text) {
            this.postMessage({ command: 'message', type: 'system', text: snapshot.result.text });
        }
        this.postMessage({ command: 'message', type: 'system', text: '任务已完成' });
    }

    /**
     * P2-1: 审批恢复 — 从 daemon 拉取当前待审批列表并补弹。
     *
     * SSE 连接建立后调用一次，补偿 approval_requested 已发出但客户端不在线的窗口期。
     * deduplicator 确保已弹窗的审批不会重复提示。
     */
    private async recoverPendingApprovals(taskId: string, generation: number): Promise<void> {
        try {
            const pending = await this.client.listApprovals(taskId);
            for (const entry of pending) {
                if (generation !== this.taskGeneration || this.currentTaskId !== taskId) return;
                if (!this.approvals.accept(entry.approval_id)) continue;
                const request: ApprovalRequestView = {
                    taskId: entry.task_id,
                    approvalId: entry.approval_id,
                    toolName: entry.tool_name,
                    sideEffect: entry.side_effect_level,
                    args: entry.args,
                };
                const presentation = approvalQuickPickOptions(request).presentation;
                this.postMessage({
                    command: 'message',
                    type: 'tool',
                    text: `[审批恢复] ${presentation.summary}: ${presentation.detail}`,
                });
                void this.showApprovalQuickPick(request);
            }
        } catch {
            // 旧 daemon 不支持该端点或网络暂不可达时，保留现有 SSE 行为。
        }
    }

    /**
     * 审批事件与审批恢复共用同一入口：deduplicator 保证每个 approval_id 只弹一次。
     */
    private handleApproval(approval: ApprovalInfo, taskId: string): void {
        if (!approval.approvalId) {
            this.postMessage({ command: 'error', text: 'Approval event is missing approval_id' });
            return;
        }
        if (!this.approvals.accept(approval.approvalId)) return;
        const request: ApprovalRequestView = {
            taskId: approval.taskId || taskId,
            approvalId: approval.approvalId,
            toolName: approval.toolName,
            sideEffect: approval.sideEffect,
            args: approval.args,
        };
        const presentation = approvalQuickPickOptions(request).presentation;
        this.postMessage({
            command: 'message',
            type: 'tool',
            text: `[审批请求] ${presentation.summary}: ${presentation.detail}`,
        });
        void this.showApprovalQuickPick(request);
    }

    /**
     * P1-1: 审批 QuickPick — 用户选择后调 /task/:id/approve
     */
    private async showApprovalQuickPick(request: ApprovalRequestView): Promise<void> {
        if (this.diffReviewer.supports(request)) {
            let review: DiffReviewResult | undefined;
            try {
                review = await this.diffReviewer.review(request);
            } catch (err: unknown) {
                const message = err instanceof Error ? err.message : String(err);
                void vscode.window.showWarningMessage(`SaCode Diff 预览失败，已回退普通审批: ${message}`);
            }
            if (review) {
                try {
                    await resolveApprovalWithRetry(
                        this.client,
                        request,
                        review.approved,
                        review.reason,
                        review.argsOverride,
                    );
                } catch (err: unknown) {
                    const message = err instanceof Error ? err.message : String(err);
                    this.postMessage({ command: 'error', text: message });
                }
                return;
            }
        }

        const { presentation, items } = approvalQuickPickOptions(request);
        const selected = await vscode.window.showQuickPick(items, {
            placeHolder: presentation.detail,
            title: `SaCode 工具审批 · ${presentation.summary}`,
        });
        const approved = selected?.approved ?? false;
        const reason = selected ? (approved ? undefined : 'user_denied') : 'user_dismissed';
        try {
            await resolveApprovalWithRetry(this.client, request, approved, reason);
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            this.postMessage({ command: 'error', text: message });
        }
    }

    /**
     * P1-2: 从工具输入参数提取 diff 文本
     */
    private extractDiff(toolName: string, input: Record<string, unknown> | string): string | null {
        if (typeof input === 'string') return null;
        if (toolName === 'fs.edit') {
            const path = stringValue(input.path) ?? stringValue(input.file) ?? '';
            const oldStr = stringValue(input.old_string) ?? stringValue(input.old_str) ?? '';
            const newStr = stringValue(input.new_string) ?? stringValue(input.new_str) ?? '';
            if (oldStr || newStr) {
                return `--- ${path}\n+++ ${path}\n${oldStr.split('\n').map((l: string) => `-${l}`).join('\n')}\n${newStr.split('\n').map((l: string) => `+${l}`).join('\n')}`;
            }
        }
        if (toolName === 'fs.apply_patch') {
            const patch = stringValue(input.patch) ?? stringValue(input.diff) ?? stringValue(input.content);
            if (patch && patch.includes('@@')) {
                return patch;
            }
        }
        return null;
    }

    /**
     * 取消任务后以 daemon 真相源确认最终状态，避免在取消未生效时误报成功。
     */
    private async stopTask(): Promise<void> {
        const taskId = this.currentTaskId;
        const generation = this.taskGeneration;
        if (!taskId) {
            this.finishTask(null, generation);
            return;
        }

        let requested = false;
        try {
            await this.client.cancelTask(taskId);
            requested = true;
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            this.postMessage({ command: 'error', text: `取消请求失败: ${message}` });
        }

        const snapshot = await this.confirmFinalState(taskId, generation);
        if (generation !== this.taskGeneration || this.currentTaskId !== taskId) return;
        if (snapshot) {
            this.reportTerminal(snapshot);
        } else {
            this.postMessage({
                command: 'message',
                type: 'system',
                text: requested
                    ? '取消请求已提交，服务端尚未返回终态，请通过任务列表确认'
                    : '无法确认任务最终状态，请通过任务列表确认',
            });
        }
        this.finishTask(taskId, generation);
    }

    private finishTask(taskId: string | null, generation: number): void {
        if (generation !== this.taskGeneration || this.currentTaskId !== taskId) return;
        this.abortStream?.();
        this.abortStream = null;
        this.currentTaskId = null;
        this.approvals.clear();
        this.postMessage({ command: 'done' });
    }
    private postMessage(message: PanelMessage): void {
        this.panel?.webview.postMessage(message);
    }

    private dispose() {
        this.abortStream?.();
        this.diffReviewer.dispose();
        this.disposables.forEach((d) => d.dispose());
        this.disposables = [];
        this.panel = null;
        SacodePanel.instance = null;
    }
}

function stringValue(value: unknown): string | undefined {
    return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
