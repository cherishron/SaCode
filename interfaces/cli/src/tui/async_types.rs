use sacode_kernel::model::ChatUsage;
use sacode_kernel::{LoopState, TaskRun, TaskRunState};

use crate::cmd::init::InitMode;
use crate::provider_config::{NamedProviderConfig, ProviderConfig};
use crate::tui::ModelOptionEntry;

pub(super) enum AsyncResult {
    ChatStreamChunk {
        task_id: u64,
        kind: StreamChunkKind,
        content: String,
    },
    ChatCompleted {
        task_id: u64,
        prompt: String,
        response: String,
        hit_round_limit: bool,
        orchestration_summary: Option<String>,
        task_run: Option<TaskRun>,
        learned_facts: Vec<crate::learning::LearnedFact>,
        pending_question: Option<serde_json::Value>,
        plan: Option<sacode_kernel::Plan>,
        usage: Option<ChatUsage>,
        api_duration_ms: u64,
        tool_duration_ms: u64,
        total_duration_ms: u64,
        loop_state: Option<LoopState>,
    },
    InputOptimized {
        original: String,
        optimized: String,
        model_name: String,
    },
    ContextCompressed {
        summary: String,
        model_name: String,
    },
    LoginCompleted {
        provider_name: String,
        config: ProviderConfig,
    },
    ProvidersLoaded {
        providers: Vec<String>,
        current_provider: String,
    },
    ProviderSwitched {
        current_provider: NamedProviderConfig,
    },
    ModelsLoaded {
        models: Vec<ModelOptionEntry>,
        current_provider: String,
        current_model: String,
    },
    ModelSaved {
        config: ProviderConfig,
        selected_model: String,
    },
    VersionChecked {
        current_version: String,
        remote_version: Option<String>,
        has_update: bool,
    },
    InitCompleted {
        mode: InitMode,
    },
    UpdateCompleted {
        message: String,
    },
    Failed {
        context: AsyncContext,
        message: String,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum AsyncContext {
    OptimizeInput,
    CompressContext,
    Login,
    LoadProviders,
    SaveProvider,
    LoadModels,
    SaveModel,
    Init,
    Update,
}

#[allow(dead_code)]
fn _keep_imports_used(_: Option<TaskRunState>) {}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum StreamChunkKind {
    Message,
    Thinking,
}
