/**
 * SaClaw VSCode Extension
 *
 * 提供 AI 辅助开发功能的 VSCode 集成
 */

import * as vscode from "vscode";
import { SaClawClient } from "./client";
import { ChatViewProvider } from "./views/chatView";
import { SkillsViewProvider } from "./views/skillsView";

let client: SaClawClient | undefined;
let chatProvider: ChatViewProvider | undefined;
let skillsProvider: SkillsViewProvider | undefined;

/**
 * 扩展激活
 */
export async function activate(context: vscode.ExtensionContext): Promise<void> {
  console.log("SaClaw extension is activating...");

  // 初始化客户端
  client = new SaClawClient();

  // 注册视图提供者
  chatProvider = new ChatViewProvider(context.extensionUri, client);
  skillsProvider = new SkillsViewProvider(context.extensionUri, client);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      "saclaw.chatView",
      chatProvider
    ),
    vscode.window.registerTreeDataProvider(
      "saclaw.skillsView",
      skillsProvider
    )
  );

  // 注册命令
  registerCommands(context);

  // 自动连接
  const config = vscode.workspace.getConfiguration("saclaw");
  if (config.get<boolean>("autoConnect")) {
    await connectToServer();
  }

  console.log("SaClaw extension activated");
}

/**
 * 注册命令
 */
function registerCommands(context: vscode.ExtensionContext): void {
  // 打开聊天
  context.subscriptions.push(
    vscode.commands.registerCommand("saclaw.chat", async () => {
      await vscode.commands.executeCommand("workbench.view.extension.saclaw");
    })
  );

  // 解释代码
  context.subscriptions.push(
    vscode.commands.registerCommand("saclaw.explain", async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showWarningMessage("No active editor");
        return;
      }

      const selection = editor.selection;
      const code = editor.document.getText(selection);

      if (!code) {
        vscode.window.showWarningMessage("No code selected");
        return;
      }

      await sendToChat(`请解释以下代码:\n\`\`\`\n${code}\n\`\`\``);
    })
  );

  // 重构代码
  context.subscriptions.push(
    vscode.commands.registerCommand("saclaw.refactor", async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) return;

      const selection = editor.selection;
      const code = editor.document.getText(selection);

      if (!code) return;

      await sendToChat(`请重构以下代码，提高可读性和性能:\n\`\`\`\n${code}\n\`\`\``);
    })
  );

  // 生成测试
  context.subscriptions.push(
    vscode.commands.registerCommand("saclaw.generateTests", async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) return;

      const selection = editor.selection;
      const code = editor.document.getText(selection);

      if (!code) return;

      const language = editor.document.languageId;
      await sendToChat(`请为以下 ${language} 代码生成单元测试:\n\`\`\`${language}\n${code}\n\`\`\``);
    })
  );

  // 生成文档
  context.subscriptions.push(
    vscode.commands.registerCommand("saclaw.generateDocs", async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) return;

      const selection = editor.selection;
      const code = editor.document.getText(selection);

      if (!code) return;

      const language = editor.document.languageId;
      await sendToChat(`请为以下 ${language} 代码生成文档注释:\n\`\`\`${language}\n${code}\n\`\`\``);
    })
  );

  // 修复代码
  context.subscriptions.push(
    vscode.commands.registerCommand("saclaw.fixCode", async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) return;

      const document = editor.document;
      const code = document.getText();

      // 获取诊断信息
      const diagnostics = vscode.languages.getDiagnostics(document.uri);
      const issues = diagnostics.map((d) => ({
        line: d.range.start.line + 1,
        message: d.message,
        severity: vscode.DiagnosticSeverity[d.severity],
      }));

      if (issues.length === 0) {
        vscode.window.showInformationMessage("No issues found");
        return;
      }

      await sendToChat(
        `请修复以下代码中的问题:\n\`\`\`\n${code}\n\`\`\`\n\n问题列表:\n${JSON.stringify(issues, null, 2)}`
      );
    })
  );
}

/**
 * 连接到服务器
 */
async function connectToServer(): Promise<void> {
  if (!client) return;

  const config = vscode.workspace.getConfiguration("saclaw");
  const apiUrl = config.get<string>("apiUrl") ?? "http://localhost:3000";

  try {
    await client.connect(apiUrl);
    vscode.window.setStatusBarMessage("$(check) SaClaw connected", 3000);
  } catch (error) {
    vscode.window.setStatusBarMessage("$(x) SaClaw connection failed", 3000);
    console.error("Failed to connect to SaClaw server:", error);
  }
}

/**
 * 发送消息到聊天视图
 */
async function sendToChat(message: string): Promise<void> {
  await vscode.commands.executeCommand("workbench.view.extension.saclaw");
  
  if (chatProvider) {
    chatProvider.sendMessage(message);
  }
}

/**
 * 扩展停用
 */
export function deactivate(): void {
  if (client) {
    client.disconnect();
  }
  console.log("SaClaw extension deactivated");
}
