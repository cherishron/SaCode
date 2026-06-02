use super::{fuzzy_match, App, InputMode};

impl App {
    pub(super) fn filter_level1_commands(&mut self) {
        let query = self.input.trim_start_matches('/').to_lowercase();
        if query.is_empty() {
            self.filtered_level1 = self.level1_commands.clone();
        } else {
            self.filtered_level1 = self
                .level1_commands
                .iter()
                .filter(|cmd| {
                    fuzzy_match(&query, &cmd.name.to_lowercase())
                        || fuzzy_match(&query, &cmd.description.to_lowercase())
                })
                .cloned()
                .collect();
        }
        self.selected_level1_index = 0;
    }

    pub(super) fn filter_sub_commands(&mut self) {
        let query = self
            .input
            .split_whitespace()
            .last()
            .unwrap_or("")
            .to_lowercase();
        if let Some(level1) = &self.current_level1 {
            if query.is_empty() {
                self.filtered_sub_commands = level1.sub_commands.clone();
            } else {
                self.filtered_sub_commands = level1
                    .sub_commands
                    .iter()
                    .filter(|sub| {
                        fuzzy_match(&query, &sub.name.to_lowercase())
                            || fuzzy_match(&query, &sub.description.to_lowercase())
                    })
                    .cloned()
                    .collect();
            }
            self.selected_sub_index = 0;
        }
    }

    pub(super) fn confirm_level1_selection(&mut self) {
        if let Some(cmd) = self.filtered_level1.get(self.selected_level1_index) {
            if cmd.direct_execute {
                self.input = cmd.name.clone();
                self.input_mode = InputMode::Chat;
                self.filtered_level1.clear();
                self.selected_level1_index = 0;
            } else {
                self.current_level1 = Some(cmd.clone());
                self.filtered_sub_commands = cmd.sub_commands.clone();
                self.selected_sub_index = 0;
                self.input = cmd.name.clone() + " ";
                self.input_mode = InputMode::CommandLevel2;
            }
        }
    }

    pub(super) fn confirm_sub_selection(&mut self) {
        if let (Some(level1), Some(sub)) = (
            &self.current_level1,
            self.filtered_sub_commands.get(self.selected_sub_index),
        ) {
            self.input = format!("{} {}", level1.name, sub.name);
            if sub.needs_input {
                self.input.push(' ');
            }
            self.input_mode = InputMode::Chat;
            self.filtered_sub_commands.clear();
            self.selected_sub_index = 0;
            self.current_level1 = None;
        }
    }
}
