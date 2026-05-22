use std::sync::mpsc::{Sender, Receiver, channel};
use std::thread;
use std::time::Duration;

use crate::schema::{Task, Step, Review};
use crate::event::Event;
use crate::agent::{PlannerAgent, CoderAgent, ReviewerAgent, ToolCallIntent};

#[derive(Debug, Clone)]
pub enum AgentTask {
    Plan(Task),
    ExecuteStep(Step),
    Review(Step, String),
    Shutdown,
}

#[derive(Debug, Clone)]
pub enum AgentMessage {
    PlanGenerated(crate::schema::Plan),
    StepExecuted(usize, Vec<ToolCallIntent>, String),
    ReviewCompleted(usize, Review),
    Event(Event),
    Error(String),
    Done,
}

#[derive(Debug)]
pub struct AgentDispatcher {
    planner_sender: Sender<AgentTask>,
    planner_receiver: Receiver<AgentMessage>,
    coder_sender: Sender<AgentTask>,
    coder_receiver: Receiver<AgentMessage>,
    reviewer_sender: Sender<AgentTask>,
    reviewer_receiver: Receiver<AgentMessage>,
}

impl AgentDispatcher {
    pub fn new() -> Self {
        let (planner_tx, planner_rx_task) = channel();
        let (planner_tx_msg, planner_rx_msg) = channel();
        let (coder_tx, coder_rx_task) = channel();
        let (coder_tx_msg, coder_rx_msg) = channel();
        let (reviewer_tx, reviewer_rx_task) = channel();
        let (reviewer_tx_msg, reviewer_rx_msg) = channel();

        thread::spawn(|| {
            let planner = PlannerAgent::default();
            let rx: Receiver<AgentTask> = planner_rx_task;
            let tx: Sender<AgentMessage> = planner_tx_msg;

            while let Ok(task) = rx.recv() {
                match task {
                    AgentTask::Plan(task_input) => {
                        let output = planner.run(&task_input);
                        tx.send(AgentMessage::PlanGenerated(output.plan)).ok();
                        for event in output.events {
                            tx.send(AgentMessage::Event(event)).ok();
                        }
                        tx.send(AgentMessage::Done).ok();
                    }
                    AgentTask::Shutdown => break,
                    _ => {}
                }
            }
        });

        thread::spawn(|| {
            let coder = CoderAgent::default();
            let rx: Receiver<AgentTask> = coder_rx_task;
            let tx: Sender<AgentMessage> = coder_tx_msg;

            while let Ok(task) = rx.recv() {
                match task {
                    AgentTask::ExecuteStep(mut step) => {
                        let output = coder.execute_step(&mut step);
                        tx.send(AgentMessage::StepExecuted(
                            output.step,
                            output.tool_calls,
                            output.result,
                        )).ok();
                        for event in output.events {
                            tx.send(AgentMessage::Event(event)).ok();
                        }
                        tx.send(AgentMessage::Done).ok();
                    }
                    AgentTask::Shutdown => break,
                    _ => {}
                }
            }
        });

        thread::spawn(|| {
            let reviewer = ReviewerAgent::default();
            let rx: Receiver<AgentTask> = reviewer_rx_task;
            let tx: Sender<AgentMessage> = reviewer_tx_msg;

            while let Ok(task) = rx.recv() {
                match task {
                    AgentTask::Review(step, result) => {
                        let output = reviewer.review_step(&step, &result);
                        tx.send(AgentMessage::ReviewCompleted(step.id, output.review)).ok();
                        for event in output.events {
                            tx.send(AgentMessage::Event(event)).ok();
                        }
                        tx.send(AgentMessage::Done).ok();
                    }
                    AgentTask::Shutdown => break,
                    _ => {}
                }
            }
        });

        Self {
            planner_sender: planner_tx,
            planner_receiver: planner_rx_msg,
            coder_sender: coder_tx,
            coder_receiver: coder_rx_msg,
            reviewer_sender: reviewer_tx,
            reviewer_receiver: reviewer_rx_msg,
        }
    }

    pub fn dispatch_plan(&self, task: Task) {
        self.planner_sender.send(AgentTask::Plan(task)).ok();
    }

    pub fn dispatch_step(&self, step: Step) {
        self.coder_sender.send(AgentTask::ExecuteStep(step)).ok();
    }

    pub fn dispatch_review(&self, step: Step, result: String) {
        self.reviewer_sender.send(AgentTask::Review(step, result)).ok();
    }

    pub fn collect_messages(&self, timeout_ms: u64) -> Vec<AgentMessage> {
        let mut messages = Vec::new();
        let deadline = Duration::from_millis(timeout_ms);

        let try_recv = |rx: &Receiver<AgentMessage>| {
            rx.recv_timeout(deadline).ok()
        };

        if let Some(msg) = try_recv(&self.planner_receiver) {
            messages.push(msg);
        }
        if let Some(msg) = try_recv(&self.coder_receiver) {
            messages.push(msg);
        }
        if let Some(msg) = try_recv(&self.reviewer_receiver) {
            messages.push(msg);
        }

        messages
    }

    pub fn shutdown(&self) {
        self.planner_sender.send(AgentTask::Shutdown).ok();
        self.coder_sender.send(AgentTask::Shutdown).ok();
        self.reviewer_sender.send(AgentTask::Shutdown).ok();
    }
}

impl Default for AgentDispatcher {
    fn default() -> Self {
        Self::new()
    }
}