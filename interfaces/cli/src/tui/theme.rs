use ratatui::style::Color;

#[derive(Debug, Clone, Copy)]
pub(super) struct ThemePalette {
    pub(super) name: &'static str,
    pub(super) border: Color,
    pub(super) accent: Color,
    pub(super) accent_strong: Color,
    pub(super) user: Color,
    pub(super) assistant: Color,
    pub(super) system: Color,
    pub(super) text: Color,
    pub(super) muted: Color,
    pub(super) subtle: Color,
    pub(super) warning: Color,
    pub(super) selected_fg: Color,
    pub(super) selected_bg: Color,
    pub(super) panel_border: Color,
}

impl ThemePalette {
    pub(super) fn github() -> Self {
        Self {
            name: "GitHub",
            border: Color::Rgb(48, 54, 61),
            accent: Color::Rgb(88, 166, 255),
            accent_strong: Color::Rgb(121, 192, 255),
            user: Color::Rgb(121, 192, 255),
            assistant: Color::Rgb(126, 231, 135),
            system: Color::Rgb(139, 148, 158),
            text: Color::Rgb(230, 237, 243),
            muted: Color::Rgb(201, 209, 217),
            subtle: Color::Rgb(139, 148, 158),
            warning: Color::Rgb(210, 153, 34),
            selected_fg: Color::Rgb(255, 255, 255),
            selected_bg: Color::Rgb(31, 111, 235),
            panel_border: Color::Rgb(48, 54, 61),
        }
    }

    pub(super) fn vscode() -> Self {
        Self {
            name: "VSCode",
            border: Color::Rgb(60, 60, 60),
            accent: Color::Rgb(55, 148, 255),
            accent_strong: Color::Rgb(0, 122, 204),
            user: Color::Rgb(86, 156, 214),
            assistant: Color::Rgb(78, 201, 176),
            system: Color::Rgb(156, 220, 254),
            text: Color::Rgb(212, 212, 212),
            muted: Color::Rgb(156, 163, 175),
            subtle: Color::Rgb(106, 115, 125),
            warning: Color::Rgb(220, 220, 170),
            selected_fg: Color::Rgb(255, 255, 255),
            selected_bg: Color::Rgb(9, 71, 113),
            panel_border: Color::Rgb(51, 51, 51),
        }
    }

    pub(super) fn idea() -> Self {
        Self {
            name: "IntelliJ IDEA",
            border: Color::Rgb(74, 74, 74),
            accent: Color::Rgb(104, 151, 187),
            accent_strong: Color::Rgb(79, 140, 201),
            user: Color::Rgb(104, 151, 187),
            assistant: Color::Rgb(166, 194, 97),
            system: Color::Rgb(128, 128, 128),
            text: Color::Rgb(169, 183, 198),
            muted: Color::Rgb(128, 128, 128),
            subtle: Color::Rgb(96, 99, 102),
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
