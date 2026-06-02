use sacode_runtime::{MemoryIndexEntry, MemoryStatus};

pub(super) fn collect_sections(content: &str) -> Vec<String> {
    content
        .lines()
        .filter(|line| line.starts_with('[') && line.ends_with(']'))
        .map(|line| line.to_string())
        .collect::<Vec<_>>()
}

pub(super) fn search_memory(content: &str, query: &str) -> String {
    let lowered_query = query.to_lowercase();
    let sections: Vec<&str> = content.split("\n[").collect();
    let mut matched = Vec::new();

    for (index, section) in sections.iter().enumerate() {
        let normalized = if index == 0 {
            (*section).to_string()
        } else {
            format!("[{}", section)
        };
        if normalized.to_lowercase().contains(&lowered_query) {
            matched.push(highlight_query(normalized.trim(), query));
        }
    }

    if matched.is_empty() {
        format!("未找到与 `{}` 相关的记忆。", query)
    } else {
        matched.join("\n\n")
    }
}

pub(super) fn render_index_match(entry: &MemoryIndexEntry, query: &str) -> String {
    format!(
        "[{}] {}\nKind: {}\nStatus: {}\nConfidence: {}\nContext: {}\nContent:\n{}",
        entry.scope.display_name(),
        entry.file_name,
        entry.kind.scope_label(),
        memory_status_label(entry.status),
        entry.confidence.map(|value| format!("{value:.2}")).unwrap_or_else(|| "n/a".to_string()),
        highlight_query(&entry.context, query),
        highlight_query(&entry.content, query)
    )
}

pub(super) fn render_list_entry(entry: &MemoryIndexEntry) -> String {
    format!(
        "- {} [{}] {} | {} | confidence={} | {}",
        entry.id,
        entry.kind.scope_label(),
        memory_status_label(entry.status),
        entry.file_name,
        entry.confidence.map(|value| format!("{value:.2}")).unwrap_or_else(|| "n/a".to_string()),
        entry.content
    )
}

pub(super) fn usage_text() -> String {
    "/memory [show|list [--type memory|preference|workflow|decision] [--scope user|project]|summary|path|search <关键词>|append <内容> [--type memory|preference|workflow|decision] [--global|-g]|promote <entry_id>|archive <entry_id>]".to_string()
}

fn memory_status_label(status: MemoryStatus) -> &'static str {
    match status {
        MemoryStatus::Active => "active",
        MemoryStatus::Archived => "archived",
    }
}

fn highlight_query(text: &str, query: &str) -> String {
    let lowered_text = text.to_lowercase();
    let lowered_query = query.to_lowercase();
    let mut start = 0;
    let mut output = String::new();

    while let Some(relative) = lowered_text[start..].find(&lowered_query) {
        let matched_start = start + relative;
        let matched_end = matched_start + lowered_query.len();
        output.push_str(&text[start..matched_start]);
        output.push_str("<<");
        output.push_str(&text[matched_start..matched_end]);
        output.push_str(">>");
        start = matched_end;
    }

    output.push_str(&text[start..]);
    output
}
