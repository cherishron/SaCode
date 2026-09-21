//! 内置 TDesign 风格设计示例。

#[derive(Debug, Clone)]
pub struct DesignExample {
    pub id: &'static str,
    pub title: &'static str,
    pub summary: &'static str,
    pub components: &'static [&'static str],
    pub layout_notes: &'static [&'static str],
    pub design_tokens: &'static [(&'static str, &'static str)],
    pub prompt: &'static str,
}

impl DesignExample {
    pub fn render_brief(&self, project: &str) -> String {
        let mut md = String::new();
        md.push_str(&format!("# {} — {}\n\n", self.title, project));
        md.push_str(&format!("> 示例 ID: `{}`\n\n", self.id));
        md.push_str(&format!("{}\n\n", self.summary));
        md.push_str("## 建议组件（TDesign 风格）\n\n");
        for c in self.components {
            md.push_str(&format!("- `{c}`\n"));
        }
        md.push_str("\n## 布局要点\n\n");
        for n in self.layout_notes {
            md.push_str(&format!("- {n}\n"));
        }
        md.push_str("\n## 设计 Token 建议\n\n");
        md.push_str("| Token | 建议 |\n|------|------|\n");
        for (k, v) in self.design_tokens {
            md.push_str(&format!("| {k} | {v} |\n"));
        }
        md.push_str("\n## 产出说明\n\n");
        md.push_str("- 本文件为设计简报，可直接给设计师/后续 AI UI 任务使用。\n");
        md.push_str("- 配套 `prompt.md` 可作为生成 UI 骨架的任务提示词。\n");
        md
    }

    pub fn render_prompt(&self, project: &str) -> String {
        format!(
            "为「{project}」生成 {title} 的 UI 骨架。\n\n\
             设计风格：TDesign（简洁、信息密度适中、主色强调操作）。\n\
             场景：{summary}\n\
             建议组件：{components}\n\
             布局要点：{layout}\n\n\
             要求：\n1. 使用语义化 HTML 或常见前端组件结构；\n2. 体现交互状态（空态/加载/错误）；\n3. 不要发明与场景无关的模块。\n",
            project = project,
            title = self.title,
            summary = self.summary,
            components = self.components.join(", "),
            layout = self.layout_notes.join("；"),
        )
    }
}

pub fn list_design_examples() -> Vec<DesignExample> {
    EXAMPLES.to_vec()
}

pub fn design_example(id: &str) -> Option<DesignExample> {
    EXAMPLES.iter().find(|e| e.id == id).cloned()
}

const EXAMPLES: &[DesignExample] = &[
    DesignExample {
        id: "td-dashboard",
        title: "数据看板",
        summary: "运营/系统监控看板：关键指标一览、趋势与明细。",
        components: &[
            "Card",
            "Statistic",
            "Table",
            "Select",
            "DatePicker",
            "Tabs",
            "Progress",
        ],
        layout_notes: &[
            "顶部指标卡 3–4 个",
            "中部图表或趋势列表",
            "底部明细表格 + 筛选",
        ],
        design_tokens: &[
            ("primary", "TDesign Brand Blue"),
            ("radius", "6–8px"),
            ("spacing", "16/24"),
        ],
        prompt: "dashboard",
    },
    DesignExample {
        id: "td-list-table",
        title: "列表管理",
        summary: "资源列表页：搜索、筛选、分页、行操作。",
        components: &[
            "Input",
            "Select",
            "Button",
            "Table",
            "Pagination",
            "Dialog",
            "Tag",
        ],
        layout_notes: &["搜索区单行或两行", "表格操作列固定右侧", "危险操作二次确认"],
        design_tokens: &[("table_row_height", "48px"), ("danger", "#D54941")],
        prompt: "list",
    },
    DesignExample {
        id: "td-form-settings",
        title: "表单设置",
        summary: "设置页分组表单：基础信息、通知、高级选项。",
        components: &[
            "Form", "Input", "Switch", "Radio", "Button", "Divider", "Message",
        ],
        layout_notes: &["左侧分组锚点可选", "右侧主表单", "底部固定保存条"],
        design_tokens: &[("form_label_width", "120px"), ("submit_primary", "保存")],
        prompt: "form",
    },
    DesignExample {
        id: "td-landing",
        title: "落地页",
        summary: "产品介绍落地页：Hero、能力点、CTA。",
        components: &["Button", "Card", "Grid", "Typography", "Divider"],
        layout_notes: &["Hero 一句话价值主张", "3 列能力卡", "底部次级 CTA"],
        design_tokens: &[("hero_title", "32–40px"), ("cta", "立即开始")],
        prompt: "landing",
    },
    DesignExample {
        id: "td-empty",
        title: "空状态",
        summary: "列表/搜索无数据时的引导空状态。",
        components: &["Empty", "Button", "Typography"],
        layout_notes: &["插图/图标 + 说明 + 主操作", "避免仅显示 Error"],
        design_tokens: &[("empty_hint", "暂无数据，先创建一条吧")],
        prompt: "empty",
    },
];

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn list_and_apply_example() {
        let list = list_design_examples();
        assert!(list.len() >= 5);
        let ex = design_example("td-dashboard").unwrap();
        assert!(ex.components.contains(&"Table"));
        let brief = ex.render_brief("DemoApp");
        assert!(brief.contains("td-dashboard"));
        assert!(brief.contains("TDesign"));
        let prompt = ex.render_prompt("DemoApp");
        assert!(prompt.contains("DemoApp"));
        assert!(prompt.contains("TDesign"));
    }

    #[test]
    fn apply_writes_brief_files() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = crate::ai_design::apply_design_example(tmp.path(), "td-form-settings", Some("X"))
            .unwrap();
        assert!(dir.join("brief.md").exists());
        assert!(dir.join("prompt.md").exists());
        assert!(crate::ai_design::apply_design_example(tmp.path(), "nope", None).is_err());
    }
}
