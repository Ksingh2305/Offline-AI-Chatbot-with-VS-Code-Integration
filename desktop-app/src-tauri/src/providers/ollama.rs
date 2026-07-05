use anyhow::{anyhow, Result};
use bytes::Bytes;
use futures_util::{stream::BoxStream, Stream, StreamExt};
use serde::Deserialize;

use super::ModelProvider;
use crate::registry::ModelCfg;
use crate::types::ChatMessage;

pub struct Ollama {
    base: String,
    model: ModelCfg,
    http: reqwest::Client,
}

impl Ollama {
    pub fn new(base: String, model: ModelCfg, http: reqwest::Client) -> Self {
        Self { base, model, http }
    }
}

#[derive(Deserialize)]
struct Chunk {
    #[serde(default)]
    message: Option<Msg>,
    #[serde(default)]
    done: bool,
}
#[derive(Deserialize)]
struct Msg {
    #[serde(default)]
    content: String,
}

#[async_trait::async_trait]
impl ModelProvider for Ollama {
    async fn chat_stream(
        &self,
        messages: Vec<ChatMessage>,
    ) -> Result<BoxStream<'static, Result<String>>> {
        let body = serde_json::json!({
            "model": self.model.model_ref,
            "messages": messages,
            "stream": true,
            "options": {
                "temperature": self.model.temperature.unwrap_or(0.2),
                "num_ctx": self.model.context
            }
        });
        let resp = self
            .http
            .post(format!("{}/api/chat", self.base))
            .json(&body)
            .send()
            .await?;
        if !resp.status().is_success() {
            return Err(anyhow!("ollama http {}", resp.status()));
        }
        Ok(ndjson(resp.bytes_stream()).boxed())
    }
}

/// Ollama streams newline-delimited JSON. Buffer across chunk boundaries.
fn ndjson(
    byte_stream: impl Stream<Item = reqwest::Result<Bytes>> + Send + 'static,
) -> impl Stream<Item = Result<String>> + Send + 'static {
    async_stream::try_stream! {
        let mut buf = String::new();
        futures_util::pin_mut!(byte_stream);
        while let Some(chunk) = byte_stream.next().await {
            buf.push_str(&String::from_utf8_lossy(&chunk?));
            while let Some(pos) = buf.find('\n') {
                let line: String = buf.drain(..=pos).collect();
                let line = line.trim();
                if line.is_empty() { continue; }
                if let Ok(c) = serde_json::from_str::<Chunk>(line) {
                    if let Some(m) = c.message {
                        if !m.content.is_empty() { yield m.content; }
                    }
                    if c.done { return; }
                }
            }
        }
    }
}
