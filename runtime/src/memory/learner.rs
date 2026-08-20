//! 灵枢 · 学习型记忆 — 自动学习回路
//!
//! 设计目标：打通 `AutoLearned` 自动学习回路，将 session 中的经验教训自动沉淀为
//! 跨会话可复用的记忆：
//! - `extract_mistakes`：从 session 事件提取失败模式，写入 `.sacode/mistakes.json`
//! - `extract_preferences`：从用户审批行为提取偏好，写入 `preferences.md`（Candidate 状态）
//! - `extract_code_patterns`：从代码修改历史提取规范模式，写入 `workflows.md`
//!
//! 触发时机：session `compress()` 完成后自动调用 `AutoLearner::run()`。
//!
//! 安全策略：所有 AutoLearned 条目默认 `Candidate` 状态，需 `approve_memory_entry()`
//! 审批后才变为 `Active`，不直接影响行为，避免噪声记忆污染上下文。

use std::fs;
use std::path::{Path, PathBuf};

use anyhow::Result;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::{
    append_candidate_memory_entry, MemoryEntry, MemoryEntrySource, MemoryKind, MemoryScope,
    PROJECT_WIKI_DIR,
};

/// 自动学习结果汇总
#[derive(Debug, Clone, Default)]
pub struct LearnResult {
    /// 提取到的 mistakes 条数
    pub mistakes_extracted: usize,
    /// 提取到的 preferences 条数
    pub preferences_extracted: usize,
    /// 提取到的 code_patterns 条数
    pub code_patterns_extracted: usize,
    /// 提取详情（用于日志）
    pub notes: Vec<String>,
}

/// 自动学习器
pub struct AutoLearner {
    workdir: PathBuf,
    /// session 压缩后的事件摘要（或原始事件文本）
    session_events: Vec<String>,
}

impl AutoLearner {
    /// 基于 session 压缩摘要构造学习器
    pub fn from_session_summary(workdir: &Path, compressed_summary: &str) -> Self {
        Self {
            workdir: workdir.to_path_buf(),
            session_events: compressed_summary.lines().map(str::to_string).collect(),
        }
    }

    /// 基于原始事件文本构造学习器
    pub fn from_events(workdir: &Path, events: &[String]) -> Self {
        Self {
            workdir: workdir.to_path_buf(),
            session_events: events.to_vec(),
        }
    }

    /// 执行自动学习：提取 mistakes / preferences / code_patterns 并沉淀
    pub fn run(&self) -> Result<LearnResult> {
        let mut result = LearnResult::default();

        // 1. 提取 mistakes → mistakes.json
        let mistakes = self.extract_mistakes();
        for mistake in &mistakes {
            if self.append_mistake(mistake).unwrap_or(false) {
                result.mistakes_extracted += 1;
            }
        }
        if !mistakes.is_empty() {
            result
                .notes
                .push(format!("提取 {} 个失败模式", mistakes.len()));
        }

        // 2. 提取 preferences → preferences.md（Candidate）
        let preferences = self.extract_preferences();
        let prefs_path = self
            .workdir
            .join(PROJECT_WIKI_DIR)
            .join(MemoryKind::Preference.file_name());
        for pref in &preferences {
            let entry = MemoryEntry {
                kind: MemoryKind::Preference,
                scope: MemoryScope::Project,
                source: MemoryEntrySource::AutoLearned,
                content: pref.clone(),
                context: "从用户审批行为自动学习".to_string(),
            };
            let current = fs::read_to_string(&prefs_path).unwrap_or_default();
            let appended =
                append_candidate_memory_entry(&prefs_path, &current, &entry).unwrap_or(false);
            if appended {
                result.preferences_extracted += 1;
            }
        }
        if !preferences.is_empty() {
            result
                .notes
                .push(format!("提取 {} 个用户偏好", preferences.len()));
        }

        // 3. 提取 code_patterns → workflows.md（Candidate）
        let patterns = self.extract_code_patterns();
        let workflows_path = self
            .workdir
            .join(PROJECT_WIKI_DIR)
            .join(MemoryKind::Workflow.file_name());
        for pattern in &patterns {
            let entry = MemoryEntry {
                kind: MemoryKind::Workflow,
                scope: MemoryScope::Project,
                source: MemoryEntrySource::AutoLearned,
                content: pattern.clone(),
                context: "从代码修改历史自动学习".to_string(),
            };
            let current = fs::read_to_string(&workflows_path).unwrap_or_default();
            if append_candidate_memory_entry(&workflows_path, &current, &entry).unwrap_or(false) {
                result.code_patterns_extracted += 1;
            }
        }
        if !patterns.is_empty() {
            result
                .notes
                .push(format!("提取 {} 个代码规范模式", patterns.len()));
        }

        Ok(result)
    }

