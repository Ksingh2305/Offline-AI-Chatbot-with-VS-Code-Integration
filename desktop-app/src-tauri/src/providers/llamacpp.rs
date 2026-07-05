use anyhow::{anyhow, Result};
use bytes::Bytes;
use futures_util::{stream::BoxStream, Stream, StreamExt};
use serde::Deserialize;

use super::ModelProvider;
use crate::registry::ModelCfg;
use crate::types::ChatMessage;

pub struct LlamaCpp {
    base: String,
    model: ModelCfg,
    http: reqwest::Client,
}

impl LlamaCpp {
    pub fn new(base: String, model: ModelCfg, http: reqwest::Client) -> Self {
        Self { base, model, http }
    }
}

#[derive(Deserialize)]
struct SseEvent {
    choices: Vec<Choice>,
}
#[derive(Deserialize)]
struct Choice {
    #[serde(default)]
    delta: Delta,
}
#[derive(Deserialize, Default)]
struct Delta {
    #[serde(default)]
    content: Option<String>,
}

#[async_trait::async_trait]
impl ModelProvider for LlamaCpp {
    async fn chat_stream(
        &self,
        messages: Vec<ChatMessage>,
    ) -> Result<BoxStream<'static, Result<String>>> {
        let body = serde_json::json!({
            "model": self.model.model_ref,
            "messages": messages,
            "stream": true,
            "temperature": self.model.temperature.unwrap_or(0.2)
        });
        let resp = self
            .http
            .post(format!("{}/v1/chat/completions", self.base))
            .json(&body)
            .send()
            .await?;
        if !resp.status().is_success() {
            return Err(anyhow!("llama-server http {}", resp.status()));
        }
        Ok(sse(resp.bytes_stream()).boxed())
    }
}

/// llama-server streams OpenAI-style Server-Sent Events: `data: {json}\n\n`,
/// terminated by `data: [DONE]`.
fn sse(
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
                if !line.starts_with("data:") { continue; }
                let data = line[5..].trim();
                if data == "[DONE]" { return; }
                if let Ok(ev) = serde_json::from_str::<SseEvent>(data) {
                    if let Some(choice) = ev.choices.into_iter().next() {
                        if let Some(t) = choice.delta.content {
                            if !t.is_empty() { yield t; }
                        }
                    }
                }
            }
        }
    }
}
