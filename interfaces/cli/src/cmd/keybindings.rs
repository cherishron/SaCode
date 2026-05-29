use std::path::{Path, PathBuf};

use anyhow::Result;

use crate::provider_config::SaCodeConfigStore;

pub fn run() -> Result<()> {
    let workdir = PathBuf::from(".");
    println!("{}", render_keybindings(&workdir)?);
    Ok(())
}

pub fn render_keybindings(workdir: &Path) -> Result<String> {
    let config = SaCodeConfigStore::new(workdir).load_effective()?;
    let vim = if config.vim_mode {
        "Vim 导航: enabled\n- h: 返回或取消\n- j: 下移\n- k: 上移\n- l: 确认或进入"
    } else {
        "Vim 导航: disabled"
    };

    Ok(format!(
        "Keybindings\n通用:\n- Ctrl+Q: 退出 TUI\n- Ctrl+A: 优化当前输入\n- Ctrl+S: 折叠或展开全部助手回复\n- Ctrl+T: 开启或关闭思考功能\n- Ctrl+M: 在 plan / build / yolo 间切换执行模式\n- Ctrl+Z: 撤回输入优化\n- Esc: 取消当前任务或退出当前选择\n- /: 打开命令列表\n\n导航:\n- Up / Down: 选择列表项或浏览历史\n- Enter: 确认\n- Tab: 补全命令\n- PageUp / PageDown: 滚动消息\n\n{}",
        vim
    ))
}