    /// 从 session 事件提取失败模式（测试失败、shell 错误、冲突）
    fn extract_mistakes(&self) -> Vec<MistakePattern> {
        let mut mistakes = Vec::new();
        let joined = self.session_events.join("\n");

        // 测试失败模式
        if joined.contains("test failed")
            || joined.contains("测试失败")
            || joined.contains("验证失败")
        {
            let scope = if joined.contains("回归") {
                "regression"
            } else {
                "test"
            };
            mistakes.push(MistakePattern {
                summary: "测试验证未通过，需检查实现与预期的一致性".to_string(),
                scope: scope.to_string(),
                detail: "自动从 session 压缩摘要提取".to_string(),
            });
        }

        // shell 执行错误
        if joined.contains("command failed")
            || joined.contains("命令执行失败")
            || joined.contains("exit_code != 0")
        {
            mistakes.push(MistakePattern {
                summary: "Shell 命令执行失败，需检查命令参数与执行环境".to_string(),
                scope: "shell".to_string(),
                detail: "自动从 session 压缩摘要提取".to_string(),
            });
        }

        // 冲突模式：要求同时出现 "validation_conflict" 或"验证"+"冲突"，
        // 避免误命中"内存冲突""合并冲突"等无关上下文（子串"冲突"过于宽泛）。
        let conflict_hit = joined.contains("validation_conflict")
            || (joined.contains("冲突")
                && (joined.contains("验证") || joined.contains("validation")));
        if conflict_hit {
            mistakes.push(MistakePattern {
                summary: "实现与验证存在冲突，需消解后再交付".to_string(),
                scope: "conflict".to_string(),
                detail: "自动从 session 压缩摘要提取".to_string(),
            });
        }

        mistakes
    }

    /// 从 session 事件提取用户偏好（拒绝某类操作、选择某 provider）
    fn extract_preferences(&self) -> Vec<String> {
        let mut prefs = Vec::new();
        let joined = self.session_events.join("\n");

        // provider 偏好：要求同时出现 provider 名与"优先/偏好"语境，
        // 且排除否定语境（如"xxx 模型没有优先级"），减少误判噪声。
        for provider in ["openai", "anthropic", "azure", "deepseek", "qwen"] {
            let prefer_hit = (joined.contains("优先") || joined.contains("prefer"))
                && !joined.contains("没有优先级")
                && !joined.contains("不优先")
                && !joined.contains("not prefer");
            if joined.contains(provider) && prefer_hit {
                prefs.push(format!("用户偏好使用 {} 模型", provider));
            }
        }

        // 拒绝手动修复偏好
        if joined.contains("手动修复") && joined.contains("拒绝") {
            prefs.push("用户倾向于自动修复闭环而非手动介入".to_string());
        }

        prefs
    }

    /// 从 session 事件提取代码规范模式（确定性模式优先）
    fn extract_code_patterns(&self) -> Vec<String> {
        let mut patterns = Vec::new();
        let joined = self.session_events.join("\n");

        // 缩进风格
        if joined.contains("4 空格") || joined.contains("4-space") || joined.contains("四个空格")
        {
            patterns.push("代码缩进偏好使用 4 空格".to_string());
        } else if joined.contains("tab") || joined.contains("制表符") {
            patterns.push("代码缩进偏好使用 Tab".to_string());
        }

        // 错误处理风格
        if joined.contains("Result<") && joined.contains("?") {
            patterns.push("Rust 错误处理偏好使用 Result + ? 操作符".to_string());
        }

        // 命名风格
        if joined.contains("snake_case") {
            patterns.push("命名偏好使用 snake_case".to_string());
        }

        patterns
    }

