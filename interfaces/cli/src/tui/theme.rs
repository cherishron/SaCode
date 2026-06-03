use ratatui::style::Color;

#[derive(Debug, Clone, Copy)]
pub(super) struct ThemePalette {
    pub(super) name: &'static str,
    pub(super) bg_primary: Color,
    pub(super) border: Color,
    pub(super) accent: Color,
    pub(super) accent_strong: Color,
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
}

impl ThemePalette {
    pub(super) fn github() -> Self {
        Self {
            name: "GitHub",
            bg_primary: Color::Rgb(12, 14, 18),
            border: Color::Rgb(48, 54, 61),
            accent: Color::Rgb(88, 166, 255),
            accent_strong: Color::Rgb(121, 192, 255),
            plan: Color::Rgb(59, 130, 246),
            build: Color::Rgb(16, 185, 129),
            yolo: Color::Rgb(245, 158, 11),
            agent: Color::Rgb(139, 92, 246),
            user: Color::Rgb(88, 166, 255),
            assistant: Color::Rgb(201, 209, 217),
            text: Color::Rgb(201, 209, 217),
            muted: Color::Rgb(139, 148, 158),
            subtle: Color::Rgb(72, 79, 88),
            info: Color::Rgb(96, 165, 250),
            warning: Color::Rgb(251, 191, 36),
            selected_fg: Color::Rgb(255, 255, 255),
            selected_bg: Color::Rgb(31, 111, 235),
            panel_border: Color::Rgb(48, 54, 61),
        }
    }

    pub(super) fn vscode() -> Self {
        Self {
            name: "VSCode",
            bg_primary: Color::Rgb(24, 24, 24),
            border: Color::Rgb(60, 60, 60),
            accent: Color::Rgb(55, 148, 255),
            accent_strong: Color::Rgb(0, 122, 204),
            plan: Color::Rgb(55, 148, 255),
            build: Color::Rgb(78, 201, 176),
            yolo: Color::Rgb(220, 220, 170),
            agent: Color::Rgb(190, 140, 255),
            user: Color::Rgb(86, 156, 214),
            assistant: Color::Rgb(212, 212, 212),
            text: Color::Rgb(212, 212, 212),
            muted: Color::Rgb(156, 163, 175),
            subtle: Color::Rgb(106, 115, 125),
            info: Color::Rgb(86, 156, 214),
            warning: Color::Rgb(220, 220, 170),
            selected_fg: Color::Rgb(255, 255, 255),
            selected_bg: Color::Rgb(9, 71, 113),
            panel_border: Color::Rgb(51, 51, 51),
        }
    }

    pub(super) fn idea() -> Self {
        Self {
            name: "IntelliJ IDEA",
            bg_primary: Color::Rgb(43, 43, 43),
            border: Color::Rgb(74, 74, 74),
            accent: Color::Rgb(104, 151, 187),
            accent_strong: Color::Rgb(79, 140, 201),
            plan: Color::Rgb(104, 151, 187),
            build: Color::Rgb(166, 194, 97),
            yolo: Color::Rgb(255, 198, 109),
            agent: Color::Rgb(168, 127, 255),
            user: Color::Rgb(104, 151, 187),
            assistant: Color::Rgb(169, 183, 198),
            text: Color::Rgb(169, 183, 198),
            muted: Color::Rgb(128, 128, 128),
            subtle: Color::Rgb(96, 99, 102),
            info: Color::Rgb(104, 151, 187),
            warning: Color::Rgb(255, 198, 109),
            selected_fg: Color::Rgb(255, 255, 255),
            selected_bg: Color::Rgb(33, 66, 131),
            panel_border: Color::Rgb(74, 74, 74),
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
