use std::{collections::VecDeque, process::Child, sync::{Arc, Mutex}};

use sacode_kernel::ApprovalPolicy;

#[derive(Debug, Clone, Default)]
pub struct QueueState {
    pub processing: bool,
    pub busy_message: String,
    pub active_task_id: Option<u64>,
    pub queued_messages: VecDeque<QueuedMessage>,
    pub active_child: Option<Arc<Mutex<Child>>>,
}

#[derive(Debug, Clone)]
pub struct QueuedMessage {
    pub id: u64,
    pub content: String,
    pub approval: ApprovalPolicy,
    pub loop_state: Option<LoopState>,
}

#[derive(Debug, Clone)]
pub struct LoopState {
    pub task: String,
    pub iteration: u32,
    pub max_iterations: u32,
    pub error_count: u32,
}
