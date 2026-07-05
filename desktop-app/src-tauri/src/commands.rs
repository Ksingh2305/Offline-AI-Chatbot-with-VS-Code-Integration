use futures_util::StreamExt;
use serde::Serialize;
use tauri::ipc::Channel;

use crate::providers::make_provider;
use crate::rag;
use crate::state::AppState;
use crate::types::ChatMessage;

#[derive(Clone, Serialize)]
pub struct TokenEvent {
    pub token: Option<String>,
    pub done: bool,
}

#[tauri::command]
pub async fn list_models(state: tauri::State<'_, AppState>) -> Result<serde_json::Value, String> {
    let reg = state.registry.read().await;
    Ok(serde_json::json!({ "active": reg.active, "models": reg.models }))
}

#[tauri::command]
pub async fn set_active_model(state: tauri::State<'_, AppState>, id: String) -> Result<(), String> {
    let mut reg = state.registry.write().await;
    if reg.model(&id).is_none() {
        return Err(format!("unknown model: {id}"));
    }
    reg.active = id;
    Ok(())
}

/// Polled by the UI during warmup. True once the active backend answers.
#[tauri::command]
pub async fn engine_ready(state: tauri::State<'_, AppState>) -> Result<bool, String> {
    let base = {
        let reg = state.registry.read().await;
        let m = reg.active_model().ok_or("no active model")?;
        reg.provider_url(&m.provider).unwrap_or_default()
    };
    if base.is_empty() {
        return Ok(false);
    }
    // llama-server answers /health; Ollama answers /api/tags.
    let probes = [
        format!("{base}/health"),
        format!("{base}/v1/models"),
        format!("{base}/api/tags"),
    ];
    for url in probes {
        if let Ok(r) = state.http.get(&url).send().await {
            if r.status().is_success() {
                return Ok(true);
            }
        }
    }
    Ok(false)
}

#[tauri::command]
pub async fn chat_stream(
    state: tauri::State<'_, AppState>,
    messages: Vec<ChatMessage>,
    use_repo_context: bool,
    channel: Channel<TokenEvent>,
) -> Result<(), String> {
    // Snapshot the active provider (drops the registry lock immediately).
    let provider = {
        let reg = state.registry.read().await;
        let model = reg.active_model().ok_or("no active model")?.clone();
        make_provider(&reg, &model, state.http.clone())
    };

    let mut messages = messages;
    if use_repo_context {
        if let Some(last) = messages.iter().rev().find(|m| m.role == "user").cloned() {
            let store = state.rag.read().await;
            if let Ok(chunks) = store.retrieve(&last.content, 6, &state.http).await {
                if !chunks.is_empty() {
                    messages.insert(0, rag::context_block(&chunks));
                }
            }
        }
    }

    let mut stream = provider.chat_stream(messages).await.map_err(|e| e.to_string())?;
    while let Some(tok) = stream.next().await {
        match tok {
            Ok(t) => {
                let _ = channel.send(TokenEvent { token: Some(t), done: false });
            }
            Err(e) => {
                let _ = channel.send(TokenEvent {
                    token: Some(format!("\n[stream error: {e}]")),
                    done: false,
                });
                break;
            }
        }
    }
    let _ = channel.send(TokenEvent { token: None, done: true });
    Ok(())
}

#[tauri::command]
pub async fn index_repo(
    state: tauri::State<'_, AppState>,
    path: String,
) -> Result<serde_json::Value, String> {
    let embed_cfg = { state.registry.read().await.embeddings.clone() };
    let mut store = state.rag.write().await;
    store.embed = Some(embed_cfg);
    let (files, chunks) = store.index_repo(&path, &state.http).await.map_err(|e| e.to_string())?;
    Ok(serde_json::json!({ "files": files, "chunks": chunks }))
}

#[tauri::command]
pub async fn rag_status(state: tauri::State<'_, AppState>) -> Result<serde_json::Value, String> {
    let store = state.rag.read().await;
    Ok(serde_json::json!({ "chunks": store.chunks.len(), "indexed_path": store.indexed_path }))
}
