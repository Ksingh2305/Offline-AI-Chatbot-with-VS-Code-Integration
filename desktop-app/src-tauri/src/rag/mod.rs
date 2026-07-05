use anyhow::{anyhow, Result};
use serde::{Deserialize, Serialize};
use walkdir::{DirEntry, WalkDir};

use crate::registry::EmbeddingsCfg;
use crate::types::ChatMessage;

#[derive(Clone, Serialize, Deserialize)]
pub struct Chunk {
    pub path: String,
    pub start_line: usize,
    pub end_line: usize,
    pub text: String,
    #[serde(skip)]
    pub embedding: Vec<f32>,
}

#[derive(Default)]
pub struct RagStore {
    pub chunks: Vec<Chunk>,
    pub indexed_path: Option<String>,
    pub embed: Option<EmbeddingsCfg>,
}

const ALLOWED: &[&str] = &[
    "rs", "py", "js", "ts", "tsx", "jsx", "go", "java", "kt", "c", "h", "cpp", "hpp", "cs", "rb",
    "php", "swift", "scala", "sql", "sh", "md", "toml", "yaml", "yml", "json",
];
const SKIP: &[&str] = &[
    ".git", "node_modules", "target", "dist", "build", ".venv", "venv", "__pycache__", ".next",
    ".cache",
];

impl RagStore {
    pub async fn index_repo(&mut self, root: &str, http: &reqwest::Client) -> Result<(usize, usize)> {
        let embed = self
            .embed
            .clone()
            .ok_or_else(|| anyhow!("no embeddings config set"))?;

        let mut files = 0usize;
        let mut chunks: Vec<Chunk> = Vec::new();

        for entry in WalkDir::new(root).into_iter().filter_entry(|e| !is_skipped(e)) {
            let entry = match entry {
                Ok(e) => e,
                Err(_) => continue,
            };
            if !entry.file_type().is_file() {
                continue;
            }
            let ext = entry.path().extension().and_then(|x| x.to_str()).unwrap_or("");
            if !ALLOWED.contains(&ext) {
                continue;
            }
            if std::fs::metadata(entry.path()).map(|m| m.len()).unwrap_or(u64::MAX) > 1_000_000 {
                continue; // skip files > ~1 MB
            }
            let src = match std::fs::read_to_string(entry.path()) {
                Ok(s) => s,
                Err(_) => continue,
            };
            files += 1;
            for (start, end, text) in windows(&src, 60, 10) {
                chunks.push(Chunk {
                    path: entry.path().display().to_string(),
                    start_line: start,
                    end_line: end,
                    text,
                    embedding: vec![],
                });
            }
        }

        let inputs: Vec<String> = chunks
            .iter()
            .map(|c| format!("file: {}\n{}", c.path, c.text))
            .collect();
        let embeddings = embed_texts(http, &embed, inputs).await?;
        for (c, v) in chunks.iter_mut().zip(embeddings) {
            c.embedding = v;
        }

        let n = chunks.len();
        self.chunks = chunks;
        self.indexed_path = Some(root.to_string());
        Ok((files, n))
    }

    pub async fn retrieve(&self, query: &str, k: usize, http: &reqwest::Client) -> Result<Vec<Chunk>> {
        if self.chunks.is_empty() {
            return Ok(vec![]);
        }
        let embed = self
            .embed
            .clone()
            .ok_or_else(|| anyhow!("no embeddings config set"))?;
        let q = embed_texts(http, &embed, vec![query.to_string()])
            .await?
            .into_iter()
            .next()
            .ok_or_else(|| anyhow!("empty query embedding"))?;

        let mut scored: Vec<(f32, &Chunk)> = self
            .chunks
            .iter()
            .map(|c| (cosine(&q, &c.embedding), c))
            .collect();
        scored.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal));
        Ok(scored.into_iter().take(k).map(|(_, c)| c.clone()).collect())
    }
}

