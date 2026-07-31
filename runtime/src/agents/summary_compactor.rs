//! 灵枢 · 自防护 — 摘要压缩与冲突检测
//!
//! 核心模块：多角色输出聚合、冲突检测与识别
//! 对应 AGENTS.md 中「自防护 — 五维冲突检测」
//!
//! 设计理念源自《黄帝内经》诊察经脉病候的隐喻：
//! - 识别冲突如同诊脉，发现异常信号
//! - 五维检测：语义一致性、风险信号、上下文完整性、执行状态、建议有效性

pub fn compact_aggregate_output(output: &str) -> String {
    let trimmed = output.trim();
    if trimmed.is_empty() {
        return String::new();
    }

    if let Some(risk_summary) = extract_risk_summary(trimmed) {
        return risk_summary;
    }

    if let (Some(first_sentence), Some(consensus)) = (
        first_summary_sentence(trimmed),
        extract_final_consensus(trimmed),
    ) {
        let first_sentence = first_sentence.trim();
        let consensus = consensus.trim();
        if first_sentence != consensus
            && first_sentence.chars().count() >= 12
            && is_generic_completion_sentence(consensus)
        {
            return first_sentence.to_string();
        }
    }

    if let Some(consensus) = extract_final_consensus(trimmed) {
        let consensus = consensus.trim();
        if !consensus.is_empty() {
            return consensus.to_string();
        }
    }

    trimmed
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .unwrap_or(trimmed)
        .to_string()
}

pub fn compact_conflict_detail(detail: &str) -> String {
    let trimmed = detail.trim();
    if trimmed.is_empty() {
        return String::new();
    }

    if (trimmed.contains('=') || trimmed.contains('/'))
        && !trimmed.contains(' ')
        && !trimmed.contains('\n')
        && !trimmed.contains('。')
        && !trimmed.contains('.')
    {
        return trimmed.to_string();
    }

    if let Some(risk_summary) = extract_risk_summary(trimmed) {
        return risk_summary;
    }

    if let Some(consensus) = extract_final_consensus(trimmed) {
        let consensus = consensus.trim();
        if !consensus.is_empty() {
            return consensus.to_string();
        }
    }

    trimmed
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .unwrap_or(trimmed)
        .to_string()
}

pub fn consensus_output(output: &str) -> Option<String> {
    if let Some(consensus) = extract_final_consensus(output) {
        return normalized_output(consensus);
    }
    normalized_output(output)
}

pub fn detect_output_polarity(output: &str) -> Option<OutputPolarity> {
    let normalized = output.to_lowercase();
    let negative_signals = [
        "fail",
        "failed",
        "failure",
        "error",
        "cannot",
        "can't",
        "unable",
        "blocked",
        "regression",
        "broken",
        "conflict",
        "风险",
        "失败",
        "错误",
        "阻塞",
        "回归",
        "冲突",
    ];
    if negative_signals
        .iter()
        .any(|signal| normalized.contains(signal))
    {
        return Some(OutputPolarity::Negative);
    }

    let positive_signals = [
        "pass",
        "passed",
        "success",
        "successful",
        "done",
        "completed",
        "ready",
        "approved",
        "looks good",
        "完成",
        "通过",
        "成功",
        "可用",
        "已修复",
    ];
    if positive_signals
        .iter()
        .any(|signal| normalized.contains(signal))
    {
        return Some(OutputPolarity::Positive);
    }

    None
}

pub fn extract_final_consensus(output: &str) -> Option<&str> {
    output
        .rsplit_once('。')
        .map(|(_, tail)| tail.trim())
        .filter(|tail| !tail.is_empty())
        .or_else(|| {
            output
                .rsplit_once('.')
                .map(|(_, tail)| tail.trim())
                .filter(|tail| !tail.is_empty())
        })
        .filter(|tail| {
            tail.contains("任务完成")
                || tail.contains("完成")
                || tail.contains("失败")
                || tail.contains("阻塞")
                || tail.contains("error")
                || tail.contains("failed")
        })
}

pub fn extract_risk_summary(output: &str) -> Option<String> {
    let trimmed = output.trim();
    if trimmed.is_empty() {
        return None;
    }

    let lowered = trimmed.to_lowercase();
    let risk_signals = [
        "风险",
        "阻塞",
        "失败",
        "错误",
        "冲突",
        "回归",
        "risk",
        "blocked",
        "failed",
        "error",
        "conflict",
        "regression",
    ];
    if !risk_signals.iter().any(|signal| lowered.contains(signal)) {
        return None;
    }

    let sentence = trimmed
        .split(['\n', '。', '.', ';', '；', '!', '！', '?', '？'])
        .map(str::trim)
        .find(|segment| {
            let lowered = segment.to_lowercase();
            !segment.is_empty() && risk_signals.iter().any(|signal| lowered.contains(signal))
        })
        .unwrap_or(trimmed);

    let sentence = sentence
        .strip_prefix("- ")
        .or_else(|| sentence.strip_prefix("* "))
        .unwrap_or(sentence)
        .trim();

    let sentence = ["但", "不过", "然而", " but ", " however "]
        .iter()
        .find_map(|marker| sentence.find(marker).map(|index| sentence[index..].trim()))
        .filter(|value| !value.is_empty())
        .unwrap_or(sentence);

    if sentence.is_empty() {
        return None;
    }

    Some(sentence.to_string())
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OutputPolarity {
    Positive,
    Negative,
}

impl OutputPolarity {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Positive => "positive",
            Self::Negative => "negative",
        }
    }
}

