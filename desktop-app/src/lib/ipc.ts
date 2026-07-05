import { invoke, Channel } from "@tauri-apps/api/core";

export interface ModelInfo {
  id: string;
  provider: string;
  model_ref: string;
  role: string;
  tier: string;
}

export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

interface TokenEvent {
  token: string | null;
  done: boolean;
}

/** Read the model registry: which model is active + the full catalog. */
export async function listModels(): Promise<{ active: string; models: ModelInfo[] }> {
  return invoke("list_models");
}

/** Hot-swap the active model. No recompile — this just flips a field in the registry. */
export async function setActiveModel(id: string): Promise<void> {
  return invoke("set_active_model", { id });
}

/**
 * Stream a chat completion token-by-token from the local model.
 * Returns a promise that resolves when the stream is fully done.
 */
export async function chatStream(
  messages: ChatMessage[],
  useRepoContext: boolean,
  onToken: (t: string) => void,
  onDone: () => void
): Promise<void> {
  const channel = new Channel<TokenEvent>();
  channel.onmessage = (m) => {
    if (m.token) onToken(m.token);
    if (m.done) onDone();
  };
  await invoke("chat_stream", { messages, useRepoContext, channel });
}

/** Index a repository folder for RAG. Returns counts. */
export async function indexRepo(path: string): Promise<{ files: number; chunks: number }> {
  return invoke("index_repo", { path });
}

/** Current RAG state. */
export async function ragStatus(): Promise<{ chunks: number; indexed_path: string | null }> {
  return invoke("rag_status");
}

/** True once the bundled inference engine has loaded the model and answers /health. */
export async function engineReady(): Promise<boolean> {
  return invoke("engine_ready");
}
