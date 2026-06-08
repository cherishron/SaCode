use sacode_runtime::ToolRegistry;

use super::App;

impl App {
    pub(super) fn tools_command(&mut self) {
        let registry = ToolRegistry::builtin();
        let names = registry.names();

        let tools_info: Vec<String> = names
            .iter()
            .map(|name| match registry.get(name) {
                Some(spec) => format!("  {} - {}", name, spec.description),
                None => format!("  {}", name),
            })
            .collect();

        let categories = [
            ("文件操作", vec!["fs.read", "fs.write", "fs.search"]),
            ("Shell", vec!["shell.exec"]),
            ("Git", vec!["git.diff"]),
            ("网络", vec!["web.fetch", "web.search"]),
        ];

        let mut categorized = String::new();
        for (category, prefix_list) in categories {
            let category_tools: Vec<String> = tools_info
                .iter()
                .filter(|tool| {
                    prefix_list
                        .iter()
                        .any(|prefix| tool.starts_with(&format!("  {}", prefix)))
                })
                .cloned()
                .collect();
            if !category_tools.is_empty() {
                categorized.push_str(&format!("\n{}:\n{}\n", category, category_tools.join("\n")));
            }
        }

        let other_tools: Vec<String> = tools_info
            .iter()
            .filter(|tool| !categorized.contains(tool.as_str()))
            .cloned()
            .collect();

        if !other_tools.is_empty() {
            categorized.push_str(&format!("\n其他:\n{}\n", other_tools.join("\n")));
        }

        self.push_system_message(&format!(
            "可用工具 ({} 个):\n{}\n\n内置工具由 runtime 自动注册。\nSkills 和 MCP 工具根据配置动态加载。",
            names.len(),
            categorized.trim()
        ));
    }
}
