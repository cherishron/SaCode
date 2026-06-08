use anyhow::Result;
use sacode_runtime::{MemoryIndexEntry, MemoryKind, MemoryScope};

#[derive(Debug, Clone, Copy, Default)]
pub(super) struct ListFilters {
    kind: Option<MemoryKind>,
    scope: Option<MemoryScope>,
}

pub(super) fn parse_list_filters(args: &[String]) -> Result<ListFilters> {
    let mut filters = ListFilters::default();
    let mut iter = args.iter().skip(1);

    while let Some(arg) = iter.next() {
        match arg.as_str() {
            "--type" | "-t" => {
                let Some(value) = iter.next() else {
                    anyhow::bail!("用法: /memory list [--type memory|preference|workflow|decision] [--scope user|project]");
                };
                let Some(kind) = MemoryKind::from_flag(value) else {
                    anyhow::bail!("支持的类型: memory, preference, workflow, decision");
                };
                filters.kind = Some(kind);
            }
            "--scope" | "-s" => {
                let Some(value) = iter.next() else {
                    anyhow::bail!("用法: /memory list [--type memory|preference|workflow|decision] [--scope user|project]");
                };
                filters.scope = Some(match value.as_str() {
                    "user" => MemoryScope::User,
                    "project" => MemoryScope::Project,
                    _ => anyhow::bail!("支持的范围: user, project"),
                });
            }
            value => anyhow::bail!("不支持的参数: {}", value),
        }
    }

    Ok(filters)
}

pub(super) fn filter_list_entries(
    entries: Vec<MemoryIndexEntry>,
    filters: &ListFilters,
) -> Vec<MemoryIndexEntry> {
    entries
        .into_iter()
        .filter(|entry| filters.kind.is_none_or(|kind| entry.kind == kind))
        .filter(|entry| filters.scope.is_none_or(|scope| entry.scope == scope))
        .collect()
}
