use sacode_kernel::model::{ChatUsage, ModelRule};

use super::{format_duration_ms, App, ModelUsageStats, PricingRule};

impl App {
    pub(super) fn execution_mode_label(&self) -> &'static str {
        match self.execution_mode {
            sacode_kernel::ExecutionMode::Plan => "plan",
            sacode_kernel::ExecutionMode::Build => "build",
            sacode_kernel::ExecutionMode::Yolo => "yolo",
        }
    }

    pub(super) fn current_model_name(&self) -> String {
        self.current_provider
            .as_ref()
            .map(|provider| format!("{}:{}", provider.name, provider.config.model))
            .filter(|model| !model.is_empty())
            .unwrap_or_else(|| "内置执行".to_string())
    }

    pub(super) fn current_thinking_enabled(&self) -> bool {
        let Some(current_provider) = self.current_provider.as_ref() else {
            return false;
        };
        self.sacode_store
            .provider(&current_provider.name)
            .ok()
            .flatten()
            .and_then(|provider| provider.models.get(&current_provider.config.model).cloned())
            .map(|rule| rule.thinking)
            .unwrap_or(false)
    }

    pub(super) fn toggle_thinking_feature(&mut self) {
        let Some(current_provider) = self.current_provider.clone() else {
            self.push_system_message(
                "当前没有可切换的 provider。先使用 /login 或 /connect 配置模型。",
            );
            return;
        };

        let target_thinking = !self.current_thinking_enabled();
        let Ok(Some(mut provider_spec)) = self.sacode_store.provider(&current_provider.name) else {
            self.push_error_message("读取当前 provider 配置失败，无法切换思考功能。");
            return;
        };
        let model_name = current_provider.config.model.clone();
        let rule = provider_spec
            .models
            .entry(model_name.clone())
            .or_insert_with(|| sacode_kernel::model::ModelRule {
                name: model_name.clone(),
                ..Default::default()
            });
        rule.thinking = target_thinking;

        match self
            .sacode_store
            .upsert_provider(&current_provider.name, provider_spec)
        {
            Ok(_) => {
                self.current_provider = Some(current_provider);
                self.push_system_message(&format!(
                    "已{}，当前模型: {}",
                    if target_thinking {
                        "开启思考功能"
                    } else {
                        "关闭思考功能"
                    },
                    model_name,
                ));
            }
            Err(error) => self.push_error_message(&format!("切换思考功能失败: {}", error)),
        }
    }

    pub(super) fn record_usage(&mut self, usage: ChatUsage) {
        let model_key = self.current_model_name();
        let pricing_rule = self.current_pricing_rule();
        self.usage_stats.requests += 1;
        self.usage_stats.prompt_tokens += usage.prompt_tokens as u64;
        self.usage_stats.completion_tokens += usage.completion_tokens as u64;
        self.usage_stats.total_tokens += usage.total_tokens as u64;
        let model_stats = self
            .usage_stats
            .models
            .entry(model_key)
            .or_insert_with(ModelUsageStats::default);
        model_stats.requests += 1;
        model_stats.prompt_tokens += usage.prompt_tokens as u64;
        model_stats.completion_tokens += usage.completion_tokens as u64;
        model_stats.total_tokens += usage.total_tokens as u64;
        if let Some(rule) = pricing_rule {
            let estimated_cost = (usage.prompt_tokens as f64 / 1_000_000.0)
                * rule.input_per_million
                + (usage.completion_tokens as f64 / 1_000_000.0) * rule.output_per_million;
            self.usage_stats.estimated_cost_usd += estimated_cost;
            model_stats.estimated_cost_usd += estimated_cost;
        }
    }

    pub(super) fn record_performance(
        &mut self,
        api_duration_ms: u64,
        tool_duration_ms: u64,
        total_duration_ms: u64,
    ) {
        self.perf_stats.api_duration_ms += api_duration_ms;
        self.perf_stats.tool_duration_ms += tool_duration_ms;
        self.perf_stats.total_task_duration_ms += total_duration_ms;
    }

    pub(super) fn session_active_duration_ms(&self) -> u64 {
        let duration = chrono::Local::now() - self.perf_stats.session_started_at;
        duration.num_milliseconds().max(0) as u64
    }

    pub(super) fn shutdown_summary(&self) -> String {
        format!(
            "sacode 已经关闭。再见！\n性能：\n    总耗时：{}\n    sacode 活动时间：{}\n    api时间：{}\n    工具时间：{}",
            format_duration_ms(self.perf_stats.total_task_duration_ms),
            format_duration_ms(self.session_active_duration_ms()),
            format_duration_ms(self.perf_stats.api_duration_ms),
            format_duration_ms(self.perf_stats.tool_duration_ms),
        )
    }

    pub(super) fn current_pricing_rule(&self) -> Option<PricingRule> {
        let provider = self.current_provider.as_ref()?;
        let provider_spec = self.sacode_store.provider(&provider.name).ok().flatten()?;
        let rule = provider_spec.models.get(&provider.config.model)?;
        pricing_rule_from_model_rule(rule)
    }
}

