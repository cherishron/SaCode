//! AI 设计变体：provider 调用 + JSON 解析 + 变体落盘。

use anyhow::{anyhow, bail, Context, Result};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

use crate::provider::ProviderClient;
use sacode_kernel::model::ModelProvider;

use super::examples::design_example;

/// meta.json 字段（变体元数据）。
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct DesignVariantMeta {
    pub id: String,
    pub title: String,
    pub focus: String,
    pub components: Vec<String>,
    pub diff_from_base: String,
}

/// 一个设计变体：元数据 + brief/prompt 文本。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DesignVariant {
    pub meta: DesignVariantMeta,
    pub brief: String,
    pub prompt: String,
}

/// 模型原始输出（字段均可缺省，便于容错解析）。
#[derive(Debug, Clone, Default, Deserialize)]
struct RawVariant {
    #[serde(default)]
    title: String,
    #[serde(default)]
    focus: String,
    #[serde(default)]
    components: Vec<String>,
    #[serde(default)]
    diff_from_base: String,
    #[serde(default)]
    brief: String,
    #[serde(default)]
    prompt: String,
}

const MAX_VARIANTS: usize = 3;
const PROJECT_CONTEXT_CHARS: usize = 1500;

/// Normalize `"1" | "variant-1" | "variant1" | "v1"` → `"1"`.
pub fn normalize_variant_id(raw: &str) -> Option<String> {
    let s = raw.trim().to_ascii_lowercase();
    if s.is_empty() {
        return None;
    }
    let n = s
        .strip_prefix("variant-")
        .or_else(|| s.strip_prefix("variant"))
        .or_else(|| s.strip_prefix("v"))
        .unwrap_or(s.as_str());
    let n = n.trim().trim_start_matches('-');
    let num: usize = n.parse().ok()?;
    if num == 0 {
        return None;
    }
    Some(num.to_string())
}

/// Strip markdown code fences, if any.
pub fn strip_code_fences(text: &str) -> String {
    let t = text.trim();
    let t = if t.starts_with("```") {
        let after = t.trim_start_matches('`');
        // drop optional language tag on first line
        let nl = after.find('\n').map(|i| i + 1).unwrap_or(after.len());
        &after[nl..]
    } else {
        t
    };
    let t = t.trim_end();
    let t = if t.ends_with("```") {
        t.trim_end_matches('`')
    } else {
        t
    };
    t.trim().to_string()
}

/// Extract first balanced JSON array from free-form model text.
pub fn extract_json_array(text: &str) -> Option<String> {
    let cleaned = strip_code_fences(text);
    let bytes = cleaned.as_bytes();
    let mut start = None;
    for (i, b) in bytes.iter().enumerate() {
        if *b == b'[' {
            start = Some(i);
            break;
        }
    }
    let start = start?;
    let mut depth = 0usize;
    let mut in_str = false;
    let mut escape = false;
    for (i, b) in bytes.iter().enumerate().skip(start) {
        if escape {
            escape = false;
            continue;
        }
        match b {
            b'\\' if in_str => escape = true,
            b'"' => in_str = !in_str,
            b'[' if !in_str => depth += 1,
            b']' if !in_str => {
                if depth == 0 {
                    return None;
                }
                depth -= 1;
                if depth == 0 {
                    return Some(cleaned[start..=i].to_string());
                }
            }
            _ => {}
        }
    }
    // fallback: rfind
    if let Some(end) = cleaned.rfind(']') {
        if end > start {
            return Some(cleaned[start..=end].to_string());
        }
    }
    None
}

