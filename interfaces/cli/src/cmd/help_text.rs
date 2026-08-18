pub(super) const HELP_LINES: &[&str] = &[
    "SaCode",
    "",
    "Usage:",
    "  sacode \"<task>\" [--mode plan|build|auto] [--max-iterations N] [--json] [--prompt|--approve|--deny]",
    "  sacode orchestrator \"<task>\"",
    "  sacode profile [ls|use <name>|show]",
    "  sacode plugin [list]",
    "  sacode doctor",
    "  sacode diff [--cached]",
    "  sacode hooks",
    "  sacode ide [status|vscode|cursor|jetbrains|config show|path|set acp|lsp --host HOST --port PORT]",
    "  sacode config [show|path|user ...|project ...|set <key> <value>|clear <key>]",
    "  sacode keybindings",
    "  sacode outstyle [show|concise|explain|teach|clear|path|project ...]",
    "  sacode prompt [show [task...]|doctor|edit project]",
    "  sacode wiki",
    "  sacode vim [show|on|off|project show|on|off]",
    "  sacode skill [search|install|list|show|update|remove|run]",
    "  sacode sandbox [show [plan|build|auto] [--json]|diff [plan|build|yolo] [--json]|doctor [plan|build|yolo] [--json]|init|path|set <mode> <key> <value>|clear <mode> <key>]",
    "  sacode mcp [search|install|list|show|enable|disable|remove|inspect|tools|call]",
    "  sacode memory [show|list|search <query>|path|summary|append <content> [--type memory|preference|workflow|decision] [--global|-g]|promote <entry_id>|approve <entry_id>|reject <entry_id>|archive <entry_id>|migrate]",
    "  sacode insight",
    "  sacode acp [serve|status] [--host HOST] [--port PORT]",
    "  sacode lsp [serve|status] [--tcp] [--host HOST] [--port PORT]",
    "  sacode serve [--acp] [--lsp]",
    "  sacode init       # 轻量初始化，识别技术栈和基础项目信息",
    "  sacode init-deep  # 深度初始化，生成严格协作配置和工作流",
    "  sacode mistakes [list|show <index>|learn <index>]",
    "  sacode status",
    "  sacode update [--check|--force|--rollback]",
    "  sacode repl",
    "  sacode tui",
    "  sacode --help",
    "  sacode --version",
];

pub(super) fn print_help() {
    for line in HELP_LINES {
        println!("{}", line);
    }
}