fn pricing_rule_from_model_rule(rule: &ModelRule) -> Option<PricingRule> {
    let pricing = rule.pricing.as_ref()?;
    Some(PricingRule {
        input_per_million: pricing.input_per_million,
        output_per_million: pricing.output_per_million,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::provider_config::NamedProviderConfig;
    use crate::provider_config::ProviderConfig;
    use crate::tui::App;
    use sacode_kernel::model::{ModelPricing, ModelRule, ProviderSpec};
    use std::collections::BTreeMap;

    #[test]
    fn record_usage_tracks_multiple_models_and_costs() {
        let mut app = App::new();
        let provider_name = "stats-provider".to_string();
        let model_a = "model-a".to_string();
        let model_b = "model-b".to_string();
        let mut spec = ProviderSpec {
            name: provider_name.clone(),
            base_url: "https://example.com/v1".to_string(),
            api_key: String::new(),
            models: BTreeMap::new(),
        };
        spec.models.insert(
            model_a.clone(),
            ModelRule {
                name: model_a.clone(),
                pricing: Some(ModelPricing {
                    input_per_million: 1.0,
                    output_per_million: 2.0,
                }),
                ..Default::default()
            },
        );
        spec.models.insert(
            model_b.clone(),
            ModelRule {
                name: model_b.clone(),
                pricing: Some(ModelPricing {
                    input_per_million: 3.0,
                    output_per_million: 4.0,
                }),
                ..Default::default()
            },
        );
        app.sacode_store
            .upsert_provider(&provider_name, spec)
            .expect("persist provider spec");

        app.current_provider = Some(NamedProviderConfig {
            name: provider_name.clone(),
            config: ProviderConfig {
                base_url: "https://example.com/v1".to_string(),
                api_key: String::new(),
                model: model_a.clone(),
            },
        });
        app.record_usage(ChatUsage {
            prompt_tokens: 1_000,
            completion_tokens: 2_000,
            total_tokens: 3_000,
        });

        app.current_provider = Some(NamedProviderConfig {
            name: provider_name,
            config: ProviderConfig {
                base_url: "https://example.com/v1".to_string(),
                api_key: String::new(),
                model: model_b.clone(),
            },
        });
        app.record_usage(ChatUsage {
            prompt_tokens: 2_000,
            completion_tokens: 1_000,
            total_tokens: 3_000,
        });

        assert_eq!(app.usage_stats.requests, 2);
        assert_eq!(app.usage_stats.models.len(), 2);
        assert_eq!(
            app.usage_stats.models[&format!("stats-provider:{}", model_a)].requests,
            1
        );
        assert_eq!(
            app.usage_stats.models[&format!("stats-provider:{}", model_b)].requests,
            1
        );
        assert!(app.usage_stats.estimated_cost_usd > 0.0);
    }

    #[test]
    fn shutdown_summary_uses_indented_performance_layout() {
        let mut app = App::new();
        app.perf_stats.total_task_duration_ms = 358_000;
        app.perf_stats.api_duration_ms = 234_000;
        app.perf_stats.tool_duration_ms = 4_300;

        let summary = app.shutdown_summary();

        assert!(summary.contains("sacode 已经关闭。再见！"));
        assert!(summary.contains("性能：\n    总耗时：5m 58s"));
        assert!(summary.contains("\n    api时间：3m 54s"));
        assert!(summary.contains("\n    工具时间：4.3s"));
    }
}
