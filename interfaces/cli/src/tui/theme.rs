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
        .resolve_for_terminal()
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
        .resolve_for_terminal()
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
        .resolve_for_terminal()
    }

    /// D12 浅色主题 — 对齐品牌令牌规范（docs/design/brand-token-spec.md）：
    /// 主色 #366CFF（D2 唯一真源）、浅中性底 #F6F8FA、卡片白 #FFFFFF、深字 #1F2328。
    pub(super) fn light() -> Self {
        Self {
            name: "Light",
            bg_primary: Color::Rgb(246, 248, 250),
            border: Color::Rgb(208, 215, 222),
            accent: Color::Rgb(54, 108, 255),
            plan: Color::Rgb(54, 108, 255),
            build: Color::Rgb(26, 127, 55),
            yolo: Color::Rgb(154, 106, 0),
            agent: Color::Rgb(109, 64, 201),
            user: Color::Rgb(54, 108, 255),
            assistant: Color::Rgb(31, 35, 40),
            text: Color::Rgb(31, 35, 40),
            muted: Color::Rgb(101, 108, 118),
            subtle: Color::Rgb(145, 152, 161),
            info: Color::Rgb(54, 108, 255),
            warning: Color::Rgb(207, 34, 46),
            selected_fg: Color::Rgb(255, 255, 255),
            selected_bg: Color::Rgb(54, 108, 255),
            panel_border: Color::Rgb(208, 215, 222),
            tool: Color::Rgb(9, 105, 218),
            card_bg: Color::Rgb(255, 255, 255),
        }
        .resolve_for_terminal()
    }

    pub(super) fn from_name(name: &str) -> Option<Self> {
        match name.trim().to_lowercase().as_str() {
            "github" => Some(Self::github()),
            "vscode" | "vs-code" | "vs_code" => Some(Self::vscode()),
            "intellij" | "idea" | "intellij-idea" | "intellij_idea" => Some(Self::idea()),
            "light" | "浅色" | "浅" => Some(Self::light()),
            _ => None,
        }
    }

    pub(super) fn names() -> &'static str {
        "github, vscode, idea, light"
    }
}

// ── D12 真彩（truecolor）检测与降级 ────────────────────────────────────────────

/// 检测当前终端是否支持 24-bit 真彩。
///
/// 判定依据（任一命中即真彩）：
/// - `COLORTERM` 含 `truecolor` / `24bit`
/// - Windows Terminal（`WT_SESSION` 恒真彩）
/// - kitty/WezTerm/alacritty 等现代终端特有 env
///
/// 注意：这是**每进程一次**的环境探测，不追求完美（终端探测本无银弹）；
/// 漏检的后果只是多降级一次到 256 色（视觉略偏，无功能损失）。
pub(super) fn terminal_supports_truecolor() -> bool {
    if let Ok(value) = std::env::var("COLORTERM") {
        let value = value.trim().to_ascii_lowercase();
        if value.contains("truecolor") || value.contains("24bit") {
            return true;
        }
    }
    if std::env::var_os("WT_SESSION").is_some() {
        return true;
    }
    false
}

/// D12：按终端能力降级主题颜色。
///
/// 真彩终端 → 原样返回；256 色终端 → Rgb 映射到 256 色板最近色（Indexed）。
/// 在不支持 Indexed 的极老终端上 ratatui 仍会输出，颜色偏差可接受。
impl ThemePalette {
    pub(super) fn resolve_for_terminal(self) -> Self {
        if terminal_supports_truecolor() {
            return self;
        }
        Self {
            name: self.name,
            bg_primary: downgrade_color(self.bg_primary),
            border: downgrade_color(self.border),
            accent: downgrade_color(self.accent),
            plan: downgrade_color(self.plan),
            build: downgrade_color(self.build),
            yolo: downgrade_color(self.yolo),
            agent: downgrade_color(self.agent),
            user: downgrade_color(self.user),
            assistant: downgrade_color(self.assistant),
            text: downgrade_color(self.text),
            muted: downgrade_color(self.muted),
            subtle: downgrade_color(self.subtle),
            info: downgrade_color(self.info),
            warning: downgrade_color(self.warning),
            selected_fg: downgrade_color(self.selected_fg),
            selected_bg: downgrade_color(self.selected_bg),
            panel_border: downgrade_color(self.panel_border),
            tool: downgrade_color(self.tool),
            card_bg: downgrade_color(self.card_bg),
        }
    }
}

