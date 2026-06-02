use std::{fs, io, path::PathBuf};

use anyhow::Result;
use arboard::Clipboard;
use crossterm::event::{self, Event, KeyEventKind, MouseButton, MouseEvent, MouseEventKind};
use ratatui::{backend::CrosstermBackend, layout::Rect, Terminal};

use super::{encode_ppm, relative_to_workdir, App, InputMode};
use super::tui_entry::ui;

pub(super) fn run_app(
    terminal: &mut Terminal<CrosstermBackend<io::Stdout>>,
    app: &mut App,
) -> Result<()> {
    let mut needs_redraw = true;
    while !app.should_quit {
        if needs_redraw {
            terminal.draw(|frame| ui(frame, app))?;
            needs_redraw = false;
        }

        if event::poll(app.redraw_poll_interval())? {
            match event::read()? {
                Event::Key(key) => {
                    if key.kind == KeyEventKind::Press || key.kind == KeyEventKind::Repeat {
                        app.handle_key_event(key);
                        needs_redraw = true;
                    }
                }
                Event::Paste(text) => {
                    app.handle_paste(text);
                    needs_redraw = true;
                }
                Event::Mouse(mouse) => {
                    app.handle_mouse_event(mouse);
                    needs_redraw = true;
                }
                Event::Resize(_, _) => {
                    needs_redraw = true;
                }
                _ => {}
            }
        }

        if app.poll_async_results() {
            needs_redraw = true;
        }
        if app.tick() {
            needs_redraw = true;
        }
    }
    Ok(())
}

impl App {
    pub(super) fn handle_paste(&mut self, content: String) {
        if matches!(
            self.input_mode,
            InputMode::ProviderSelect
                | InputMode::ModelSelect
                | InputMode::ThemeSelect
                | InputMode::ConnectSelect
                | InputMode::SkillsSelect
                | InputMode::McpSelect
                | InputMode::CheckpointSelect
                | InputMode::ModeSelect
                | InputMode::SessionSelect
                | InputMode::ConfigSelect
                | InputMode::ConfigEnumSelect
        ) {
            return;
        }
        self.input.push_str(&content);
        if self.input_mode == InputMode::CommandLevel1 {
            self.filter_level1_commands();
        }
        if self.input_mode == InputMode::CommandLevel2 {
            self.filter_sub_commands();
        }
    }

    pub(super) fn handle_mouse_event(&mut self, mouse: MouseEvent) {
        match mouse.kind {
            MouseEventKind::Down(MouseButton::Right) => self.paste_from_system_clipboard(),
            MouseEventKind::ScrollUp => {
                if self.point_in_rect(mouse.column, mouse.row, self.message_viewport) {
                    for _ in 0..3 {
                        self.scroll_up();
                    }
                }
            }
            MouseEventKind::ScrollDown => {
                if self.point_in_rect(mouse.column, mouse.row, self.message_viewport) {
                    for _ in 0..3 {
                        self.scroll_down();
                    }
                }
            }
            _ => {}
        }
    }

    fn point_in_rect(&self, column: u16, row: u16, rect: Rect) -> bool {
        column >= rect.x
            && column < rect.x.saturating_add(rect.width)
            && row >= rect.y
            && row < rect.y.saturating_add(rect.height)
    }

    fn paste_from_system_clipboard(&mut self) {
        let mut clipboard = match Clipboard::new() {
            Ok(clipboard) => clipboard,
            Err(error) => {
                self.push_error_message(&format!("读取系统剪贴板失败: {}", error));
                return;
            }
        };

        if let Ok(text) = clipboard.get_text() {
            if !text.trim().is_empty() {
                self.handle_paste(text);
                return;
            }
        }

        match clipboard.get_image() {
            Ok(image) => {
                match self.save_pasted_image(&image.bytes.into_owned(), image.width, image.height) {
                    Ok(path) => {
                        let snippet = format!(
                            "我刚粘贴了一张图片，文件路径是 `{}`。如果需要读取图片内容，请调用 `media.read` 工具处理这个文件。当前模型支持图片时会自动执行 OCR 或描述，并在结果中标注来源，例如 provider 或 fallback。",
                            path.display()
                        );
                        self.handle_paste(snippet);
                        self.push_success_message(&format!("已粘贴剪贴板图片: {}", path.display()));
                    }
                    Err(error) => {
                        self.push_error_message(&format!("保存剪贴板图片失败: {}", error))
                    }
                }
            }
            Err(error) => {
                self.push_system_message(&format!("剪贴板中没有可用文本或图片: {}", error));
            }
        }
    }

    fn save_pasted_image(&self, rgba_bytes: &[u8], width: usize, height: usize) -> Result<PathBuf> {
        let dir = self.workdir.join(".sacode").join("pasted");
        fs::create_dir_all(&dir)?;
        let filename = format!(
            "paste-{}.ppm",
            chrono::Local::now().format("%Y%m%d%H%M%S%3f")
        );
        let path = dir.join(filename);
        let ppm = encode_ppm(rgba_bytes, width, height);
        fs::write(&path, ppm)?;
        Ok(relative_to_workdir(&self.workdir, &path))
    }
}
