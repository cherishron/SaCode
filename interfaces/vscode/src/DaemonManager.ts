import * as vscode from 'vscode';
import * as cp from 'child_process';
import { daemonHealthError, SseClient } from './SseClient';

/**
 * Daemon 进程自动管理器
 *
 * 状态机: stopped → starting → running → error → stopped
 *
 * 扩展激活时调用 ensureRunning()，自动检测/启动 sacode daemon 进程。
 * 状态栏显示 daemon 状态，退出 VSCode 时自动清理子进程。
 */
export class DaemonManager implements vscode.Disposable {
    private process: cp.ChildProcess | null = null;
    private statusBarItem: vscode.StatusBarItem;
    private client: SseClient;
    private state: 'stopped' | 'starting' | 'running' | 'error' = 'stopped';
    private disposables: vscode.Disposable[] = [];

    constructor(context: vscode.ExtensionContext, client: SseClient) {
        this.client = client;
        this.statusBarItem = vscode.window.createStatusBarItem(
            vscode.StatusBarAlignment.Right,
            100
        );
        this.statusBarItem.command = 'sacode.status';
        this.disposables.push(this.statusBarItem);
    }

    /**
     * 确保 daemon 正在运行：先 healthCheck，失败则 spawn
     */
    async ensureRunning(): Promise<void> {
        const health = await this.client.health();
        if (health) {
            const error = daemonHealthError(health);
            if (!error) {
                this.setState('running');
                return;
            }
            this.setState('error');
            vscode.window.showErrorMessage(error);
            return;
        }

        await this.spawnDaemon();
    }

    /**
     * 获取 daemon 可执行文件路径
     */
    private getDaemonPath(): string {
        const config = vscode.workspace.getConfiguration('sacode');
        return config.get<string>('binaryPath', 'sacode');
    }

    /**
     * 启动 daemon 子进程并轮询健康检查
     */
    private async spawnDaemon(): Promise<void> {
        this.setState('starting');

        const config = vscode.workspace.getConfiguration('sacode');
        const port = config.get<number>('daemonPort', 8080);
        const host = config.get<string>('daemonHost', '127.0.0.1');
        const binaryPath = this.getDaemonPath();

        try {
            this.process = cp.spawn(binaryPath, ['serve', `--port=${port}`, `--host=${host}`], {
                detached: false,
                stdio: ['ignore', 'pipe', 'pipe'],
            });

            this.process.on('exit', (code) => {
                if (this.state !== 'stopped') {
                    this.setState('error');
                    vscode.window.showWarningMessage(
                        `SaCode daemon exited with code ${code}`
                    );
                }
            });

            this.process.on('error', (err) => {
                this.setState('error');
                vscode.window.showErrorMessage(
                    `Failed to start SaCode daemon: ${err.message}`
                );
            });

            // 轮询健康检查（最多 10 次，每次 2 秒）
            const healthy = await this.pollHealth(10, 2000);
            if (healthy) {
                this.setState('running');
            } else {
                this.setState('error');
                vscode.window.showErrorMessage(
                    'SaCode daemon started but health check failed. Check sacode serve output.'
                );
            }
        } catch (err: any) {
            if (this.process) {
                this.process.removeAllListeners('exit');
                this.process.kill();
                this.process = null;
            }
            this.setState('error');
            vscode.window.showErrorMessage(
                err instanceof Error ? err.message : `Failed to start SaCode daemon: ${String(err)}`
            );
        }
    }

    /**
     * 轮询健康检查
     */
    private async pollHealth(maxAttempts: number, intervalMs: number): Promise<boolean> {
        for (let i = 0; i < maxAttempts; i++) {
            await this.sleep(intervalMs);
            const health = await this.client.health();
            if (!health) continue;
            const error = daemonHealthError(health);
            if (!error) return true;
            throw new Error(error);
        }
        return false;
    }

    private setState(state: 'stopped' | 'starting' | 'running' | 'error'): void {
        this.state = state;
        this.updateStatusBar();
    }

    private updateStatusBar(): void {
        switch (this.state) {
            case 'running':
                this.statusBarItem.text = '$(check) SaCode';
                this.statusBarItem.tooltip = 'SaCode daemon: running';
                this.statusBarItem.show();
                break;
            case 'starting':
                this.statusBarItem.text = '$(sync~spin) SaCode';
                this.statusBarItem.tooltip = 'SaCode daemon: starting...';
                this.statusBarItem.show();
                break;
            case 'error':
                this.statusBarItem.text = '$(error) SaCode';
                this.statusBarItem.tooltip = 'SaCode daemon: error';
                this.statusBarItem.show();
                break;
            case 'stopped':
                this.statusBarItem.hide();
                break;
        }
    }

    get isRunning(): boolean {
        return this.state === 'running';
    }

    private sleep(ms: number): Promise<void> {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    dispose(): void {
        if (this.process) {
            this.state = 'stopped'; // 防止 exit 事件触发 error 状态
            this.process.kill();
            this.process = null;
        }
        this.disposables.forEach((d) => d.dispose());
        this.disposables = [];
    }
}