/// RGB → 256 色板最近色。
///
/// 256 色板结构：0-15 基础色（跳过，与 RGB 匹配语义不稳）+ 16-231 的 6×6×6 立方
/// （每通道量化级 [0, 95, 135, 175, 215, 255]）+ 232-255 的 24 级灰阶。
/// 对每通道分别取最近量化级，立方与灰阶两组候选取总距离更近者。
fn downgrade_color(color: Color) -> Color {
    let Color::Rgb(r, g, b) = color else {
        return color; // 非 Rgb（Indexed/Named）原样返回
    };
    const LEVELS: [u8; 6] = [0, 95, 135, 175, 215, 255];
    let nearest_level = |channel: u8| {
        LEVELS
            .iter()
            .copied()
            .min_by_key(|level| level.abs_diff(channel))
            .unwrap_or(channel)
    };
    let (r6, g6, b6) = (nearest_level(r), nearest_level(g), nearest_level(b));
    let cube_index = 16u8 + 36 * LEVELS.iter().position(|l| *l == r6).unwrap_or(0) as u8
        + 6 * LEVELS.iter().position(|l| *l == g6).unwrap_or(0) as u8
        + LEVELS.iter().position(|l| *l == b6).unwrap_or(0) as u8;
    let cube_distance =
        (r as i32 - r6 as i32).pow(2) + (g as i32 - g6 as i32).pow(2) + (b as i32 - b6 as i32).pow(2);
    // 灰阶候选：24 级 [8, 18, ..., 238]
    let gray_level = ((r as u16 + g as u16 + b as u16) / 3).clamp(0, 255) as u8;
    let gray_index = 232u8 + (gray_level as u16 * 24 / 256).min(23) as u8;
    let gray_representative = 8 + (gray_index - 232) * 10;
    let gray_distance = (r as i32 - gray_representative as i32).pow(2)
        + (g as i32 - gray_representative as i32).pow(2)
        + (b as i32 - gray_representative as i32).pow(2);
    if gray_distance < cube_distance {
        Color::Indexed(gray_index)
    } else {
        Color::Indexed(cube_index)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 纯黑 (0,0,0)：立方 (0,0,0) 距离 0 → Indexed(16)（立方首格），
    /// 而非灰阶 232（rep=8，距离 192）。
    #[test]
    fn downgrade_maps_pure_black_to_cube_origin() {
        assert!(matches!(downgrade_color(Color::Rgb(0, 0, 0)), Color::Indexed(16)));
    }

    /// 纯白 (255,255,255)：立方精确匹配 (255,255,255) → Indexed(231)。
    #[test]
    fn downgrade_maps_pure_white_to_cube_end() {
        assert!(matches!(
            downgrade_color(Color::Rgb(255, 255, 255)),
            Color::Indexed(231)
        ));
    }

    /// 品牌蓝 #366CFF (54,108,255) → 立方 (95,95,255) = Indexed(63)。
    /// 立方距离 1850 远小于灰阶候选（rep=138）距离 21645。
    #[test]
    fn downgrade_snaps_brand_blue_to_nearest_cube_color() {
        assert!(matches!(downgrade_color(Color::Rgb(54, 108, 255)), Color::Indexed(63)));
    }

    /// 中灰 (128,128,128) → 灰阶 244（rep=128 距离 0），优先于立方 (135,135,135) 距离 147。
    #[test]
    fn downgrade_prefers_gray_ramp_for_neutral_grays() {
        assert!(matches!(
            downgrade_color(Color::Rgb(128, 128, 128)),
            Color::Indexed(244)
        ));
    }

    /// 非 Rgb 颜色（Named/Indexed）原样返回。
    #[test]
    fn downgrade_keeps_non_rgb_colors() {
        assert!(matches!(downgrade_color(Color::Red), Color::Red));
        assert!(matches!(downgrade_color(Color::Indexed(42)), Color::Indexed(42)));
    }

    /// D12：浅色主题可按名解析（含中文别名与大小写不敏感）。
    #[test]
    fn light_theme_resolves_by_name() {
        let light = ThemePalette::from_name("light").expect("light theme must resolve");
        assert_eq!(light.name, "Light");
        assert!(ThemePalette::from_name("浅色").is_some(), "中文别名");
        assert!(ThemePalette::from_name(" LIGHT ").is_some(), "大小写+空白不敏感");
    }

    /// 主题清单文案必须包含 light（/theme 帮助与选择器共用）。
    #[test]
    fn names_mentions_light() {
        assert!(ThemePalette::names().contains("light"));
    }

    /// 真彩终端（COLORTERM=truecolor）下 resolve_for_terminal 恒等。
    /// 注：env 影响进程全局，此测试临时改写并还原（与 sidecar token 测试同模式）。
    #[test]
    fn resolve_keeps_rgb_on_truecolor_terminals() {
        let key = "COLORTERM";
        let prev = std::env::var(key).ok();
        std::env::set_var(key, "truecolor");
        let palette = ThemePalette {
            name: "TestTruecolor",
            bg_primary: Color::Rgb(11, 22, 33),
            border: Color::Rgb(1, 2, 3),
            accent: Color::Rgb(54, 108, 255),
            plan: Color::Rgb(0, 0, 0),
            build: Color::Rgb(255, 255, 255),
            yolo: Color::Rgb(128, 128, 128),
            agent: Color::Rgb(9, 9, 9),
            user: Color::Rgb(10, 10, 10),
            assistant: Color::Rgb(20, 20, 20),
            text: Color::Rgb(30, 30, 30),
            muted: Color::Rgb(40, 40, 40),
            subtle: Color::Rgb(50, 50, 50),
            info: Color::Rgb(60, 60, 60),
            warning: Color::Rgb(70, 70, 70),
            selected_fg: Color::Rgb(80, 80, 80),
            selected_bg: Color::Rgb(90, 90, 90),
            panel_border: Color::Rgb(100, 100, 100),
            tool: Color::Rgb(110, 110, 110),
            card_bg: Color::Rgb(120, 120, 120),
        };
        let resolved = palette.resolve_for_terminal();
        assert!(matches!(resolved.bg_primary, Color::Rgb(11, 22, 33)));
        assert!(matches!(resolved.accent, Color::Rgb(54, 108, 255)));
        match prev {
            Some(value) => std::env::set_var(key, value),
            None => std::env::remove_var(key),
        }
    }
}
