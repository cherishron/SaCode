use ratatui::style::Color;

/// TUI palette — cool GitHub-dark industrial, strong hierarchy, tinted neutrals.
#[derive(Debug, Clone, Copy)]
pub(super) struct ThemePalette {
    pub(super) name: &'static str,
    pub(super) bg_primary: Color,
    pub(super) border: Color,
    pub(super) accent: Color,
    pub(super) plan: Color,
    pub(super) build: Color,
    pub(super) yolo: Color,
    pub(super) agent: Color,
    pub(super) user: Color,
    pub(super) assistant: Color,
    pub(super) text: Color,
    pub(super) muted: Color,
    pub(super) subtle: Color,
    pub(super) info: Color,
    pub(super) warning: Color,
    pub(super) selected_fg: Color,
    pub(super) selected_bg: Color,
    pub(super) panel_border: Color,
    pub(super) tool: Color,
    pub(super) card_bg: Color,
}

impl ThemePalette {
    pub(super) fn github() -> Self {
        Self {
            name: "GitHub",
            bg_primary: Color::Rgb(13, 17, 23),
            border: Color::Rgb(48, 54, 61),
            accent: Color::Rgb(88, 166, 255),
            plan: Color::Rgb(121, 192, 255),
            build: Color::Rgb(63, 185, 80),
            yolo: Color::Rgb(210, 153, 34),
            agent: Color::Rgb(163, 113, 247),
            user: Color::Rgb(88, 166, 255),
            assistant: Color::Rgb(230, 237, 243),
            text: Color::Rgb(230, 237, 243),
            muted: Color::Rgb(139, 148, 158),
            subtle: Color::Rgb(85, 95, 108),
            info: Color::Rgb(96, 165, 250),
            warning: Color::Rgb(248, 81, 73),
            selected_fg: Color::Rgb(255, 255, 255),
            selected_bg: Color::Rgb(47, 89, 164),
            panel_border: Color::Rgb(33, 38, 45),
            tool: Color::Rgb(56, 189, 248),
            card_bg: Color::Rgb(22, 27, 34),
        }
    }

    pub(super) fn vscode() -> Self {
        Self {
            name: "VSCode",
            bg_primary: Color::Rgb(30, 30, 30),
            border: Color::Rgb(60, 60, 60),
            accent: Color::Rgb(55, 148, 255),
            plan: Color::Rgb(55, 148, 255),
            build: Color::Rgb(78, 201, 176),
            yolo: Color::Rgb(220, 220, 170),
            agent: Color::Rgb(190, 140, 255),
            user: Color::Rgb(86, 156, 214),
            assistant: Color::Rgb(220, 220, 220),
            text: Color::Rgb(220, 220, 220),
            muted: Color::Rgb(156, 163, 175),
            subtle: Color::Rgb(106, 115, 125),
            info: Color::Rgb(86, 156, 214),
            warning: Color::Rgb(244, 71, 71),
            selected_fg: Color::Rgb(255, 255, 255),
            selected_bg: Color::Rgb(9, 71, 113),
            panel_border: Color::Rgb(45, 45, 48),
            tool: Color::Rgb(78, 201, 176),
            card_bg: Color::Rgb(37, 37, 38),
        }
    }

    pub(super) fn idea() -> Self {
        Self {
            name: "IntelliJ IDEA",
            bg_primary: Color::Rgb(43, 43, 43),
            border: Color::Rgb(74, 74, 74),
            accent: Color::Rgb(104, 151, 187),
            plan: Color::Rgb(104, 151, 187),
            build: Color::Rgb(166, 194, 97),
            yolo: Color::Rgb(255, 198, 109),
            agent: Color::Rgb(168, 127, 255),
            user: Color::Rgb(104, 151, 187),
            assistant: Color::Rgb(180, 194, 210),
            text: Color::Rgb(180, 194, 210),
            muted: Color::Rgb(140, 140, 140),
            subtle: Color::Rgb(100, 104, 108),
            info: Color::Rgb(104, 151, 187),
            warning: Color::Rgb(255, 123, 114),
            selected_fg: Color::Rgb(255, 255, 255),
            selected_bg: Color::Rgb(33, 66, 131),
            panel_border: Color::Rgb(74, 74, 74),
            tool: Color::Rgb(104, 151, 187),
            card_bg: Color::Rgb(50, 50, 50),
        }
    }

    pub(super) fn from_name(name: &str) -> Option<Self> {
        match name.trim().to_lowercase().as_str() {
            "github" => Some(Self::github()),
            "vscode" | "vs-code" | "vs_code" => Some(Self::vscode()),
            "intellij" | "idea" | "intellij-idea" | "intellij_idea" => Some(Self::idea()),
            _ => None,
        }
    }

    pub(super) fn names() -> &'static str {
        "github, vscode, idea"
    }
}
