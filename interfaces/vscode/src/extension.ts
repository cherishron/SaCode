import * as vscode from 'vscode';
import { SacodePanel } from './SacodePanel';
import { SseClient } from './SseClient';
import { DaemonManager } from './DaemonManager';

export function activate(context: vscode.ExtensionContext) {
    console.log('SaCode extension activating...');

    const config = vscode.workspace.getConfiguration('sacode');
    const host = config.get<string>('daemonHost', '127.0.0.1');
    const port = config.get<number>('daemonPort', 8080);
    const client = new SseClient({ host, port });

    // P0-2: Daemon 进程自动管理
    const daemonManager = new DaemonManager(context, client);
    context.subscriptions.push(daemonManager);
    daemonManager.ensureRunning().then(() => {
        // daemon 就绪后通知面板
        SacodePanel.setDaemonReady(daemonManager.isRunning);
    });

    // P0-1: 选区上下文注入 — 监听编辑器选区变化
    context.subscriptions.push(
        vscode.window.onDidChangeTextEditorSelection((event) => {
            const selection = event.textEditor.selection;
            const text = event.textEditor.document.getText(selection);
            SacodePanel.setSelectionContext(text);
        })
    );

    const panelCommand = vscode.commands.registerCommand('sacode.runTask', () => {
        SacodePanel.createOrShow(context.extensionUri, client);
    });

    const configureCommand = vscode.commands.registerCommand('sacode.configure', () => {
        vscode.commands.executeCommand('workbench.action.openSettings', 'sacode');
    });

    const statusCommand = vscode.commands.registerCommand('sacode.status', () => {
        SacodePanel.createOrShow(context.extensionUri, client);
    });

    const stopCommand = vscode.commands.registerCommand('sacode.stop', () => {
        SacodePanel.stopCurrentTask();
    });

    const restartDaemonCommand = vscode.commands.registerCommand('sacode.restartDaemon', () => {
        daemonManager.ensureRunning();
    });

    // Register the sidebar view provider
    const provider = new SacodeViewProvider(context.extensionUri, client);
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(SacodeViewProvider.viewType, provider)
    );

    context.subscriptions.push(
        panelCommand,
        configureCommand,
        statusCommand,
        stopCommand,
        restartDaemonCommand
    );

    // Auto-open sidebar on first activation
    vscode.commands.executeCommand('workbench.view.extension.sacode');
}

export function deactivate() {
    console.log('SaCode extension deactivated');
}

class SacodeViewProvider implements vscode.WebviewViewProvider {
    static readonly viewType = 'sacode-panel';
    private view?: vscode.WebviewView;

    constructor(private extensionUri: vscode.Uri, private client: SseClient) {}

    resolveWebviewView(
        webviewView: vscode.WebviewView,
        _context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken
    ) {
        this.view = webviewView;
        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'media')],
        };
        webviewView.webview.html = this.getHtml();
        webviewView.webview.onDidReceiveMessage((msg) => {
            if (msg.command === 'runTask') {
                SacodePanel.createOrShow(this.extensionUri, this.client);
                SacodePanel.runWithPrompt(msg.text);
            }
        });
    }

    private getHtml(): string {
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>SaCode</title>
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; padding: 8px; color: var(--vscode-foreground); font-size: 13px; }
        textarea { width: 100%; padding: 6px; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border); border-radius: 2px; resize: vertical; min-height: 50px; box-sizing: border-box; }
        button { margin-top: 6px; padding: 4px 12px; background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; border-radius: 2px; cursor: pointer; }
        button:hover { background: var(--vscode-button-hoverBackground); }
        .info { margin-top: 12px; padding: 8px; background: var(--vscode-textBlockQuote-background); border-radius: 2px; font-size: 12px; color: var(--vscode-descriptionForeground); }
        .info code { background: var(--vscode-textPreformat-background); padding: 1px 4px; border-radius: 2px; }
    </style>
</head>
<body>
    <p style="font-weight:600;margin:0 0 8px 0">SaCode Agent</p>
    <textarea id="prompt" rows="3" placeholder="Describe the task..."></textarea>
    <button onclick="runTask()">Run Task</button>
    <div class="info">
        <p>Daemon is managed automatically. Use <code>Ctrl+Enter</code> to run.</p>
    </div>
    <script>
        const vscode = acquireVsCodeApi();
        function runTask() {
            const text = document.getElementById('prompt').value.trim();
            if (text) vscode.postMessage({ command: 'runTask', text });
        }
        document.getElementById('prompt').addEventListener('keydown', e => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) runTask();
        });
    </script>
</body>
</html>`;
    }
}
