use crate::schema::{Review, ReviewIssue, Step, StepStatus};
use crate::event::Event;

#[derive(Debug, Clone)]
pub struct ReviewerOutput {
    pub review: Review,
    pub events: Vec<Event>,
    pub should_retry: bool,
}

#[derive(Debug, Default, Clone)]
pub struct ReviewerAgent;

impl ReviewerAgent {
    pub fn review_step(&self, step: &Step, result: &str) -> ReviewerOutput {
        let events = vec![
            Event::thinking(format!("审查步骤 {}: {}", step.id, step.description)),
        ];

        let review = if step.status == StepStatus::Completed || result.contains("完成") {
            Review::passed()
        } else if step.status == StepStatus::Running {
            Review::passed().with_suggestion("步骤正在执行")
        } else {
            Review::failed(vec![
                ReviewIssue::warning(format!("步骤 {} 状态异常", step.id)),
            ])
        };

        let should_retry = !review.passed && review.has_critical();

        ReviewerOutput {
            review,
            events,
            should_retry,
        }
    }
}