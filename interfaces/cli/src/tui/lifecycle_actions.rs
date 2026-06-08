use std::thread;

use crate::cmd::{
    config,
    init::{apply_init_draft, build_init_draft, InitMode},
    update,
};
use crate::version_check::{VersionCheckConfig, VersionChecker, VersionStatus};

use super::{block_on_cli_future, App, AsyncContext, AsyncResult};

impl App {
    pub(super) fn init_command(&mut self, mode: InitMode) {
        self.queue.processing = true;
        self.queue.active_task_id = None;
        self.active_task_started_at = Some(chrono::Local::now());
        self.spinner_index = 0;
        self.queue.busy_message = match mode {
            InitMode::Basic => "正在生成项目初始化文件...".to_string(),
            InitMode::Deep => "正在生成深度初始化文件...".to_string(),
        };
        self.spawn_init_task(mode);
    }

    pub(super) fn spawn_init_task(&self, mode: InitMode) {
        let sender = self.task_tx.clone();
        let workdir = self.workdir.clone();
        thread::spawn(move || {
            match block_on_cli_future(async {
                let draft = build_init_draft(&workdir, mode).await?;
                apply_init_draft(&workdir, &draft).await
            }) {
                Ok(_) => {
                    let _ = sender.send(AsyncResult::InitCompleted { mode });
                }
                Err(error) => {
                    let _ = sender.send(AsyncResult::Failed {
                        context: AsyncContext::Init,
                        message: format!("初始化失败: {}", error),
                    });
                }
            }
        });
    }

    pub(super) fn spawn_version_check(&self) {
        let sender = self.task_tx.clone();
        let version_config = config::effective_config(&self.workdir)
            .map(|cfg| VersionCheckConfig {
                check_on_startup: cfg.update_check_on_startup,
                cache_duration_hours: cfg.update_cache_duration_hours as i64,
                channel: cfg.update_channel,
            })
            .unwrap_or_default();
        thread::spawn(move || {
            if let Ok(status) = VersionChecker::with_config(version_config).check_for_update() {
                match status {
                    VersionStatus::UpdateAvailable {
                        current_version,
                        remote_version,
                    } => {
                        let _ = sender.send(AsyncResult::VersionChecked {
                            current_version,
                            remote_version: Some(remote_version),
                            has_update: true,
                        });
                    }
                    VersionStatus::UpToDate { current_version } => {
                        let _ = sender.send(AsyncResult::VersionChecked {
                            current_version,
                            remote_version: None,
                            has_update: false,
                        });
                    }
                    VersionStatus::Unknown => {}
                }
            }
        });
    }

    pub(super) fn update_command(&mut self, input: &str) {
        if self.queue.processing {
            self.push_system_message("当前有任务正在执行，请等待完成后再更新 sacode。");
            return;
        }
        self.queue.processing = true;
        self.queue.active_task_id = None;
        self.active_task_started_at = Some(chrono::Local::now());
        self.spinner_index = 0;
        self.queue.busy_message = "正在更新 sacode...".to_string();
        let sender = self.task_tx.clone();
        let args = input
            .split_whitespace()
            .skip(1)
            .map(|value| value.to_string())
            .collect::<Vec<_>>();
        thread::spawn(move || match update::execute(args) {
            Ok(result) => {
                let _ = sender.send(AsyncResult::UpdateCompleted {
                    message: result.message,
                });
            }
            Err(error) => {
                let _ = sender.send(AsyncResult::Failed {
                    context: AsyncContext::Update,
                    message: format!("更新 sacode 失败: {}", error),
                });
            }
        });
    }
}
