use std::path::{Path, PathBuf};

use anyhow::Result;

use crate::provider_config::SaCodeConfigStore;

pub fn run(args: Vec<String>) -> Result<()> {
    let workdir = PathBuf::from(".");
    let output = render_outstyle(&workdir, &args)?;
    println!("{}", output);
    Ok(())
}

pub fn render_outstyle(workdir: &Path, args: &[String]) -> Result<String> {
    let store = SaCodeConfigStore::new(workdir);

    match args.first().map(|value| value.as_str()) {
        None | Some("show") | Some("status") => render_status(&store),
        Some("path") => Ok(format_paths(&store)),
        Some("project") => render_project_scope(workdir, &store, &args[1..]),
        Some(value) => apply_user_style(&store, value),
    }
}

pub fn outstyle_instruction(workdir: &Path) -> Option<String> {
    let store = SaCodeConfigStore::new(workdir);
    let config = store.load_effective().ok()?;
    match normalize_outstyle(&config.outstyle).as_deref() {
        Some("concise") => Some(
            "当前输出风格: concise。请直接给答案，控制解释长度，减少铺垫和延伸。".to_string(),
        ),
        Some("explanatory") => Some(
            "当前输出风格: explanatory。请分步骤解释过程和原理，把关键逻辑拆开讲清楚。".to_string(),
        ),
        Some("teaching") => Some(
            "当前输出风格: teaching。请采用教学式表达：先用简短问题或判断引导，再讲解，再给简短总结与下一步练习方向。".to_string(),
        ),
        _ => None,
    }
}

fn render_status(store: &SaCodeConfigStore) -> Result<String> {
    let user = store.load_user()?.unwrap_or_default();
    let project = store.load()?.unwrap_or_default();
    let effective = store.load_effective()?;
    Ok(format!(
        "当前输出风格\n生效: {}\n用户默认: {}\n项目覆盖: {}\n可用风格:\n- concise: 只给答案，少解释\n- explanatory: 分步骤讲过程和原理\n- teaching: 用教学式方式引导、讲解、总结\n用法:\n- /outstyle concise\n- /outstyle explain\n- /outstyle teach\n- /outstyle clear\n- /outstyle project concise",
        display_style(&effective.outstyle),
        display_style(&user.outstyle),
        display_style(&project.outstyle),
    ))
}

fn render_project_scope(workdir: &Path, store: &SaCodeConfigStore, args: &[String]) -> Result<String> {
    match args.first().map(|value| value.as_str()) {
        None | Some("show") | Some("status") => {
            let project = store.load()?.unwrap_or_default();
            Ok(format!("项目级输出风格: {}", display_style(&project.outstyle)))
        }
        Some("path") => Ok(workdir.join(".sacode/config.json").display().to_string()),
        Some(value) => apply_project_style(store, value),
    }
}

fn apply_user_style(store: &SaCodeConfigStore, value: &str) -> Result<String> {
    let mut config = store.load_user()?.unwrap_or_default();
    match normalize_outstyle(value).as_deref() {
        Some(style) => {
            config.outstyle = style.to_string();
            store.save_user(&config)?;
            Ok(format!("用户级默认输出风格已设置为 {}。", style))
        }
        None if matches!(value, "clear" | "default") => {
            config.outstyle.clear();
            store.save_user(&config)?;
            Ok("用户级默认输出风格已清除。".to_string())
        }
        _ => Ok("用法: /outstyle [show|concise|explain|teach|clear|path|project ...]".to_string()),
    }
}

fn apply_project_style(store: &SaCodeConfigStore, value: &str) -> Result<String> {
    let mut config = store.load_or_default()?;
    match normalize_outstyle(value).as_deref() {
        Some(style) => {
            config.outstyle = style.to_string();
            store.save(&config)?;
            Ok(format!("项目级输出风格已设置为 {}。", style))
        }
        None if matches!(value, "clear" | "default") => {
            config.outstyle.clear();
            store.save(&config)?;
            Ok("项目级输出风格已清除，当前项目将回退到用户默认风格。".to_string())
        }
        _ => Ok("用法: /outstyle project [show|concise|explain|teach|clear|path]".to_string()),
    }
}

fn normalize_outstyle(value: &str) -> Option<String> {
    match value.trim().to_lowercase().as_str() {
        "concise" => Some("concise".to_string()),
        "explain" | "explanatory" => Some("explanatory".to_string()),
        "teach" | "teaching" | "learning" => Some("teaching".to_string()),
        _ => None,
    }
}

fn display_style(current: &str) -> String {
    normalize_outstyle(current).unwrap_or_else(|| "default".to_string())
}

fn format_paths(store: &SaCodeConfigStore) -> String {
    format!(
        "用户级配置: {}\n项目级配置: {}",
        store.user_path().display(),
        store.project_path().display(),
    )
}
