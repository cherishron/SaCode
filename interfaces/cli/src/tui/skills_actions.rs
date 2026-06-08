use std::path::Path;

use sacode_runtime::SkillRegistry;

use super::{App, InputMode};

impl App {
    pub(super) fn skills_command(&mut self, input: &str) {
        let parts: Vec<&str> = input.split_whitespace().collect();
        let registry = SkillRegistry::new(Path::new("."));

        if parts.len() <= 1 || parts[1] == "list" {
            match registry.list() {
                Ok(skills) if skills.is_empty() => self.push_system_message("当前没有可用 skills"),
                Ok(skills) => {
                    let content = skills
                        .into_iter()
                        .map(|skill| {
                            format!(
                                "- {} [{}]\n  {}",
                                skill.name,
                                skill.source.label(),
                                skill.description
                            )
                        })
                        .collect::<Vec<_>>()
                        .join("\n");
                    self.push_system_message(&format!("可用 Skills:\n{}", content));
                }
                Err(error) => self.push_error_message(&format!("读取 skills 失败: {}", error)),
            }
            return;
        }

        match parts.get(1).copied() {
            Some("show") => {
                if parts.len() > 2 {
                    match registry.get(parts[2]) {
                        Ok(skill) => self.push_system_message(&format!(
                            "Skill {} [{}]\n{}\n\n{}",
                            skill.name,
                            skill.source.label(),
                            skill.description,
                            skill.prompt
                        )),
                        Err(error) => {
                            self.push_system_message(&format!("读取 skill 失败: {}", error))
                        }
                    }
                } else {
                    self.open_skills_selector_for_action("show");
                }
            }
            Some("run") => {
                if parts.len() > 2 {
                    match registry.render_prompt(parts[2], &parts[3..].join(" "), Path::new(".")) {
                        Ok(rendered) => self.push_system_message(&rendered),
                        Err(error) => {
                            self.push_system_message(&format!("运行 skill 失败: {}", error))
                        }
                    }
                } else {
                    self.open_skills_selector_for_action("run");
                }
            }
            Some("add") => {
                if parts.len() >= 5 {
                    match registry.save_project_skill(parts[2], parts[3], &parts[4..].join(" ")) {
                        Ok(path) => {
                            self.push_success_message(&format!("Skill 已保存到 {}", path.display()))
                        }
                        Err(error) => {
                            self.push_error_message(&format!("保存 skill 失败: {}", error))
                        }
                    }
                } else {
                    self.push_system_message("用法: /skills add <name> <description> <prompt>");
                }
            }
            Some("remove") => {
                if parts.len() > 2 {
                    match registry.remove_project_skill(parts[2]) {
                        Ok(()) => self.push_success_message(&format!("Skill {} 已删除", parts[2])),
                        Err(error) => {
                            self.push_error_message(&format!("删除 skill 失败: {}", error))
                        }
                    }
                } else {
                    self.open_skills_selector_for_action("remove");
                }
            }
            _ => self.push_system_message("用法: /skills list|show|run|add|remove"),
        }
    }

    pub(super) fn open_skills_selector(&mut self) {
        let registry = SkillRegistry::new(Path::new("."));
        match registry.list() {
            Ok(skills) if skills.is_empty() => self.push_system_message("当前没有可用 skills"),
            Ok(skills) => {
                self.skills_options = skills
                    .into_iter()
                    .map(|skill| {
                        (
                            skill.name,
                            format!("{} [{}]", skill.description, skill.source.label()),
                        )
                    })
                    .collect();
                self.selected_skills_index = 0;
                self.input_mode = InputMode::SkillsSelect;
            }
            Err(error) => self.push_error_message(&format!("读取 skills 失败: {}", error)),
        }
    }

    pub(super) fn open_skills_selector_for_action(&mut self, action: &str) {
        self.pending_skill_action = Some(action.to_string());
        self.open_skills_selector();
    }

    pub(super) fn confirm_skills_selection(&mut self) {
        let selected_skill = self.skills_options.get(self.selected_skills_index).cloned();
        if let Some((name, _)) = selected_skill {
            let action = self.pending_skill_action.clone();
            self.input_mode = InputMode::Chat;
            self.skills_options.clear();
            self.selected_skills_index = 0;
            self.pending_skill_action = None;

            match action.as_deref() {
                Some("show") => {
                    self.input = format!("/skills show {}", name);
                    self.send_message();
                }
                Some("run") => {
                    self.input = format!("/skills run {}", name);
                    self.push_system_message(&format!(
                        "已选择 skill: {}，请输入参数后回车执行",
                        name
                    ));
                }
                Some("remove") => {
                    let registry = SkillRegistry::new(Path::new("."));
                    match registry.remove_project_skill(&name) {
                        Ok(()) => self.push_success_message(&format!("Skill {} 已删除", name)),
                        Err(error) => {
                            self.push_error_message(&format!("删除 skill 失败: {}", error))
                        }
                    }
                }
                _ => {
                    self.input = format!("/skills show {}", name);
                    self.send_message();
                }
            }
        }
    }
}