async fn embed_texts(
    http: &reqwest::Client,
    cfg: &EmbeddingsCfg,
    texts: Vec<String>,
) -> Result<Vec<Vec<f32>>> {
    if texts.is_empty() {
        return Ok(vec![]);
    }
    let mut out = Vec::with_capacity(texts.len());
    for batch in texts.chunks(32) {
        let v = if cfg.provider == "ollama" {
            embed_ollama(http, cfg, batch).await?
        } else {
            embed_openai(http, cfg, batch).await?
        };
        out.extend(v);
    }
    Ok(out)
}

async fn embed_ollama(http: &reqwest::Client, cfg: &EmbeddingsCfg, batch: &[String]) -> Result<Vec<Vec<f32>>> {
    #[derive(Deserialize)]
    struct R {
        embeddings: Vec<Vec<f32>>,
    }
    let body = serde_json::json!({ "model": cfg.model_ref, "input": batch });
    let resp = http.post(format!("{}/api/embed", cfg.base_url)).json(&body).send().await?;
    if !resp.status().is_success() {
        return Err(anyhow!("ollama embed http {}", resp.status()));
    }
    Ok(resp.json::<R>().await?.embeddings)
}

async fn embed_openai(http: &reqwest::Client, cfg: &EmbeddingsCfg, batch: &[String]) -> Result<Vec<Vec<f32>>> {
    #[derive(Deserialize)]
    struct R {
        data: Vec<D>,
    }
    #[derive(Deserialize)]
    struct D {
        embedding: Vec<f32>,
    }
    let body = serde_json::json!({ "model": cfg.model_ref, "input": batch });
    let resp = http.post(format!("{}/v1/embeddings", cfg.base_url)).json(&body).send().await?;
    if !resp.status().is_success() {
        return Err(anyhow!("embed http {}", resp.status()));
    }
    Ok(resp.json::<R>().await?.data.into_iter().map(|d| d.embedding).collect())
}

/// Line-window chunking with overlap. (Upgrade path: swap this for tree-sitter
/// AST chunking — same call site, richer chunks.)
fn windows(src: &str, win: usize, overlap: usize) -> Vec<(usize, usize, String)> {
    let lines: Vec<&str> = src.lines().collect();
    if lines.is_empty() {
        return vec![];
    }
    let step = win.saturating_sub(overlap).max(1);
    let mut out = Vec::new();
    let mut i = 0;
    while i < lines.len() {
        let end = (i + win).min(lines.len());
        let text = lines[i..end].join("\n");
        if !text.trim().is_empty() {
            out.push((i + 1, end, text));
        }
        if end == lines.len() {
            break;
        }
        i += step;
    }
    out
}

fn cosine(a: &[f32], b: &[f32]) -> f32 {
    if a.len() != b.len() || a.is_empty() {
        return 0.0;
    }
    let (mut dot, mut na, mut nb) = (0.0f32, 0.0f32, 0.0f32);
    for i in 0..a.len() {
        dot += a[i] * b[i];
        na += a[i] * a[i];
        nb += b[i] * b[i];
    }
    if na == 0.0 || nb == 0.0 {
        0.0
    } else {
        dot / (na.sqrt() * nb.sqrt())
    }
}

fn is_skipped(e: &DirEntry) -> bool {
    e.file_name().to_str().map(|n| SKIP.contains(&n)).unwrap_or(false)
}

/// Turn retrieved chunks into a system message injected ahead of the user turn.
pub fn context_block(chunks: &[Chunk]) -> ChatMessage {
    let mut s = String::from(
        "You are a coding assistant. Use the repository context below to answer accurately and cite file paths.\n\n--- REPOSITORY CONTEXT ---\n",
    );
    for c in chunks {
        s.push_str(&format!("\n# {} (lines {}-{})\n{}\n", c.path, c.start_line, c.end_line, c.text));
    }
    s.push_str("\n--- END CONTEXT ---");
    ChatMessage {
        role: "system".into(),
        content: s,
    }
}
