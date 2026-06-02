use sacode_kernel::model::{ChatUsage, ProviderKind};

use super::{format_duration_ms, App, PricingRule};

impl App {
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

    pub(super) fn thinking_toggle_status_label(&self) -> &'static str {
        if self.current_thinking_enabled() {
            "思考:开"
        } else {
            "思考:关"
        }
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
        let rule = provider_spec.models.entry(model_name.clone()).or_insert_with(|| {
            sacode_kernel::model::ModelRule {
                name: model_name.clone(),
                ..Default::default()
            }
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
        self.usage_stats.requests += 1;
        self.usage_stats.prompt_tokens += usage.prompt_tokens as u64;
        self.usage_stats.completion_tokens += usage.completion_tokens as u64;
        self.usage_stats.total_tokens += usage.total_tokens as u64;
        self.usage_stats.last_model = self.current_model_name();
        if let Some(rule) = self.current_pricing_rule() {
            self.usage_stats.estimated_cost_usd += (usage.prompt_tokens as f64 / 1_000_000.0)
                * rule.input_per_million
                + (usage.completion_tokens as f64 / 1_000_000.0) * rule.output_per_million;
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
            "sacode 已经关闭。再见！\n性能：\n总耗时：{}\nsacode 活动时间：{}\napi时间：{}\n工具时间：{}",
            format_duration_ms(self.perf_stats.total_task_duration_ms),
            format_duration_ms(self.session_active_duration_ms()),
            format_duration_ms(self.perf_stats.api_duration_ms),
            format_duration_ms(self.perf_stats.tool_duration_ms),
        )
    }

    pub(super) fn current_pricing_rule(&self) -> Option<PricingRule> {
        let provider = self.current_provider.as_ref()?;
        let model = provider.config.model.to_lowercase();
        match provider.config.to_model_provider().kind {
            ProviderKind::Deepseek => Some(PricingRule {
                input_per_million: 0.27,
                output_per_million: 1.10,
            }),
            ProviderKind::Mimo => Some(PricingRule {
                input_per_million: 0.80,
                output_per_million: 2.00,
            }),
            ProviderKind::Openai
                if model.contains("gpt-4.1-mini") || model.contains("gpt-4o-mini") =>
            {
                Some(PricingRule {
                    input_per_million: 0.15,
                    output_per_million: 0.60,
                })
            }
            ProviderKind::Openai if model.contains("gpt-4.1") => Some(PricingRule {
                input_per_million: 2.00,
                output_per_million: 8.00,
            }),
            ProviderKind::Openai if model.contains("gpt-4o") => Some(PricingRule {
                input_per_million: 2.50,
                output_per_million: 10.00,
            }),
            _ => None,
        }
    }
}
