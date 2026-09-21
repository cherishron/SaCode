//! AIDesign — TD 风格示例库 + 设计简报（Compose ai-design-tdesign）。

pub mod examples;
pub mod variants;

pub use examples::{design_example, list_design_examples, DesignExample};
pub use variants::{
    apply_design_variant, apply_design_variant_out, build_variants_prompt, extract_json_array,
    generate_design_variants, normalize_variant_id, parse_design_variants, read_variant_meta,
    strip_code_fences, DesignVariant, DesignVariantMeta,
};

use anyhow::Result;
use std::path::{Path, PathBuf};

/// Write brief + prompt under `.sacode/design/<id>/`.
pub fn apply_design_example(
    root: &Path,
    example_id: &str,
    project_name: Option<&str>,
) -> Result<PathBuf> {
    apply_design_example_out(root, example_id, project_name, None)
}

/// `out` is design library root; default `root/.sacode/design`. Writes `<out>/<id>/`.
pub fn apply_design_example_out(
    root: &Path,
    example_id: &str,
    project_name: Option<&str>,
    out: Option<&Path>,
) -> Result<PathBuf> {
    let example = design_example(example_id).ok_or_else(|| {
        anyhow::anyhow!("unknown design example id: {example_id}（sacode design list）")
    })?;
    let library = match out {
        Some(p) if p.is_absolute() => p.to_path_buf(),
        Some(p) => root.join(p),
        None => root.join(".sacode").join("design"),
    };
    let dir = library.join(&example.id);
    std::fs::create_dir_all(&dir)?;
    let project = project_name.unwrap_or("本项目");
    let brief = example.render_brief(project);
    let prompt = example.render_prompt(project);
    std::fs::write(dir.join("brief.md"), brief)?;
    std::fs::write(dir.join("prompt.md"), prompt)?;
    Ok(dir)
}

pub fn design_root(root: &Path) -> PathBuf {
    root.join(".sacode").join("design")
}
