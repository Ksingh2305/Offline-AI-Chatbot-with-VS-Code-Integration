use std::path::PathBuf;
use std::process::Child;
use std::sync::{Arc, Mutex};

use tokio::sync::RwLock;

use crate::rag::RagStore;
use crate::registry::Registry;

pub struct AppState {
    pub registry: Arc<RwLock<Registry>>,
    pub rag: Arc<RwLock<RagStore>>,
    pub http: reqwest::Client,
    pub children: Arc<Mutex<Vec<Child>>>,
    pub res_dir: PathBuf,
}
