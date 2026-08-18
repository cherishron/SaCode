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

    constructor(private extensionUri: vscode.Uri) {
        const config = vscode.workspace.getConfiguration('sacode');
        const host = config.get<string>('daemonHost', '127.0.0.1');
        const port = config.get<number>('daemonPort', 8080);
        this.client = new SseClient({ host, port });
    }

    static createOrShow(extensionUri: vscode.Uri) {
        if (SacodePanel.instance?.panel) {
            SacodePanel.instance.panel.reveal(vscode.ViewColumn.Beside);
            return;
        }
        const instance = new SacodePanel(extensionUri);
        instance.createPanel();
        SacodePanel.instance = instance;
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
        .msg .label { font-size: 10px; color: var(--muted); margin-bottom: 2px; text-transform: uppercase; }
        .msg pre { white-space: pre-wrap; word-break: break-word; margin: 0; }
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

        function addMessage(type, text) {
            const div = document.createElement('div');
            div.className = 'msg ' + type;
            const label = document.createElement('div');
            label.className = 'label';
            label.textContent = type;
            div.appendChild(label);
            const pre = document.createElement('pre');
            pre.textContent = text;
            div.appendChild(pre);
            messages.appendChild(div);
            messages.scrollTop = messages.scrollHeight;
        }

        function runTask() {
            const text = prompt.value.trim();
            if (!text) return;
            addMessage('system', text);
            runBtn.disabled = true;
            stopBtn.disabled = false;
            prompt.value = '';
            vscode.postMessage({ command: 'runTask', text });
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
                this.postMessage({ command: 'error', text: 'Daemon not running. Execute "sacode serve" first.' });
                return;
            }

            const response = await this.client.createTask(text);
            this.currentTaskId = response.task_id;
            this.postMessage({ command: 'taskId', id: response.task_id });

            this.abortStream = this.client.streamEvents(
                (event) => {
                    const data = event.data;
                    if (data.kind === 'tool' || data.kind === 'tool_call') {
                        this.postMessage({
                            command: 'message',
                            type: 'tool',
                            text: data.tool_name
                                ? `[${data.tool_name}] ${data.arguments || ''}`
                                : JSON.stringify(data, null, 2),
                        });
                    }
                    if (data.kind === 'message' || data.kind === 'text') {
                        this.postMessage({
                            command: 'message',
                            type: 'system',
                            text: data.content || data.text || JSON.stringify(data),
                        });
                    }
                    if (data.event === 'task_completed' || data.status === 'completed') {
                        this.postMessage({ command: 'done' });
                        this.currentTaskId = null;
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