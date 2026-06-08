use std::thread;

use anyhow::Result;

use super::{
    block_on_cli_future, resolve_provider, App, AsyncContext, AsyncResult, InputMode,
    InputOptimizationSnapshot,
};
use sacode_runtime::ProviderClient;

impl App {
    pub(super) fn spawn_optimize_input_task(&self, input: String) {
        let sender = self.task_tx.clone();
        let model_name = self.current_model_name();
        let provider = self
            .current_provider
            .as_ref()
            .map(|provider| provider.config.to_model_provider())
            .unwrap_or_else(|| resolve_provider(&self.workdir));
        let prompt = format!("{}\n\n{}", self.prompt_template.optimize_input, input);
        thread::spawn(
            move || match Self::run_simple_chat_prompt(&provider, &prompt) {
                Ok(optimized) => {
                    let _ = sender.send(AsyncResult::InputOptimized {
                        original: input,
                        optimized,
                        model_name,
                    });
                }
                Err(error) => {
                    let _ = sender.send(AsyncResult::Failed {
                        context: AsyncContext::OptimizeInput,
                        message: format!("优化当前输入失败: {}", error),
                    });
                }
            },
        );
    }

    pub(super) fn run_simple_chat_prompt(
        provider: &sacode_kernel::model::ModelProvider,
        prompt: &str,
    ) -> Result<String> {
        let text = block_on_cli_future(async move {
            ProviderClient::new().simple_chat(provider, prompt).await
        })?;
        let trimmed = text.trim();
        if trimmed.is_empty() {
            anyhow::bail!("模型未返回可用结果")
        }
        Ok(trimmed.to_string())
    }

    pub(super) fn undo_last_input_optimization(&mut self) {
        let Some(snapshot) = self.last_input_optimization.clone() else {
            self.push_system_message("当前没有可撤回的输入优化记录。");
            return;
        };

        if self.input != snapshot.optimized {
            self.push_system_message("当前输入已变化，保留现有内容。请手动调整后继续。");
            return;
        }

        self.input = snapshot.original.clone();
        self.last_input_optimization = None;
        self.push_success_message(&format!("已撤回 {} 的输入优化", snapshot.model_name));
    }

    pub(super) fn apply_pending_input_optimization(&mut self) {
        let Some(preview) = self.pending_input_optimization.clone() else {
            self.input_mode = InputMode::Chat;
            return;
        };

        self.last_input_optimization = Some(InputOptimizationSnapshot {
            original: preview.original,
            optimized: preview.optimized.clone(),
            model_name: preview.model_name.clone(),
        });
        self.input = preview.optimized;
        self.pending_input_optimization = None;
        self.input_mode = InputMode::Chat;
        self.push_success_message(&format!(
            "已使用 {} 优化当前输入，Ctrl+Z 可撤回",
            preview.model_name
        ));
    }

    pub(super) fn cancel_pending_input_optimization(&mut self) {
        self.pending_input_optimization = None;
        self.input_mode = InputMode::Chat;
        self.push_system_message("已取消本次输入优化预览。");
    }
}
