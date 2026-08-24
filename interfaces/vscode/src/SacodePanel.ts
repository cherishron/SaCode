import * as vscode from 'vscode';
import { SseClient } from './SseClient';

export class SacodePanel {
    public static readonly viewType = 'sacode-panel';
    private static instance: SacodePanel | null = null;

    private panel: vscode.WebviewPanel | null = null;
    private client: SseClient;
    private currentTaskId: string | null = null;
    private abortStream: (() => void) | null = null;
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
        const connected = await this.client.healthCheck();
        this.postMessage({ command: 'status', connected });
    }

    private async handleMessage(msg: any) {
        switch (msg.command) {
            case 'ready':
                this.checkConnection();
                break;
            case 'runTask':
                await this.runTask(msg.text);
                break;
            case 'stopTask':
                await this.stopTask();
                break;
        }
    }

    private async runTask(text: string) {
        try {
            const connected = await this.client.healthCheck();
            if (!connected) {
                this.postMessage({ command: 'error', text: 'Daemon not running. Run "sacode serve" or restart VSCode.' });
                return;
            }

            const response = await this.client.createTask(text);
            this.currentTaskId = response.task_id;
            this.postMessage({ command: 'taskId', id: response.task_id });

            this.abortStream = this.client.streamEvents(
                (event) => {
                    const data = event.data;
                    // 修复 SSE 事件解析：使用 event_type 字段（与 daemon normalize_stream_event 一致）
                    const eventType = data.event_type || data.event || data.kind;
                    const payload = data.payload || data;

                    // 工具调用事件
                    if (eventType === 'tool_call_started' || eventType === 'tool' || eventType === 'tool_call') {
                        const toolName = data.name || payload.name || payload.tool || 'tool';
                        const toolInput = data.input || payload.input || {};
                        const inputStr = typeof toolInput === 'string'
                            ? toolInput
                            : JSON.stringify(toolInput).slice(0, 200);
                        this.postMessage({
                            command: 'message',
                            type: 'tool',
                            text: `[${toolName}] ${inputStr}`,
                        });

                        // P1-2: 检测 diff 工具调用
                        if (toolName === 'fs.edit' || toolName === 'fs.apply_patch') {
                            const diffText = this.extractDiff(toolName, toolInput);
                            if (diffText) {
                                this.postMessage({
                                    command: 'message',
                                    type: 'diff',
                                    text: diffText,
                                });
                            }
                        }
                    }
                    // 文本/消息事件
                    else if (eventType === 'message' || eventType === 'text' || eventType === 'thinking') {
                        const content = data.content || data.text || payload.content || payload.text;
                        if (content) {
                            this.postMessage({
                                command: 'message',
                                type: eventType === 'thinking' ? 'thinking' : 'system',
                                text: content,
                            });
                        }
                    }
                    // 任务完成
                    if (eventType === 'task_completed' || data.status === 'completed' || eventType === 'done') {
                        this.postMessage({ command: 'done' });
                        this.currentTaskId = null;
                    }
                    // P1-1: 审批请求事件 — 弹出 QuickPick 审批面板
                    if (eventType === 'approval_requested' && this.currentTaskId) {
                        const toolName = data.tool_name || payload.tool_name || 'unknown';
                        const approvalId = data.approval_id || payload.approval_id || '';
                        const args = data.args || payload.args || {};
                        const argsStr = typeof args === 'string'
                            ? args.slice(0, 200)
                            : JSON.stringify(args).slice(0, 200);
                        this.postMessage({
                            command: 'message',
                            type: 'tool',
                            text: `[审批请求] ${toolName}: ${argsStr}`,
                        });
                        // 在扩展侧弹出 QuickPick
                        this.showApprovalQuickPick(this.currentTaskId, approvalId, toolName, argsStr);
                    }
                },
                (err) => {
                    this.postMessage({ command: 'error', text: err.message });
                    this.currentTaskId = null;
                }
            );

            // Also poll for result after a delay
            setTimeout(async () => {
                if (!this.currentTaskId) return;
                try {
                    const result = await this.client.getTaskResult(this.currentTaskId);
                    if (result.response) {
                        this.postMessage({ command: 'message', type: 'system', text: result.response });
                    }
                    this.postMessage({ command: 'done' });
                } catch {
                    // Stream already handled it
                }
            }, 30000);
        } catch (err: any) {
            this.postMessage({ command: 'error', text: err.message });
        }
    }

    /**
     * P1-1: 审批 QuickPick — 用户选择后调 /task/:id/approve
     */
    private async showApprovalQuickPick(
        taskId: string,
        approvalId: string,
        toolName: string,
        argsStr: string,
    ): Promise<void> {
        const items = [
            {
                label: '$(check) 允许执行',
                description: '批准该工具调用',
                approved: true,
            },
            {
                label: '$(x) 拒绝',
                description: '取消这次修改操作',
                approved: false,
            },
        ];
        const selected = await vscode.window.showQuickPick(items, {
            placeHolder: `审批: ${toolName} — ${argsStr.slice(0, 80)}`,
            title: 'SaCode 工具审批',
        });
        if (selected) {
            await this.client.resolveApproval(taskId, approvalId, selected.approved);
        }
    }

    /**
     * P1-2: 从工具输入参数提取 diff 文本
     */
    private extractDiff(toolName: string, input: any): string | null {
        if (toolName === 'fs.edit') {
            const path = input.path || input.file || '';
            const oldStr = input.old_string || input.old_str || '';
            const newStr = input.new_string || input.new_str || '';
            if (oldStr || newStr) {
                return `--- ${path}\n+++ ${path}\n${oldStr.split('\n').map((l: string) => `-${l}`).join('\n')}\n${newStr.split('\n').map((l: string) => `+${l}`).join('\n')}`;
            }
        }
        if (toolName === 'fs.apply_patch') {
            const patch = input.patch || input.diff || input.content;
            if (typeof patch === 'string' && patch.includes('@@')) {
                return patch;
            }
        }
        return null;
    }

    private async stopTask() {
        if (this.currentTaskId) {
            await this.client.cancelTask(this.currentTaskId);
            this.currentTaskId = null;
        }
        this.abortStream?.();
        this.abortStream = null;
        this.postMessage({ command: 'done' });
    }

    private postMessage(msg: any) {
        this.panel?.webview.postMessage(msg);
    }

    private dispose() {
        this.abortStream?.();
        this.disposables.forEach((d) => d.dispose());
        this.disposables = [];
        this.panel = null;
        SacodePanel.instance = null;
    }
}
