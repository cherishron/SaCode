pub(super) fn fuzzy_match(query: &str, target: &str) -> bool {
    if query.is_empty() {
        return true;
    }
    let query_chars: Vec<char> = query.chars().collect();
    let target_chars: Vec<char> = target.chars().collect();

    let mut query_index = 0;
    let mut target_index = 0;
    while query_index < query_chars.len() && target_index < target_chars.len() {
        if query_chars[query_index] == target_chars[target_index] {
            query_index += 1;
        }
        target_index += 1;
    }

    query_index == query_chars.len()
}

pub(super) fn format_duration_ms(ms: u64) -> String {
    if ms >= 60_000 {
        let minutes = ms / 60_000;
        let seconds = (ms % 60_000) / 1_000;
        format!("{}m {}s", minutes, seconds)
    } else if ms >= 1_000 {
        format!("{:.1}s", ms as f64 / 1_000.0)
    } else {
        format!("{}ms", ms)
    }
}
