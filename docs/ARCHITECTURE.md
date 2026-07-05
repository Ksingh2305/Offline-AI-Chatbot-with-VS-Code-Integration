# Architecture

This document explains the technical decisions behind LocalForge in more depth than the top-level README.

## Goals that shaped every decision

1. **Genuinely offline.** Not "offline-capable" — the network can be physically disconnected and nothing breaks.
2. **Runs on modest hardware.** 16 GB RAM, CPU-only, no GPU requirement.
3. **One installer.** A user should not need to separately install Ollama, Python, or any runtime.
4. **Swappable models.** The model is a configuration choice, not a code dependency.

## Component breakdown

### Desktop app (Tauri 2 + Rust)

The desktop app is the control plane. It:
- Manages the lifecycle of the inference engine (starts/stops `llama-server` as a child process)
- Exposes a small set of Tauri IPC commands to the React frontend (`chat_stream`, `index_repo`, `list_models`, `engine_ready`)
- Owns the RAG index (chunking, embedding, retrieval) in-process
- Reads a YAML registry that defines which models exist and which is active

**Why a bundled sidecar instead of assuming Ollama is installed:** the entire point of a single offline installer is that the user does zero setup. Bundling `llama-server.exe` (from llama.cpp) and the GGUF model file as Tauri resources, then spawning it as a subprocess on app startup, means the installer is self-sufficient.

### Model provider abstraction

```rust
#[async_trait::async_trait]
pub trait ModelProvider: Send + Sync {
    async fn chat_stream(&self, messages: Vec<ChatMessage>)
        -> Result<BoxStream<'static, Result<String>>>;
}
```

Two implementations exist — `llamacpp.rs` (talks to the bundled `llama-server`'s OpenAI-compatible endpoint) and `ollama.rs` (talks to a locally running Ollama instance, useful in development). Both providers share almost all logic because both backends speak a very similar HTTP/SSE protocol. Adding a third backend is a matter of implementing one trait, not modifying the call sites.

The active model is selected via `registry.yaml`:

```yaml
active: qwen-coder-local
models:
  - id: qwen-coder-local
    provider: llamacpp
    model_ref: "qwen2.5-coder-3b"
    context: 8192
```

Switching models — even to a completely different architecture or quantisation — requires editing this file, not the Rust source.

### RAG pipeline

1. **Chunking** — repository files are split into overlapping line-windows (upgradeable to AST-aware chunking via tree-sitter without changing the call site)
2. **Embedding** — each chunk is embedded via the configured embeddings endpoint
3. **Storage** — chunks and vectors are held in memory for the session (designed to be swapped for a persistent vector store as the project scales)
4. **Retrieval** — cosine similarity ranks chunks against the query; the top-k are injected as a system message ahead of the user's question

### VS Code extension

The extension is a thin client. It holds no model logic — every request is an HTTP call to the desktop app's local server. This keeps the extension simple and means the same engine can serve multiple editors simultaneously (a JetBrains or Neovim client would integrate identically).

Key pieces:
- `client.ts` — all HTTP/SSE communication, isolated so the transport can change without touching feature code
- `completions.ts` — debounced inline completion provider tuned for CPU latency
- `diagnostics.ts` — save-triggered analysis, code actions for one-click fixes, hover explanations
- `chatPanel.ts` — sidebar webview with streaming token rendering

## Packaging

The offline installer problem has one real constraint: NSIS (and WiX/MSI) both have practical size ceilings well below the size of a bundled LLM. The solution implemented here separates the small installer (app + engine, ~30–40 MB) from the model files, then uses a 7-Zip self-extracting wrapper to combine both into a single distributable `.exe` with no size ceiling. This keeps the Tauri build itself fast and standard, while still shipping one file to the end user.

## Known limitations

- RAG retrieval currently holds embeddings in memory rather than a persistent vector database — fine for single-session use, a natural next step for very large repositories.
- Inline completions use a chat-completion endpoint rather than a dedicated fill-in-the-middle (FIM) endpoint; latency is acceptable for a 3B model on CPU but a FIM-specific path would be faster.
- Only VS Code is currently integrated; the architecture (a local HTTP server) is editor-agnostic and JetBrains/Neovim clients are the natural next additions.
