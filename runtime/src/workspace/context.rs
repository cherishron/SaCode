#[derive(Debug, Default, Clone)]
pub struct ContextBudget {
    pub used_tokens: usize,
    pub max_tokens: usize,
}
