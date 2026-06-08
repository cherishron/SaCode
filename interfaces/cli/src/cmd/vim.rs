use std::path::{Path, PathBuf};

use anyhow::Result;

use crate::provider_config::SaCodeConfigStore;

pub fn run(args: Vec<String>) -> Result<()> {
    let workdir = PathBuf::from(".");
    println!("{}", render_vim(&workdir, &args)?);
    Ok(())
}

pub fn render_vim(workdir: &Path, args: &[String]) -> Result<String> {
    let store = SaCodeConfigStore::new(workdir);
    let mut config = store.load_effective()?;

    match args.first().map(|value| value.as_str()) {
        None | Some("show") | Some("status") => Ok(format!(
            "Vim 模式: {}\n说明:\n- 启用后，TUI 列表和消息滚动支持 h/j/k/l\n- j/k: 下/上\n- h: 取消或返回\n- l: 确认或进入",
            if config.vim_mode { "enabled" } else { "disabled" }
        )),
        Some("on") | Some("enable") => {
            config.vim_mode = true;
            store.save_user(&config)?;
            Ok("已启用用户级 Vim 模式。".to_string())
        }
        Some("off") | Some("disable") => {
            config.vim_mode = false;
            store.save_user(&config)?;
            Ok("已关闭用户级 Vim 模式。".to_string())
        }
        Some("project") => {
            let mut project = store.load_or_default()?;
            match args.get(1).map(|value| value.as_str()) {
                None | Some("show") | Some("status") => Ok(format!(
                    "项目级 Vim 模式: {}",
                    if project.vim_mode { "enabled" } else { "disabled" }
                )),
                Some("on") | Some("enable") => {
                    project.vim_mode = true;
                    store.save(&project)?;
                    Ok("已启用项目级 Vim 模式。".to_string())
                }
                Some("off") | Some("disable") | Some("clear") => {
                    project.vim_mode = false;
                    store.save(&project)?;
                    Ok("已关闭项目级 Vim 模式。".to_string())
                }
                _ => Ok("用法: /vim [show|on|off|project show|on|off]".to_string()),
            }
        }
        _ => Ok("用法: /vim [show|on|off|project show|on|off]".to_string()),
    }
}