fn render_variant_brief(
    example_title: &str,
    project: &str,
    raw: &RawVariant,
    variant_id: &str,
) -> String {
    let mut md = String::new();
    md.push_str(&format!("# {} — {}\n\n", raw.title.trim(), project));
    md.push_str(&format!(
        "> 变体 ID: `{variant_id}` · 基于示例 `{example_title}`\n\n"
    ));
    if !raw.focus.trim().is_empty() {
        md.push_str(&format!("**设计侧重**：{}\n\n", raw.focus.trim()));
    }
    if !raw.components.is_empty() {
        md.push_str("## 建议组件（TDesign 风格）\n\n");
        for c in &raw.components {
            md.push_str(&format!("- `{c}`\n"));
        }
        md.push('\n');
    }
    if !raw.diff_from_base.trim().is_empty() {
        md.push_str("## 相对基准的差异\n\n");
        md.push_str(&format!("- {}\n\n", raw.diff_from_base.trim()));
    }
    md.push_str("## 产出说明\n\n");
    md.push_str("- 本文件为 AI 设计变体简报，可直接给设计师/后续 AI UI 任务使用。\n");
    md.push_str("- 配套 `prompt.md` 可作为生成 UI 骨架的任务提示词。\n");
    md
}

fn render_variant_prompt(
    example_title: &str,
    example_summary: &str,
    project: &str,
    raw: &RawVariant,
) -> String {
    if !raw.prompt.trim().is_empty() {
        return raw.prompt.trim().to_string() + "\n";
    }
    format!(
        "为「{project}」生成 {title} 的 UI 骨架（设计变体）。\n\n\
         设计风格：TDesign（简洁、信息密度适中、主色强调操作）。\n\
         侧重：{focus}\n\
         场景：{summary}\n\
         建议组件：{components}\n\
         相对基准差异：{diff}\n\n\
         要求：\n1. 使用语义化 HTML 或常见前端组件结构；\n2. 体现交互状态（空态/加载/错误）；\n3. 不要发明与场景无关的模块。\n",
        project = project,
        title = if raw.title.trim().is_empty() {
            example_title
        } else {
            raw.title.trim()
        },
        focus = if raw.focus.trim().is_empty() {
            "见变体简报"
        } else {
            raw.focus.trim()
        },
        summary = example_summary,
        components = if raw.components.is_empty() {
            "（见基准示例）".to_string()
        } else {
            raw.components.join(", ")
        },
        diff = if raw.diff_from_base.trim().is_empty() {
            "见变体简报"
        } else {
            raw.diff_from_base.trim()
        },
    )
}

/// Parse model output into variant structs. Pure (no I/O).
///
/// Accepts markdown-fenced or bare JSON arrays. Fails if no valid array /
/// zero usable variants. Empty title or focus → variant skipped.
pub fn parse_design_variants(
    text: &str,
    example_id: &str,
    example_title: &str,
    example_summary: &str,
    project: &str,
    count: usize,
) -> Result<Vec<DesignVariant>> {
    let json = extract_json_array(text)
        .ok_or_else(|| anyhow!("模型输出中未找到 JSON 数组，无法解析设计变体"))?;
    let raws: Vec<RawVariant> = serde_json::from_str(&json)
        .with_context(|| format!("解析设计变体 JSON 失败: {}", truncate(&json, 400)))?;

    let count = count.clamp(1, MAX_VARIANTS);
    let mut out = Vec::new();
    for raw in raws.into_iter().take(count) {
        if raw.title.trim().is_empty() || raw.focus.trim().is_empty() {
            continue;
        }
        let n = out.len() + 1;
        let variant_id = format!("variant-{n}");
        let brief = if raw.brief.trim().is_empty() {
            render_variant_brief(example_title, project, &raw, &variant_id)
        } else {
            raw.brief.trim().to_string() + "\n"
        };
        let prompt = render_variant_prompt(example_title, example_summary, project, &raw);
        out.push(DesignVariant {
            meta: DesignVariantMeta {
                id: variant_id,
                title: raw.title.trim().to_string(),
                focus: raw.focus.trim().to_string(),
                components: raw
                    .components
                    .iter()
                    .map(|c| c.trim().to_string())
                    .filter(|c| !c.is_empty())
                    .collect(),
                diff_from_base: raw.diff_from_base.trim().to_string(),
            },
            brief,
            prompt,
        });
    }
    if out.is_empty() {
        bail!("模型输出的变体均无效（至少需要非空 title 与 focus），已取消写入");
    }
    let _ = example_id;
    Ok(out)
}

fn truncate(s: &str, n: usize) -> String {
    if s.chars().count() <= n {
        s.to_string()
    } else {
        s.chars().take(n).collect::<String>() + "…"
    }
}

