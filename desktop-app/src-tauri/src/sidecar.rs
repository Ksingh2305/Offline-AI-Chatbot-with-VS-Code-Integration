use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};

use tauri::{AppHandle, Manager};

use crate::registry::Registry;

/// Find the `llama/` folder that contains `llama-server.exe`.
pub fn resource_root(app: &AppHandle) -> PathBuf {
    if let Ok(rd) = app.path().resource_dir() {
        if rd.join("llama").exists() { return rd; }
        if rd.join("resources").join("llama").exists() { return rd.join("resources"); }
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            if dir.join("llama").exists() { return dir.to_path_buf(); }
        }
    }
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources")
}

/// Find the models directory. Priority order:
///   1. C:\ProgramData\LocalForge\models   (written by install-models.ps1)
///   2. Folder named "models" next to the running .exe  (portable/USB)
///   3. src-tauri/resources/models          (dev mode)
pub fn find_models_dir() -> Option<PathBuf> {
    let mut candidates: Vec<PathBuf> = vec![
        PathBuf::from(r"C:\ProgramData\LocalForge\models"),
    ];
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            candidates.push(dir.join("models"));
        }
    }
    candidates.push(
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("resources")
            .join("models"),
    );

    for path in candidates {
        if path.exists() {
            if let Ok(rd) = std::fs::read_dir(&path) {
                let has_gguf = rd.flatten().any(|e| {
                    e.path().extension().and_then(|x| x.to_str()) == Some("gguf")
                });
                if has_gguf { return Some(path); }
            }
        }
    }
    None
}

pub fn start_all(reg: &Registry, res: &Path, children: &Arc<Mutex<Vec<Child>>>) {
    let server = res.join("llama").join(server_exe());
    if !server.exists() {
        eprintln!("[sidecar] {} not found — run fetch-deps.ps1 first", server.display());
        return;
    }
    let models_dir = match find_models_dir() {
        Some(d) => d,
        None => {
            eprintln!(
                "[sidecar] No models dir found. \
                 Copy .gguf files to C:\\ProgramData\\LocalForge\\models\\ \
                 or run install-models.ps1"
            );
            return;
        }
    };
    eprintln!("[sidecar] models dir: {}", models_dir.display());

    for sc in &reg.sidecars {
        let filename = Path::new(&sc.model_file)
            .file_name()
            .unwrap_or_else(|| std::ffi::OsStr::new(&sc.model_file));
        let model = models_dir.join(filename);
        if !model.exists() {
            eprintln!("[sidecar] missing model '{}' — skipping", model.display());
            continue;
        }
        match spawn(&server, &models_dir, &model, sc.port, sc.ctx, sc.embedding) {
            Ok(child) => {
                eprintln!("[sidecar] started '{}' on :{}", sc.name, sc.port);
                children.lock().unwrap().push(child);
            }
            Err(e) => eprintln!("[sidecar] failed to start '{}': {e}", sc.name),
        }
    }
}

fn server_exe() -> &'static str {
    if cfg!(windows) { "llama-server.exe" } else { "llama-server" }
}

fn spawn(server: &Path, models_dir: &Path, model: &Path, port: u16, ctx: u32, embedding: bool) -> std::io::Result<Child> {
    let mut cmd = Command::new(server);
    cmd.current_dir(server.parent().unwrap_or(Path::new(".")))
        .arg("-m").arg(model)
        .arg("--host").arg("127.0.0.1")
        .arg("--port").arg(port.to_string())
        .arg("-c").arg(ctx.to_string())
        .arg("-t").arg(threads().to_string());

    // Write a log file for troubleshooting
    let log = models_dir.join(format!("llama-{port}.log"));
    if let Ok(f) = std::fs::File::create(&log) {
        cmd.stdout(Stdio::from(f.try_clone().unwrap_or_else(|_| std::fs::File::create("nul").unwrap())));
        cmd.stderr(Stdio::from(f));
    } else {
        cmd.stdout(Stdio::null()).stderr(Stdio::null());
    }

    if embedding {
        cmd.arg("--embeddings").arg("--pooling").arg("mean");
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    cmd.spawn()
}

fn threads() -> usize {
    std::thread::available_parallelism()
        .map(|n| n.get().saturating_sub(1).max(1))
        .unwrap_or(4)
}