fn first_summary_sentence(output: &str) -> Option<&str> {
    output
        .split(['\n', '。', '.', ';', '；', '!', '！', '?', '？'])
        .map(str::trim)
        .find(|segment| !segment.is_empty())
}

fn is_generic_completion_sentence(sentence: &str) -> bool {
    let trimmed = sentence.trim();
    trimmed.contains("任务完成")
        || trimmed == "完成"
        || trimmed == "已完成"
        || trimmed == "规划完成，等待执行"
}

fn normalized_output(output: &str) -> Option<String> {
    let extracted = output
        .split_once("final=")
        .map(|(_, tail)| tail)
        .unwrap_or(output);
    let extracted = extracted
        .split_once("结论：")
        .map(|(_, tail)| tail)
        .unwrap_or(extracted);
    let normalized = extracted.split_whitespace().collect::<Vec<_>>().join(" ");
    if normalized.is_empty() {
        None
    } else {
        Some(normalized)
    }
}

#[cfg(test)]
mod tests {
    use super::{compact_aggregate_output, compact_conflict_detail, extract_risk_summary};

    #[test]
    fn extract_risk_summary_returns_compact_sentence() {
        let risk =
            extract_risk_summary("任务完成，但存在回归风险。建议补充验证步骤。后续可继续推进。");
        assert_eq!(risk.as_deref(), Some("但存在回归风险"));
    }

    #[test]
    fn extract_risk_summary_handles_multiline_output() {
        let risk = extract_risk_summary("已完成检查\n阻塞点：接口鉴权失败\n建议补充凭证配置");
        assert_eq!(risk.as_deref(), Some("阻塞点：接口鉴权失败"));
    }

    #[test]
    fn extract_risk_summary_handles_mixed_language_failure() {
        let risk = extract_risk_summary(
            "Validation finished, but failed due to missing token. Please refresh credentials.",
        );
        assert_eq!(risk.as_deref(), Some("but failed due to missing token"));
    }

    #[test]
    fn extract_risk_summary_handles_review_style_findings() {
        let risk = extract_risk_summary(
            "Review completed. Findings: auth regression risk remains in retry path. Recommend adding coverage.",
        );
        assert_eq!(
            risk.as_deref(),
            Some("Findings: auth regression risk remains in retry path")
        );
    }

    #[test]
    fn compact_conflict_detail_prefers_risk_sentence() {
        let detail =
            compact_conflict_detail("任务完成，但存在回归风险。建议补充验证。后续继续推进。");
        assert_eq!(detail, "但存在回归风险");
    }

    #[test]
    fn compact_conflict_detail_prefers_final_consensus() {
        let detail = compact_conflict_detail("前置分析已完成。任务完成，共完成 5 个步骤");
        assert_eq!(detail, "任务完成，共完成 5 个步骤");
    }

    #[test]
    fn compact_aggregate_output_prefers_risk_summary() {
        let output =
            compact_aggregate_output("任务完成，但存在回归风险。建议补充验证。后续继续推进。");
        assert_eq!(output, "但存在回归风险");
    }

    #[test]
    fn compact_aggregate_output_prefers_final_consensus() {
        let output = compact_aggregate_output("前置分析已完成。任务完成，共完成 5 个步骤");
        assert_eq!(output, "任务完成，共完成 5 个步骤");
    }

    #[test]
    fn compact_aggregate_output_keeps_informative_first_sentence() {
        let output = compact_aggregate_output(
            "汇总结论已生成，完成 5 个步骤，参考了 代码读取、命令执行与差异检查。任务完成，共完成 5 个步骤",
        );
        assert_eq!(
            output,
            "汇总结论已生成，完成 5 个步骤，参考了 代码读取、命令执行与差异检查"
        );
    }

    #[test]
    fn compact_aggregate_output_keeps_failure_sentence_with_action() {
        let output = compact_aggregate_output(
            "验证失败，接口鉴权仍然阻塞发布。建议先补齐凭证配置，再重新执行回归。任务失败，存在阻塞。",
        );
        assert_eq!(output, "验证失败，接口鉴权仍然阻塞发布");
    }
}
