mod commands;
mod providers;
mod rag;
mod registry;
mod sidecar;
mod state;
mod types;

use std::sync::{Arc, Mutex};

use tauri::Manager;

use state::AppState;

pub fn run() {
    // Shared handle to sidecar child processes so we can kill them on exit.
    let children = Arc::new(Mutex::new(Vec::<std::process::Child>::new()));
    let children_setup = children.clone();
    let children_exit = children.clone();

    tauri::Builder::default()
        .setup(move |app| {
            let handle = app.handle().clone();

            // 1) Seed a user-editable registry into the OS config dir on first run.
            let cfg_dir = handle.path().app_config_dir().expect("config dir");
            std::fs::create_dir_all(&cfg_dir).ok();
            let reg_path = cfg_dir.join("registry.yaml");
            if !reg_path.exists() {
                std::fs::write(&reg_path, include_str!("../registry.yaml")).ok();
            }
            let registry = registry::Registry::load(&reg_path).expect("failed to load registry.yaml");

            // 2) Locate bundled resources (llama-server + GGUF models).
            let res_dir = sidecar::resource_root(&handle);

            // 3) Manage app state.
            let st = AppState {
                registry: Arc::new(tokio::sync::RwLock::new(registry.clone())),
                rag: Arc::new(tokio::sync::RwLock::new(rag::RagStore::default())),
                http: reqwest::Client::new(),
                children: children_setup.clone(),
                res_dir: res_dir.clone(),
            };
            app.manage(st);

            // 4) Start the bundled inference engine (no-op if binaries absent).
            sidecar::start_all(&registry, &res_dir, &children_setup);

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::list_models,
            commands::set_active_model,
            commands::engine_ready,
            commands::chat_stream,
            commands::index_repo,
            commands::rag_status,
        ])
        .build(tauri::generate_context!())
        .expect("error while building LocalForge")
        .run(move |_app, event| {
            if let tauri::RunEvent::Exit = event {
                if let Ok(mut procs) = children_exit.lock() {
                    for child in procs.iter_mut() {
                        let _ = child.kill();
                    }
                }
            }
        });
}