fn load_project_context(root: &Path) -> Option<String> {
    for name in ["AGENTS.md", "README.md"] {
        let p = root.join(name);
        if let Ok(content) = std::fs::read_to_string(&p) {
            let trimmed = content.trim();
            if trimmed.is_empty() {
                continue;
            }
            let snippet: String = trimmed.chars().take(PROJECT_CONTEXT_CHARS).collect();
            return Some(format!("（来自 {name}）\n{snippet}"));
        }
    }
    None
}

/// Build the model prompt for design variants (exported for tests).
pub fn build_variants_prompt(
    example_id: &str,
    example_title: &str,
    example_summary: &str,
    components: &[&str],
    layout_notes: &[&str],
    design_tokens: &[(&str, &str)],
    project: Option<&str>,
    context: Option<&str>,
    count: usize,
) -> String {
    let count = count.clamp(1, MAX_VARIANTS);
    let project_label = project.unwrap_or("本项目");
    let mut prompt = String::new();
    prompt.push_str("你是 UI/UX 设计助手，基于 TDesign 风格生成设计变体简报。\n");
    prompt.push_str("只输出设计简报与任务提示词，不要生成 TSX/前端代码。\n\n");
    prompt.push_str("## 基准示例\n");
    prompt.push_str(&format!("- ID: {example_id}\n"));
    prompt.push_str(&format!("- 名称: {example_title}\n"));
    prompt.push_str(&format!("- 场景: {example_summary}\n"));
    prompt.push_str(&format!("- 组件: {}\n", components.join(", ")));
    prompt.push_str(&format!("- 布局: {}\n", layout_notes.join("；")));
    if !design_tokens.is_empty() {
        let tokens: Vec<String> = design_tokens
            .iter()
            .map(|(k, v)| format!("{k}={v}"))
            .collect();
        prompt.push_str(&format!("- Token: {}\n", tokens.join(", ")));
    }
    prompt.push_str("\n## 项目\n");
    prompt.push_str(&format!("- 名称: {project_label}\n"));
    if let Some(ctx) = context {
        prompt.push_str(&format!("- 上下文摘要:\n{ctx}\n"));
    }
    prompt.push_str(&format!(
        "\n## 任务\n生成 {count} 个与基准不同的设计变体（侧重点可区分：信息密度、动线、视觉层级、组件组合等）。\n"
    ));
    prompt.push_str(
        "每个变体包含字段：
- title: 变体名称（中文，简短）
- focus: 设计侧重点（一句话）
- components: TDesign 风格组件名数组
- diff_from_base: 相对基准的差异说明
- brief: 设计简报 markdown（组件、布局要点、token 建议）
- prompt: 生成 UI 骨架的任务提示词

## 输出格式
只输出 JSON 数组，不要 markdown 代码块，不要额外说明：
[{\"title\":\"...\",\"focus\":\"...\",\"components\":[\"...\"],\"diff_from_base\":\"...\",\"brief\":\"...\",\"prompt\":\"...\"}]
",
    );
    prompt
}

/// Generate 1–3 design variants via the current ModelProvider and write them under
/// `.sacode/design/<id>/variants/variant-<n>/`.
///
/// Returns a human-readable summary of written paths.
pub async fn generate_design_variants(
    root: &Path,
    example_id: &str,
    project: Option<&str>,
    provider: Option<&ModelProvider>,
    count: usize,
) -> Result<String> {
    let example = design_example(example_id)
        .ok_or_else(|| anyhow!("unknown design example id: {example_id}（sacode design list）"))?;
    let count = count.clamp(1, MAX_VARIANTS);
    let provider = provider.ok_or_else(|| {
        anyhow!(
            "未配置模型 provider，无法生成设计变体。\
             请先执行 `sacode account login`，或在 `.sacode/provider.json` / 配置中设置 provider。"
        )
    })?;

    let project_label = project.unwrap_or("本项目");
    let context = load_project_context(root);
    let prompt = build_variants_prompt(
        example.id,
        example.title,
        example.summary,
        example.components,
        example.layout_notes,
        example.design_tokens,
        project,
        context.as_deref(),
        count,
    );

    let client = ProviderClient::new();
    let text = client
        .simple_chat(provider, &prompt)
        .await
        .context("调用模型生成设计变体失败")?;

    let variants = parse_design_variants(
        &text,
        example.id,
        example.title,
        example.summary,
        project_label,
        count,
    )?;

    // Only write after full parse success — no half-empty variants on disk as success.
    let base_dir = root
        .join(".sacode")
        .join("design")
        .join(example.id)
        .join("variants");
    std::fs::create_dir_all(&base_dir)?;

    let mut lines = Vec::new();
    for v in &variants {
        let dir = base_dir.join(&v.meta.id);
        std::fs::create_dir_all(&dir)?;
        std::fs::write(dir.join("brief.md"), &v.brief)?;
        std::fs::write(dir.join("prompt.md"), &v.prompt)?;
        let meta_json = serde_json::to_string_pretty(&v.meta)?;
        std::fs::write(dir.join("meta.json"), meta_json)?;
        lines.push(format!(
            "  {}  {}\n    brief: {}\n    prompt: {}\n    meta : {}",
            v.meta.id,
            v.meta.title,
            dir.join("brief.md").display(),
            dir.join("prompt.md").display(),
            dir.join("meta.json").display(),
        ));
    }

    let mut msg = format!(
        "已生成 {} 个设计变体（{} / {}）:\n{}\nApply: sacode design apply {} --variant 1",
        variants.len(),
        example.id,
        project_label,
        lines.join("\n"),
        example.id
    );
    msg = truncate_utf8(&msg, 4000);
    Ok(msg)
}

/// Byte-safe UTF-8 truncate (never panics on multi-byte boundaries).
fn truncate_utf8(s: &str, max_bytes: usize) -> String {
    if s.len() <= max_bytes {
        return s.to_string();
    }
    let mut end = max_bytes;
    while end > 0 && !s.is_char_boundary(end) {
        end -= 1;
    }
    s[..end].to_string()
}

/// Copy a generated variant's brief+prompt into the design root (keep `variants/`).
///
/// `variant` accepts `"1"`, `"variant-1"`, `"v1"`.
/// `out_root` is the design library root; default `root/.sacode/design`.
pub fn apply_design_variant(
    root: &Path,
    example_id: &str,
    variant: &str,
    project: Option<&str>,
) -> Result<PathBuf> {
    apply_design_variant_out(root, example_id, variant, project, None)
}

pub fn apply_design_variant_out(
    root: &Path,
    example_id: &str,
    variant: &str,
    project: Option<&str>,
    out_root: Option<&Path>,
) -> Result<PathBuf> {
    if design_example(example_id).is_none() {
        bail!("unknown design example id: {example_id}（sacode design list）");
    }
    let n = normalize_variant_id(variant)
        .ok_or_else(|| anyhow!("无效的 variant 参数: {variant}（可用: 1 / variant-1 / v1）"))?;
    let library = resolve_design_library(root, out_root);
    let variant_dir = library
        .join(example_id)
        .join("variants")
        .join(format!("variant-{n}"));
    if !variant_dir.is_dir() {
        bail!(
            "未找到设计变体 variant-{n}（示例 {example_id}）。\
             请先运行: sacode design variants {example_id}\
             {}",
            project
                .map(|p| format!(" --project {p}"))
                .unwrap_or_default()
        );
    }
    let brief_src = variant_dir.join("brief.md");
    let prompt_src = variant_dir.join("prompt.md");
    if !brief_src.is_file() || !prompt_src.is_file() {
        bail!("设计变体 variant-{n} 文件不完整（缺 brief.md 或 prompt.md），请重新生成变体");
    }
    let dir = library.join(example_id);
    std::fs::create_dir_all(&dir)?;
    std::fs::copy(&brief_src, dir.join("brief.md"))?;
    std::fs::copy(&prompt_src, dir.join("prompt.md"))?;
    Ok(dir)
}

fn resolve_design_library(root: &Path, out_root: Option<&Path>) -> PathBuf {
    match out_root {
        Some(p) if p.is_absolute() => p.to_path_buf(),
        Some(p) => root.join(p),
        None => root.join(".sacode").join("design"),
    }
}

/// Read a written variant's meta.json (for tests / tooling).
pub fn read_variant_meta(
    root: &Path,
    example_id: &str,
    variant: &str,
) -> Result<DesignVariantMeta> {
    let n =
        normalize_variant_id(variant).ok_or_else(|| anyhow!("无效的 variant 参数: {variant}"))?;
    let path = root
        .join(".sacode")
        .join("design")
        .join(example_id)
        .join("variants")
        .join(format!("variant-{n}"))
        .join("meta.json");
    let text = std::fs::read_to_string(&path)
        .with_context(|| format!("读取 meta.json 失败: {}", path.display()))?;
    let meta: DesignVariantMeta = serde_json::from_str(&text)
        .with_context(|| format!("解析 meta.json 失败: {}", path.display()))?;
    Ok(meta)
}

#[cfg(test)]
mod tests {
    use super::*;

    const MOCK_JSON: &str = r##"```json
[
  {
    "title": "高密度监控",
    "focus": "信息密度优先，一屏看全关键指标",
    "components": ["Card", "Statistic", "Table"],
    "diff_from_base": "指标卡改为紧凑网格，表格默认展开筛选",
    "brief": "高密度监控简报：侧重吞吐与时延。",
    "prompt": "为项目生成高密度监控看板 UI 骨架。"
  },
  {
    "title": "引导式看板",
    "focus": "新手友好，分步引导完成首次配置",
    "components": ["Card", "Button", "Steps"],
    "diff_from_base": "增加引导步骤与空态插画",
    "brief": "",
    "prompt": ""
  },
  {
    "title": "",
    "focus": "无效条目",
    "components": [],
    "diff_from_base": "",
    "brief": "",
    "prompt": ""
  }
]
```"##;

    #[test]
    fn normalize_accepts_common_forms() {
        assert_eq!(normalize_variant_id("1").as_deref(), Some("1"));
        assert_eq!(normalize_variant_id("variant-1").as_deref(), Some("1"));
        assert_eq!(normalize_variant_id("variant1").as_deref(), Some("1"));
        assert_eq!(normalize_variant_id("v1").as_deref(), Some("1"));
        assert_eq!(normalize_variant_id("V-2").as_deref(), Some("2"));
        assert!(normalize_variant_id("0").is_none());
        assert!(normalize_variant_id("abc").is_none());
        assert!(normalize_variant_id("").is_none());
    }

    #[test]
    fn strip_fences_and_extract_array() {
        let arr = extract_json_array(MOCK_JSON).expect("array");
        assert!(arr.trim_start().starts_with('['));
        assert!(arr.trim_end().ends_with(']'));
        let bare = "[{\"title\":\"a\",\"focus\":\"b\"}]";
        assert_eq!(extract_json_array(bare).as_deref(), Some(bare));
        assert!(extract_json_array("no json here").is_none());
    }

    #[test]
    fn parse_mock_variants_skips_invalid_and_fills_brief_prompt() {
        let vs = parse_design_variants(
            MOCK_JSON,
            "td-dashboard",
            "数据看板",
            "运营看板",
            "DemoApp",
            3,
        )
        .expect("parse");
        // third entry has empty title → skipped
        assert_eq!(vs.len(), 2);
        assert_eq!(vs[0].meta.id, "variant-1");
        assert_eq!(vs[0].meta.title, "高密度监控");
        assert!(vs[0].meta.components.contains(&"Table".to_string()));
        assert!(vs[0].brief.contains("高密度监控"));
        assert!(vs[0].prompt.contains("高密度监控"));
        assert_eq!(vs[1].meta.id, "variant-2");
        // empty brief/prompt in raw → rendered from fields
        assert!(vs[1].brief.contains("引导式看板"));
        assert!(
            vs[1].brief.contains("TDesign")
                || vs[1].prompt.contains("TDesign")
                || vs[1].prompt.contains("UI")
        );
        assert!(vs[1].prompt.contains("DemoApp"));
    }

    #[test]
    fn parse_count_clamped_to_one() {
        let vs =
            parse_design_variants(MOCK_JSON, "td-dashboard", "数据看板", "场景", "P", 1).unwrap();
        assert_eq!(vs.len(), 1);
    }

    #[test]
    fn parse_rejects_garbage() {
        assert!(parse_design_variants("hello", "id", "t", "s", "p", 3).is_err());
        assert!(parse_design_variants("[]", "id", "t", "s", "p", 3).is_err());
        assert!(parse_design_variants(
            "[{\"title\":\"\",\"focus\":\"x\"}]",
            "id",
            "t",
            "s",
            "p",
            3
        )
        .is_err());
    }

    #[tokio::test]
    async fn generate_without_provider_errors() {
        let tmp = tempfile::tempdir().unwrap();
        let err = generate_design_variants(tmp.path(), "td-dashboard", Some("X"), None, 3)
            .await
            .expect_err("must fail without provider");
        let msg = format!("{err:#}");
        assert!(
            msg.contains("provider") || msg.contains("account login") || msg.contains("login"),
            "unexpected error: {msg}"
        );
        // must not write variants dir as success
        assert!(!tmp
            .path()
            .join(".sacode/design/td-dashboard/variants")
            .exists());
    }

    #[test]
    fn generate_unknown_example_errors() {
        // unknown id is checked before provider; still async — use runtime
        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        let tmp = tempfile::tempdir().unwrap();
        let err = rt
            .block_on(generate_design_variants(tmp.path(), "nope", None, None, 3))
            .expect_err("unknown id");
        assert!(format!("{err}").contains("unknown design example"));
    }

    #[test]
    fn apply_design_variant_normalizes_and_copies() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path();
        let vdir = root.join(".sacode/design/td-dashboard/variants/variant-2");
        std::fs::create_dir_all(&vdir).unwrap();
        std::fs::write(vdir.join("brief.md"), "# B2\n").unwrap();
        std::fs::write(vdir.join("prompt.md"), "P2\n").unwrap();
        std::fs::write(
            vdir.join("meta.json"),
            r#"{"id":"variant-2","title":"T","focus":"F","components":[],"diff_from_base":"D"}"#,
        )
        .unwrap();

        for form in ["2", "variant-2", "v2"] {
            let dir = apply_design_variant(root, "td-dashboard", form, None)
                .unwrap_or_else(|e| panic!("apply {form}: {e}"));
            assert_eq!(dir, root.join(".sacode/design/td-dashboard"));
            assert_eq!(
                std::fs::read_to_string(dir.join("brief.md")).unwrap(),
                "# B2\n"
            );
            assert_eq!(
                std::fs::read_to_string(dir.join("prompt.md")).unwrap(),
                "P2\n"
            );
            // variants/ kept
            assert!(vdir.join("meta.json").exists());
        }

        let meta = read_variant_meta(root, "td-dashboard", "v2").unwrap();
        assert_eq!(meta.id, "variant-2");
        assert_eq!(meta.title, "T");
    }

    #[test]
    fn apply_missing_variant_and_unknown_example_error() {
        let tmp = tempfile::tempdir().unwrap();
        let err = apply_design_variant(tmp.path(), "td-dashboard", "1", None)
            .expect_err("missing variant");
        assert!(format!("{err}").contains("variant-1"));
        assert!(format!("{err}").contains("variants"));

        let err = apply_design_variant(tmp.path(), "nope", "1", None).expect_err("unknown example");
        assert!(format!("{err}").contains("unknown design example"));

        let err = apply_design_variant(tmp.path(), "td-dashboard", "xyz", None)
            .expect_err("bad variant form");
        assert!(format!("{err}").contains("无效的 variant"));
    }

    #[test]
    fn build_prompt_includes_project_and_context() {
        let p = build_variants_prompt(
            "td-dashboard",
            "数据看板",
            "指标",
            &["Card"],
            &["顶部指标卡"],
            &[("primary", "blue")],
            Some("MyApp"),
            Some("（来自 README.md）\nhello"),
            2,
        );
        assert!(p.contains("MyApp"));
        assert!(p.contains("README.md"));
        assert!(p.contains("td-dashboard"));
        assert!(p.contains("2 个"));
        assert!(p.contains("JSON"));
    }
}