    /// 追加 mistake 到 .sacode/mistakes.json（追加模式，与现有读取兼容）
    fn append_mistake(&self, mistake: &MistakePattern) -> Result<bool> {
        let path = self.workdir.join(".sacode").join("mistakes.json");
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }

        let mut entries: Vec<Value> = if path.exists() {
            let content = std::fs::read_to_string(&path)?;
            let value: Value = serde_json::from_str(&content).unwrap_or(Value::Null);
            value
                .get("entries")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default()
        } else {
            Vec::new()
        };

        // 去重：相同 summary 不重复写入
        if entries.iter().any(|e| {
            e.get("summary")
                .and_then(Value::as_str)
                .map(|s| s == mistake.summary)
                .unwrap_or(false)
        }) {
            return Ok(false);
        }

        let entry = serde_json::json!({
            "summary": mistake.summary,
            "scope": mistake.scope,
            "detail": mistake.detail,
            "auto_learned": true,
            "created_at": chrono::Local::now().format("%Y-%m-%d").to_string(),
        });
        entries.push(entry);

        let updated = serde_json::json!({ "entries": entries });
        std::fs::write(&path, serde_json::to_string_pretty(&updated)?)?;
        Ok(true)
    }
}

/// 提取到的失败模式
#[derive(Debug, Clone, Serialize, Deserialize)]
struct MistakePattern {
    summary: String,
    scope: String,
    detail: String,
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn temp_workdir(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("sacode_learner_{}_{}", tag, unique_suffix()));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn unique_suffix() -> String {
        use std::time::{SystemTime, UNIX_EPOCH};
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_nanos().to_string())
            .unwrap_or_else(|_| "fallback".to_string())
    }

    #[test]
    fn extracts_test_failure_mistake() {
        let dir = temp_workdir("testfail");
        let learner = AutoLearner::from_session_summary(
            &dir,
            "session summary:\n- test failed during validation\n- 验证失败 in regression",
        );
        let result = learner.run().unwrap();
        assert!(result.mistakes_extracted >= 1);

        let mistakes_path = dir.join(".sacode").join("mistakes.json");
        assert!(mistakes_path.exists());
        let content = fs::read_to_string(&mistakes_path).unwrap();
        assert!(content.contains("测试验证未通过"));
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn extracts_preference_as_candidate() {
        let dir = temp_workdir("pref");
        let learner = AutoLearner::from_session_summary(
            &dir,
            "user prefers openai model for code tasks; 优先使用 anthropic",
        );
        let result = learner.run().unwrap();
        assert!(result.preferences_extracted >= 1);

        let prefs_path = dir
            .join(PROJECT_WIKI_DIR)
            .join(MemoryKind::Preference.file_name());
        assert!(prefs_path.exists());
        let content = fs::read_to_string(&prefs_path).unwrap();
        assert!(content.contains("用户偏好使用 openai 模型"));
        assert!(content.contains("[自动学习条目]"));
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn extracts_code_pattern_to_workflow() {
        let dir = temp_workdir("code");
        let learner = AutoLearner::from_session_summary(
            &dir,
            "code uses 4 空格 indentation and Result<?> error handling with snake_case naming",
        );
        let result = learner.run().unwrap();
        assert!(result.code_patterns_extracted >= 1);

        let workflow_path = dir
            .join(PROJECT_WIKI_DIR)
            .join(MemoryKind::Workflow.file_name());
        assert!(workflow_path.exists());
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn mistake_dedup_avoids_duplicate_writes() {
        let dir = temp_workdir("dedup");
        let learner = AutoLearner::from_session_summary(&dir, "test failed 验证失败");
        let first = learner.run().unwrap();
        let second = learner.run().unwrap();
        assert!(first.mistakes_extracted >= 1);
        assert_eq!(second.mistakes_extracted, 0, "重复摘要不应再次写入");

        let mistakes_path = dir.join(".sacode").join("mistakes.json");
        let content = fs::read_to_string(&mistakes_path).unwrap();
        let value: serde_json::Value = serde_json::from_str(&content).unwrap();
        let entries = value.get("entries").unwrap().as_array().unwrap();
        assert_eq!(entries.len(), 1);
        fs::remove_dir_all(&dir).ok();
    }
}
