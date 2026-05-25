use anyhow::Result;
use serde::{Deserialize, Serialize};
use std::{fs, path::{Path, PathBuf}};

const PROJECT_SKILLS_DIR: &str = ".sacode/skills";
const SKILLS_DIR: &str = "skills";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SkillSpec {
    pub name: String,
    pub description: String,
    pub prompt: String,
    pub path: PathBuf,
}

#[derive(Debug, Clone)]
pub struct SkillRegistry {
    project_root: PathBuf,
    workspace_root: PathBuf,
}

impl SkillRegistry {
    pub fn new(workdir: &Path) -> Self {
        Self {
            project_root: workdir.join(PROJECT_SKILLS_DIR),
            workspace_root: workdir.join(SKILLS_DIR),
        }
    }

    pub fn ensure_defaults(&self) -> Result<()> {
        fs::create_dir_all(&self.workspace_root)?;

        for (name, description, prompt) in default_skills() {
            let path = self.workspace_root.join(format!("{}.md", name));
            if !path.exists() {
                let body = format!(
                    "# {name}\n\nDescription: {description}\n\n## Prompt\n\n{prompt}\n"
                );
                fs::write(path, body)?;
            }
        }

        Ok(())
    }

    pub fn list(&self) -> Result<Vec<SkillSpec>> {
        self.ensure_defaults()?;
        let mut skills = std::collections::BTreeMap::new();

        self.collect_skills_from_dir(&self.workspace_root, &mut skills)?;
        self.collect_skills_from_dir(&self.project_root, &mut skills)?;

        Ok(skills.into_values().collect())
    }

    pub fn get(&self, name: &str) -> Result<SkillSpec> {
        let skills = self.list()?;
        skills
            .into_iter()
            .find(|skill| skill.name == name)
            .ok_or_else(|| anyhow::anyhow!("skill not found: {}", name))
    }

    pub fn render_prompt(&self, name: &str, args: &str, workdir: &Path) -> Result<String> {
        let skill = self.get(name)?;
        Ok(skill
            .prompt
            .replace("{{args}}", args)
            .replace("{{cwd}}", &workdir.display().to_string())
            .replace("{{skill_name}}", &skill.name)
            .replace("{{description}}", &skill.description))
    }

    pub fn save_project_skill(&self, name: &str, description: &str, prompt: &str) -> Result<PathBuf> {
        fs::create_dir_all(&self.project_root)?;
        let path = self.project_root.join(format!("{}.md", name.trim()));
        let body = format!(
            "# {}\n\nDescription: {}\n\n## Prompt\n\n{}\n",
            name.trim(),
            description.trim(),
            prompt.trim()
        );
        fs::write(&path, body)?;
        Ok(path)
    }

    pub fn remove_project_skill(&self, name: &str) -> Result<()> {
        let path = self.project_root.join(format!("{}.md", name.trim()));
        if !path.exists() {
            anyhow::bail!("project skill not found: {}", name);
        }
        fs::remove_file(path)?;
        Ok(())
    }

    fn collect_skills_from_dir(
        &self,
        dir: &Path,
        skills: &mut std::collections::BTreeMap<String, SkillSpec>,
    ) -> Result<()> {
        if !dir.exists() {
            return Ok(());
        }

        for entry in fs::read_dir(dir)? {
            let entry = entry?;
            let path = entry.path();
            if path.extension().and_then(|ext| ext.to_str()) != Some("md") {
                continue;
            }

            let content = fs::read_to_string(&path)?;
            let skill = parse_skill_file(&path, &content);
            skills.insert(skill.name.clone(), skill);
        }

        Ok(())
    }
}

fn parse_skill_file(path: &Path, content: &str) -> SkillSpec {
    let default_name = path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("unknown")
        .to_string();

    let mut name = default_name;
    let mut description = String::new();
    let mut prompt = String::new();
    let mut in_prompt = false;

    for line in content.lines() {
        if let Some(rest) = line.strip_prefix("# ") {
            name = rest.trim().to_string();
            continue;
        }

        if let Some(rest) = line.strip_prefix("Description: ") {
            description = rest.trim().to_string();
            continue;
        }

        if line.trim() == "## Prompt" {
            in_prompt = true;
            continue;
        }

        if in_prompt {
            if !prompt.is_empty() {
                prompt.push('\n');
            }
            prompt.push_str(line);
        }
    }

    SkillSpec {
        name,
        description,
        prompt: prompt.trim().to_string(),
        path: path.to_path_buf(),
    }
}

fn default_skills() -> Vec<(&'static str, &'static str, &'static str)> {
    vec![
        (
            "commit",
            "生成提交信息并总结当前变更",
            "阅读当前工作区改动，生成简洁提交信息，并给出建议的提交摘要。",
        ),
        (
            "review-pr",
            "审查当前改动并输出风险与建议",
            "从代码审查视角分析当前变更，优先输出 bug、风险、回归点和测试缺口。",
        ),
        (
            "explain",
            "解释当前代码或模块",
            "结合当前工作区上下文，解释用户指定文件、模块或函数的职责和执行流程。",
        ),
    ]
}
