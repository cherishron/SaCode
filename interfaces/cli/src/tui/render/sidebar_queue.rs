use ratatui::{
    layout::{Constraint, Direction, Layout, Rect},
    widgets::Paragraph,
    Frame,
};

use super::common::render_sidebar_section;
use super::super::{App, SidebarSection};

pub(crate) fn render_sidebar(frame: &mut Frame, app: &App, area: Rect) {
    let theme = app.theme;
    let sidebar_chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Percentage(36),
            Constraint::Percentage(34),
            Constraint::Percentage(30),
        ])
        .split(area);

    render_sidebar_section(
        frame,
        sidebar_chunks[0],
        "todo",
        app.sidebar_section_lines(SidebarSection::Todo),
        theme,
    );
    render_sidebar_section(
        frame,
        sidebar_chunks[1],
        "task",
        app.sidebar_section_lines(SidebarSection::Task),
        theme,
    );
    render_sidebar_section(
        frame,
        sidebar_chunks[2],
        "git",
        app.sidebar_section_lines(SidebarSection::Git),
        theme,
    );
}

pub(crate) fn render_queue_panel(frame: &mut Frame, app: &App, area: Rect) {
    frame.render_widget(Paragraph::new(app.queue_panel_lines()), area);
}
