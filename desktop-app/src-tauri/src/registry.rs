use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::Path;

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ProviderCfg {
    pub base_url: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct EmbeddingsCfg {
    pub provider: String,
    pub base_url: String,
    pub model_ref: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct SidecarCfg {
    pub name: String,
    pub model_file: String,
    pub port: u16,
    #[serde(default = "default_ctx")]
    pub ctx: u32,
    #[serde(default)]
    pub embedding: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ModelCfg {
    pub id: String,
    pub provider: String,
    pub model_ref: String,
    #[serde(default)]
    pub role: String,
    #[serde(default)]
    pub tier: String,
    #[serde(default = "default_ctx")]
    pub context: u32,
    #[serde(default)]
    pub temperature: Option<f32>,
}

fn default_ctx() -> u32 {
    4096
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Registry {
    pub active: String,
    pub embeddings: EmbeddingsCfg,
    pub providers: HashMap<String, ProviderCfg>,
    #[serde(default)]
    pub sidecars: Vec<SidecarCfg>,
    pub models: Vec<ModelCfg>,
}

impl Registry {
    pub fn load(path: &Path) -> anyhow::Result<Self> {
        let raw = std::fs::read_to_string(path)?;
        Ok(serde_yaml::from_str(&raw)?)
    }
    pub fn active_model(&self) -> Option<&ModelCfg> {
        self.models.iter().find(|m| m.id == self.active)
    }
    pub fn model(&self, id: &str) -> Option<&ModelCfg> {
        self.models.iter().find(|m| m.id == id)
    }
    pub fn provider_url(&self, name: &str) -> Option<String> {
        self.providers.get(name).map(|p| p.base_url.clone())
    }
}
