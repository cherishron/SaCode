/**
 * Chat View Provider
 *
 * 提供聊天界面的 Webview 视图
 */

import * as vscode from "vscode";
import { SACODEClient, ChatMessage } from "../client";

export class ChatViewProvider implements vscode.WebviewViewProvider {
  private _view?: vscode.WebviewView;
  private _messages: ChatMessage[] = [];

  constructor(
    private readonly _extensionUri: vscode.Uri,
    private readonly _client: SACODEClient
  ) {}

  /**
   * 解析 Webview 视图
   */
  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ) {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this._extensionUri],
    };

    webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

    // 处理来自 Webview 的消息
    webviewView.webview.onDidReceiveMessage(
      async (message) => {
        switch (message.type) {
          case "sendMessage":
            await this.handleSendMessage(message.text);
            break;
          case "clearChat":
            this.clearChat();
            break;
          case "copyMessage":
            await vscode.env.clipboard.writeText(message.text);
            vscode.window.showInformationMessage("Copied to clipboard");
            break;
        }
      },
      undefined
    );
  }

  /**
   * 发送消息到聊天
   */
  public sendMessage(text: string): void {
    if (this._view) {
      this._view.webview.postMessage({ type: "sendMessage", text });
    }
  }

  /**
   * 处理发送消息
   */
  private async handleSendMessage(text: string): Promise<void> {
    if (!text.trim()) return;

    // 添加用户消息
    this._messages.push({ role: "user", content: text });
    this.updateMessages();

    try {
      // 调用 API
      const response = await this._client.sendChatMessage(
        this._messages,
        (chunk) => {
          // 流式输出更新
          this._view?.webview.postMessage({ type: "chunk", text: chunk });
        }
      );

      // 添加助手消息
      this._messages.push({ role: "assistant", content: response });
      this.updateMessages();
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      vscode.window.showErrorMessage(`Failed to send message: ${errorMessage}`);

      // 移除用户消息
      this._messages.pop();
      this.updateMessages();
    }
  }

  /**
   * 更新消息列表
   */
  private updateMessages(): void {
    if (this._view) {
      this._view.webview.postMessage({ type: "updateMessages", messages: this._messages });
    }
  }

  /**
   * 清空聊天
   */
  private clearChat(): void {
    this._messages = [];
    this.updateMessages();
  }

  /**
   * 生成 Webview HTML
   */
  private _getHtmlForWebview(webview: vscode.Webview): string {
    const nonce = this.getNonce();

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <title>SACODE Chat</title>
  <style>
    body {
      margin: 0;
      padding: 0;
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      color: var(--vscode-foreground);
      background-color: var(--vscode-editor-background);
    }

    .container {
      display: flex;
      flex-direction: column;
      height: 100vh;
    }

    .messages {
      flex: 1;
      overflow-y: auto;
      padding: 10px;
    }

    .message {
      margin-bottom: 15px;
      padding: 10px;
      border-radius: 8px;
      line-height: 1.5;
    }

    .message.user {
      background-color: var(--vscode-editor-inactiveSelectionBackground);
      margin-left: 20px;
    }

    .message.assistant {
      background-color: var(--vscode-editor-selectionBackground);
      margin-right: 20px;
    }

    .message pre {
      background-color: var(--vscode-textCodeBlock-background);
      padding: 10px;
      border-radius: 4px;
      overflow-x: auto;
    }

    .message code {
      font-family: var(--vscode-editor-font-family);
      font-size: var(--vscode-editor-font-size);
    }

    .input {
      padding: 10px;
      border-top: 1px solid var(--vscode-panel-border);
      display: flex;
      gap: 10px;
    }

    .input textarea {
      flex: 1;
      resize: none;
      padding: 8px;
      border: 1px solid var(--vscode-input-border);
      border-radius: 4px;
      background-color: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
    }

    .input textarea:focus {
      outline: none;
      border-color: var(--vscode-focusBorder);
    }

    .input button {
      padding: 8px 16px;
      background-color: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border: none;
      border-radius: 4px;
      cursor: pointer;
    }

    .input button:hover {
      background-color: var(--vscode-button-hoverBackground);
    }

    .input button:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    .actions {
      display: flex;
      justify-content: flex-end;
      gap: 5px;
      margin-top: 5px;
    }

    .actions button {
      padding: 2px 8px;
      font-size: 12px;
      background-color: transparent;
      color: var(--vscode-button-secondaryForeground);
      border: 1px solid var(--vscode-button-secondaryBackground);
      border-radius: 3px;
      cursor: pointer;
    }

    .actions button:hover {
      background-color: var(--vscode-button-secondaryHoverBackground);
    }

    .toolbar {
      padding: 5px 10px;
      border-bottom: 1px solid var(--vscode-panel-border);
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    .toolbar button {
      padding: 4px 8px;
      font-size: 12px;
      background-color: transparent;
      color: var(--vscode-button-secondaryForeground);
      border: 1px solid var(--vscode-button-secondaryBackground);
      border-radius: 3px;
      cursor: pointer;
    }

    .toolbar button:hover {
      background-color: var(--vscode-button-secondaryHoverBackground);
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="toolbar">
      <span style="font-weight: bold;">SACODE Chat</span>
      <button id="clearBtn">Clear</button>
    </div>
    <div class="messages" id="messages"></div>
    <div class="input">
      <textarea id="input" placeholder="Type your message..." rows="3"></textarea>
      <button id="sendBtn">Send</button>
    </div>
  </div>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const messagesDiv = document.getElementById('messages');
    const input = document.getElementById('input');
    const sendBtn = document.getElementById('sendBtn');
    const clearBtn = document.getElementById('clearBtn');

    let currentResponse = '';

    // 监听来自扩展的消息
    window.addEventListener('message', event => {
      const message = event.data;

      switch (message.type) {
        case 'updateMessages':
          renderMessages(message.messages);
          break;
        case 'chunk':
          updateResponse(message.text);
          break;
        case 'sendMessage':
          input.value = message.text;
          sendBtn.click();
          break;
      }
    });

    // 发送消息
    sendBtn.addEventListener('click', () => {
      const text = input.value.trim();
      if (!text) return;

      vscode.postMessage({ type: 'sendMessage', text });
      input.value = '';
      sendBtn.disabled = true;
    });

    // Enter 发送，Shift+Enter 换行
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendBtn.click();
      }
    });

    // 清空聊天
    clearBtn.addEventListener('click', () => {
      vscode.postMessage({ type: 'clearChat' });
    });

    // 渲染消息
    function renderMessages(messages) {
      messagesDiv.innerHTML = '';
      messages.forEach(msg => {
        const div = document.createElement('div');
        div.className = 'message ' + msg.role;
        div.innerHTML = renderMarkdown(msg.content);

        // 添加复制按钮
        const actions = document.createElement('div');
        actions.className = 'actions';
        const copyBtn = document.createElement('button');
        copyBtn.textContent = 'Copy';
        copyBtn.onclick = () => {
          vscode.postMessage({ type: 'copyMessage', text: msg.content });
        };
        actions.appendChild(copyBtn);
        div.appendChild(actions);

        messagesDiv.appendChild(div);
      });

      messagesDiv.scrollTop = messagesDiv.scrollHeight;
    }

    // 更新响应
    function updateResponse(chunk) {
      currentResponse += chunk;
      const lastMessage = messagesDiv.lastElementChild;
      if (lastMessage && lastMessage.classList.contains('assistant')) {
        lastMessage.innerHTML = renderMarkdown(currentResponse);
        messagesDiv.scrollTop = messagesDiv.scrollHeight;
      }
    }

    // 简单的 Markdown 渲染
    function renderMarkdown(text) {
      // 代码块
      text = text.replace(/\`\`\`(\w*)\n([\s\S]*?)\`\`\`/g, '<pre><code class="language-$1">$2</code></pre>');
      // 行内代码
      text = text.replace(/\`([^`]+)\`/g, '<code>$1</code>');
      // 粗体
      text = text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
      // 斜体
      text = text.replace(/\*([^*]+)\*/g, '<em>$1</em>');
      // 换行
      text = text.replace(/\n/g, '<br>');
      return text;
    }

    // 初始化
    vscode.postMessage({ type: 'ready' });
  </script>
</body>
</html>`;
  }

  /**
   * 获取随机 nonce
   */
  private getNonce(): string {
    let text = "";
    const possible =
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    for (let i = 0; i < 32; i++) {
      text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
  }
}
