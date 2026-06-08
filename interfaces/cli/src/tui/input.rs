use unicode_width::UnicodeWidthChar;

use crate::tui::InputMode;

pub fn layout_input_lines(text: &str, width: usize) -> (Vec<String>, usize, usize) {
    let width = width.max(1);
    let mut lines = vec![String::new()];
    let mut current_width = 0usize;
    let mut cursor_line = 0usize;
    let mut cursor_col = 0usize;

    for ch in text.chars() {
        if ch == '\n' {
            cursor_line = lines.len();
            cursor_col = 0;
            lines.push(String::new());
            current_width = 0;
            continue;
        }

        let ch_width = UnicodeWidthChar::width(ch).unwrap_or(1).max(1);
        if current_width + ch_width > width {
            lines.push(String::new());
            current_width = 0;
        }

        let line = lines.last_mut().expect("input lines should exist");
        line.push(ch);
        current_width += ch_width;
        cursor_line = lines.len().saturating_sub(1);
        cursor_col = current_width;
    }

    (lines, cursor_line, cursor_col)
}

pub fn clamp_cursor_col(cursor_col: usize, width: usize) -> usize {
    cursor_col.min(width.max(1).saturating_sub(1))
}

pub fn is_editable_input_mode(input_mode: InputMode) -> bool {
    matches!(
        input_mode,
        InputMode::Chat
            | InputMode::ProviderRename
            | InputMode::LoginBaseUrl
            | InputMode::LoginApiKey
            | InputMode::ConnectApiKey
            | InputMode::TaskInput
            | InputMode::ConfigNumberInput
            | InputMode::PendingQuestion
            | InputMode::CommandLevel1
            | InputMode::CommandLevel2
    )
}
