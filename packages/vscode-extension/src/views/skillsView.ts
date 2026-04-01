/**
 * Skills View Provider
 *
 * 提供技能列表的树形视图
 */

import * as vscode from "vscode";
import { SACODEClient, Skill } from "../client";

export class SkillsViewProvider implements vscode.TreeDataProvider<SkillItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<SkillItem | undefined | null | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private _skills: Skill[] = [];

  constructor(
    private readonly _extensionUri: vscode.Uri,
    private readonly _client: SACODEClient
  ) {
    this.loadSkills();
  }

  /**
   * 刷新
   */
  refresh(): void {
    this.loadSkills();
    this._onDidChangeTreeData.fire();
  }

  /**
   * 加载技能列表
   */
  private async loadSkills(): Promise<void> {
    try {
      this._skills = await this._client.getSkills();
    } catch (error) {
      console.error("Failed to load skills:", error);
      this._skills = [];
    }
  }

  /**
   * 获取树节点
   */
  getTreeItem(element: SkillItem): vscode.TreeItem {
    return element;
  }

  /**
   * 获取子节点
   */
  async getChildren(element?: SkillItem): Promise<SkillItem[]> {
    if (!element) {
      // 根节点：按类别分组
      const categories = new Map<string, Skill[]>();
      this._skills.forEach(skill => {
        const category = skill.category || "Uncategorized";
        if (!categories.has(category)) {
          categories.set(category, []);
        }
        categories.get(category)!.push(skill);
      });

      const items: SkillItem[] = [];
      categories.forEach((skills, category) => {
        if (skills.length === 1) {
          // 只有一个技能的类别，直接显示技能
          items.push(new SkillItem(skills[0], vscode.TreeItemCollapsibleState.None));
        } else {
          // 多个技能的类别，显示类别节点
          items.push(new SkillCategoryItem(category, skills));
        }
      });

      return items;
    } else if (element instanceof SkillCategoryItem) {
      // 类别节点：返回技能列表
      return element.skills.map(skill => new SkillItem(skill, vscode.TreeItemCollapsibleState.None));
    }

    return [];
  }

  /**
   * 执行技能
   */
  async executeSkill(skill: Skill): Promise<void> {
    try {
      const result = await this._client.executeSkill(skill.id, {});

      // 显示结果
      const panel = vscode.window.createWebviewPanel(
        "skillResult",
        `Skill: ${skill.name}`,
        vscode.ViewColumn.One,
        { enableScripts: true }
      );

      panel.webview.html = this._getResultHtml(skill, result);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      vscode.window.showErrorMessage(`Failed to execute skill: ${errorMessage}`);
    }
  }

  /**
   * 生成结果页面 HTML
   */
  private _getResultHtml(skill: Skill, result: any): string {
    const json = JSON.stringify(result, null, 2);
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Skill Result: ${skill.name}</title>
  <style>
    body {
      margin: 0;
      padding: 20px;
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      color: var(--vscode-foreground);
      background-color: var(--vscode-editor-background);
    }

    h1 {
      color: var(--vscode-foreground);
    }

    .description {
      color: var(--vscode-descriptionForeground);
      margin-bottom: 20px;
    }

    pre {
      background-color: var(--vscode-textCodeBlock-background);
      padding: 15px;
      border-radius: 4px;
      overflow-x: auto;
      border: 1px solid var(--vscode-panel-border);
    }

    code {
      font-family: var(--vscode-editor-font-family);
      font-size: var(--vscode-editor-font-size);
    }
  </style>
</head>
<body>
  <h1>${skill.name}</h1>
  <p class="description">${skill.description}</p>
  <h2>Result</h2>
  <pre><code>${this._escapeHtml(json)}</code></pre>
</body>
</html>`;
  }

  /**
   * 转义 HTML
   */
  private _escapeHtml(text: string): string {
    const map: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;",
    };
    return text.replace(/[&<>"']/g, (m) => map[m]);
  }
}

/**
 * 技能项
 */
class SkillItem extends vscode.TreeItem {
  constructor(
    public readonly skill: Skill,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState
  ) {
    super(skill.name, collapsibleState);

    this.tooltip = skill.description;
    this.description = skill.category;
    this.contextValue = "skill";

    this.iconPath = new vscode.ThemeIcon("lightbulb");
  }
}

/**
 * 技能类别项
 */
class SkillCategoryItem extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly skills: Skill[]
  ) {
    super(label, vscode.TreeItemCollapsibleState.Collapsed);

    this.tooltip = `${skills.length} skills`;
    this.description = `${skills.length}`;
    this.contextValue = "category";

    this.iconPath = new vscode.ThemeIcon("folder");
  }
}