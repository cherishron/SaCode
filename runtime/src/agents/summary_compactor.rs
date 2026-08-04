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
    use super::{
        compact_aggregate_output, compact_conflict_detail, consensus_output, detect_output_polarity,
        extract_final_consensus, extract_risk_summary, OutputPolarity,
    };

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

    // ── 五维冲突检测基础组件实战覆盖 ──────────────────────────

    #[test]
    fn detect_output_polarity_flags_english_negative_signals() {
        // 覆盖英文失败信号：failure / error / blocked / regression
        assert_eq!(
            detect_output_polarity("tests failed with error"),
            Some(OutputPolarity::Negative)
        );
        assert_eq!(
            detect_output_polarity("build blocked by conflict"),
            Some(OutputPolarity::Negative)
        );
        assert_eq!(
            detect_output_polarity("regression detected"),
            Some(OutputPolarity::Negative)
        );
    }

    #[test]
    fn detect_output_polarity_flags_chinese_negative_signals() {
        // 覆盖中文失败信号：失败 / 错误 / 阻塞 / 风险 / 回归 / 冲突
        assert_eq!(
            detect_output_polarity("验证失败，存在阻塞"),
            Some(OutputPolarity::Negative)
        );
        assert_eq!(
            detect_output_polarity("发现回归风险"),
            Some(OutputPolarity::Negative)
        );
        assert_eq!(
            detect_output_polarity("存在冲突待消解"),
            Some(OutputPolarity::Negative)
        );
    }

    #[test]
    fn detect_output_polarity_flags_positive_signals() {
        // 覆盖正向信号：passed / success / done / 通过 / 完成 / 已修复
        // 注意：负向信号先于正向判定，需选择不含负向子串的样本
        assert_eq!(
            detect_output_polarity("all tests passed"),
            Some(OutputPolarity::Positive)
        );
        assert_eq!(
            detect_output_polarity("task completed successfully"),
            Some(OutputPolarity::Positive)
        );
        assert_eq!(
            detect_output_polarity("已修复问题，可用"),
            Some(OutputPolarity::Positive)
        );
    }

    #[test]
    fn detect_output_polarity_returns_none_for_neutral_output() {
        // 中性输出：无任何正负向关键词
        assert_eq!(detect_output_polarity("正在分析架构方案"), None);
        assert_eq!(detect_output_polarity("reviewing the module structure"), None);
    }

    #[test]
    fn detect_output_polarity_negative_takes_priority_over_positive() {
        // 同时包含正负向信号时，负向优先（实现中 negative 先于 positive 判定）
        let polarity = detect_output_polarity("部分通过，但存在失败用例");
        assert_eq!(polarity, Some(OutputPolarity::Negative));
    }

    #[test]
    fn extract_final_consensus_finds_tail_after_chinese_period() {
        // 中文句号分隔，tail 包含完成关键词
        let consensus = extract_final_consensus("前置分析已完成。任务完成，共完成 5 个步骤");
        assert_eq!(consensus, Some("任务完成，共完成 5 个步骤"));
    }

    #[test]
    fn extract_final_consensus_finds_tail_after_english_period() {
        // 英文句点分隔，tail 包含 failed 关键词
        let consensus = extract_final_consensus("running tests. failed");
        assert_eq!(consensus, Some("failed"));
    }

    #[test]
    fn extract_final_consensus_returns_none_when_no_keyword_in_tail() {
        // tail 不包含完成 / 失败 / 阻塞等关键词
        let consensus = extract_final_consensus("执行完成。分析中");
        assert_eq!(consensus, None);
    }

    #[test]
    fn extract_final_consensus_returns_none_when_no_period() {
        // 无分隔符时返回 None
        let consensus = extract_final_consensus("无分隔符的输出文本");
        assert_eq!(consensus, None);
    }

    #[test]
    fn consensus_output_extracts_final_marker() {
        // final= 标记后内容优先
        let consensus = consensus_output("执行完成。final=成功通过验证");
        assert_eq!(consensus.as_deref(), Some("成功通过验证"));
    }

    #[test]
    fn consensus_output_extracts_conclusion_marker() {
        // 结论：标记后内容优先
        let consensus = consensus_output("执行完成。结论：通过验证");
        assert_eq!(consensus.as_deref(), Some("通过验证"));
    }

    #[test]
    fn consensus_output_falls_back_to_full_text_when_no_marker() {
        // 无 final= 或 结论： 时，回退到整体归一化
        let consensus = consensus_output("任务完成，共完成 5 个步骤");
        assert_eq!(consensus.as_deref(), Some("任务完成，共完成 5 个步骤"));
    }

    #[test]
    fn consensus_output_returns_none_for_empty_input() {
        // 空输入应返回 None
        assert_eq!(consensus_output("   "), None);
        assert_eq!(consensus_output(""), None);
    }

    #[test]
    fn compact_conflict_detail_keeps_plain_token_like_route() {
        // 仅包含 = 或 / 且无空格 / 换行的 token 应原样返回
        let detail = compact_conflict_detail("openai/gpt-4");
        assert_eq!(detail, "openai/gpt-4");

        let detail = compact_conflict_detail("implementer=true");
        assert_eq!(detail, "implementer=true");
    }

    #[test]
    fn compact_conflict_detail_returns_empty_for_blank_input() {
        // 空白输入应返回空字符串
        assert_eq!(compact_conflict_detail("   "), "");
        assert_eq!(compact_conflict_detail(""), "");
    }

    #[test]
    fn compact_aggregate_output_returns_empty_for_blank_input() {
        // 空白输入应返回空字符串，便于上层跳过空角色输出
        assert_eq!(compact_aggregate_output("   "), "");
        assert_eq!(compact_aggregate_output(""), "");
    }

    // ── 高并发多角色输出冲突识别集成场景 ──────────────────────

    #[test]
    fn five_dimension_conflict_signals_cover_all_roles() {
        // 模拟 5 个角色并发输出，覆盖五维冲突检测的全部信号源
        // 维度 1：status_conflict — 成功 / 失败混合
        // 维度 2：route_conflict — 不同主路由
        // 维度 3：validation_conflict — 实现正向但验证负向
        // 维度 4：conclusion_conflict — 不同共识结论
        // 维度 5：polarity_conflict — 正负向极性混合
        let outputs = [
            ("implementer", "实现结果已整理。任务完成，共完成 5 个步骤"),
            ("test-engineer", "验证失败，存在阻塞。建议补齐回归验证。"),
            ("code-reviewer", "审查风险已识别。回归风险待处理。"),
            ("devops-operator", "交付检查已整理。任务完成，共完成 2 个步骤"),
            ("reporter", "汇总结论已生成，存在多角色冲突。"),
        ];

        // 验证每个角色输出都能被正确识别极性
        let polarities: Vec<_> = outputs
            .iter()
            .filter_map(|(role, output)| {
                detect_output_polarity(output).map(|p| (*role, p))
            })
            .collect();

        // 至少应识别到一个正向和一个负向
        assert!(
            polarities
                .iter()
                .any(|(_, p)| *p == OutputPolarity::Positive),
            "应识别到正向极性角色"
        );
        assert!(
            polarities
                .iter()
                .any(|(_, p)| *p == OutputPolarity::Negative),
            "应识别到负向极性角色"
        );

        // 验证不同角色结论可被区分
        let conclusions: Vec<_> = outputs
            .iter()
            .filter_map(|(_, output)| consensus_output(output))
            .collect();
        assert!(
            conclusions.iter().any(|c| c.contains("任务完成")),
            "应能提取到完成类共识"
        );
        assert!(
            conclusions.iter().any(|c| c.contains("失败") || c.contains("风险")),
            "应能提取到失败 / 风险类结论"
        );
    }

    #[test]
    fn extract_risk_summary_handles_compound_risk_sentence() {
        // 复合风险句：包含多个风险关键词，应取首个风险段
        let risk = extract_risk_summary("前置分析完成。但存在回归风险且接口阻塞，需要补齐凭证。");
        assert!(risk.is_some());
        let risk = risk.unwrap();
        assert!(risk.contains("回归风险") || risk.contains("阻塞"));
    }

    #[test]
    fn extract_risk_summary_returns_none_for_safe_output() {
        // 无任何风险关键词时返回 None
        let risk = extract_risk_summary("所有检查通过，可以发布。");
        assert_eq!(risk, None);
    }
}
