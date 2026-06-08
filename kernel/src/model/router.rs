use crate::model::ModelProvider;

#[derive(Debug, Default, Clone)]
pub struct ModelRouter;

impl ModelRouter {
    pub fn select(&self, provider: ModelProvider) -> ModelProvider {
        provider
    }
}
