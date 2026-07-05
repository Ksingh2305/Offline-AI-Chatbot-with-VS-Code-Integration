pub mod llamacpp;
pub mod ollama;

use anyhow::Result;
use futures_util::stream::BoxStream;

use crate::registry::{ModelCfg, Registry};
use crate::types::ChatMessage;

/// One trait, many backends. Adding vLLM/LM Studio later = one new file.
#[async_trait::async_trait]
pub trait ModelProvider: Send + Sync {
    async fn chat_stream(
        &self,
        messages: Vec<ChatMessage>,
    ) -> Result<BoxStream<'static, Result<String>>>;
}

/// Build the right provider for the active model. Driven entirely by the
/// registry — switching models never requires a recompile.
pub fn make_provider(reg: &Registry, model: &ModelCfg, http: reqwest::Client) -> Box<dyn ModelProvider> {
    let base = reg
        .provider_url(&model.provider)
        .unwrap_or_else(|| "http://127.0.0.1:8080".into());
    match model.provider.as_str() {
        "ollama" => Box::new(ollama::Ollama::new(base, model.clone(), http)),
        "llamacpp" => Box::new(llamacpp::LlamaCpp::new(base, model.clone(), http)),
        other => {
            eprintln!("unknown provider '{other}', falling back to llamacpp");
            Box::new(llamacpp::LlamaCpp::new(base, model.clone(), http))
        }
    }
}
