# LocalForge — Tier A (16 GB, Windows 11)

A fully offline, ChatGPT-style local coding assistant. The shipped installer bundles
the inference engine (`llama-server.exe`) **and** the model (GGUF) inside it, so it
installs and runs on another PC with **no internet**.

- Chat with a local coding model (generate, explain, refactor, debug)
- Repository RAG (index a folder, ask about your code — all on-device)
- Swappable models via `registry.yaml`, no recompile
- One Windows `.exe` installer that carries everything

---

## How it works (30-second mental model)

```
LocalForge.exe (Tauri app)
   ├─ on startup, launches bundled llama-server.exe twice:
   │     • chat model   on 127.0.0.1:8080
   │     • embed model  on 127.0.0.1:8081   (for RAG)
   ├─ Rust core talks to them over a local OpenAI-compatible API
   └─ React UI streams tokens, indexes your repo, swaps models
```

Everything is loopback-only. No network calls at runtime.

---

## Part 1 — One-time setup on your DEV machine (needs internet)

You build the installer once on a machine with internet. The *output* needs none.

### 1. Install the toolchain
- **Node.js 20+** — https://nodejs.org
- **Rust** — https://rustup.rs (run `rustup-init.exe`, accept defaults)
- **Microsoft C++ Build Tools** — "Desktop development with C++" workload
  (https://visualstudio.microsoft.com/visual-cpp-build-tools/)
- **WebView2 Runtime** — preinstalled on Windows 11; if missing, get the
  *Evergreen Standalone* installer from Microsoft. (Tauri's NSIS installer can
  also auto-install it; for fully offline targets, see Part 4.)

Verify:
```powershell
node -v
rustc --version
```

### 2. Install project dependencies
From the project root:
```powershell
npm install
```

### 3. Generate the app icons (one command, makes every size)
```powershell
npx tauri icon app-icon.png
```

### 4. Fetch the engine + models into the bundle
This downloads `llama-server.exe` + DLLs and the two GGUF models into
`src-tauri/resources/`:
```powershell
./scripts/fetch-deps.ps1
```
> If PowerShell blocks the script: `Set-ExecutionPolicy -Scope Process Bypass` then re-run.

---

## Part 2 — Run it in development

```powershell
npm run tauri dev
```
First launch shows "Heating the forge" while the model loads into RAM (slowest the
first time). Then chat. Paste a folder path in the sidebar → **Index folder** →
tick **Use repo context** → ask about your code.

### Swapping models (no code changes)
Two ways:
1. **In-app:** use the Model dropdown in the header.
2. **By config:** edit the registry that was seeded on first run at
   `%APPDATA%\com.localforge.app\registry.yaml`. Change `active:` or add a model
   entry, then restart.

To bundle a **stronger 7B** chat model instead of the default 3B, edit
`scripts/fetch-deps.ps1` (`$ChatUrl`/`$ChatFile`) and the `chat` sidecar
`model_file` in `src-tauri/registry.yaml` to match, then re-run fetch-deps. See
Part 4 about installer size.

---

## Part 3 — Build the offline installer (.exe)

```powershell
npm run tauri build
```
Output:
```
src-tauri/target/release/bundle/nsis/LocalForge_0.1.0_x64-setup.exe
```
This single `.exe` contains the app, `llama-server.exe`, and the GGUF models.

### Install it on another PC with NO internet
1. Copy the `.exe` to the other Windows 11 PC (USB stick, etc.).
2. Double-click → install.
3. Launch **LocalForge**. It starts the bundled engine and works offline.

> The target PC needs the **WebView2 Runtime**. Windows 11 has it. For older/locked-down
> machines, see Part 4.

---

## Part 4 — Edge cases for "works on a fresh PC"

**Installer too big?** A 3B model keeps the `.exe` near ~2.5 GB (fine for NSIS).
A 7B model (~4.7 GB) can exceed NSIS's comfortable single-file limit. Options:
- Keep the 3B default (simplest single `.exe`).
- Use `scripts/make-sfx.ps1` to wrap the installer + a large model into one
  self-extracting `.exe` (needs 7-Zip). No size ceiling.
- Or ship the small installer plus the `.gguf` as a side file copied next to it.

**Offline WebView2.** If the target may lack WebView2, download Microsoft's
*Evergreen Standalone* WebView2 installer on your dev machine and include it; run it
once on the target before LocalForge. (Windows 11 already includes it.)

**GPU later (optional).** Swap the CPU `llama-server` for a CUDA build in
`fetch-deps.ps1` and the same code path lights up your GPU — no app changes.

---

## Project layout

```
localforge-tier-a/
├─ app-icon.png              # source icon (npx tauri icon turns this into all sizes)
├─ index.html, src/          # React + TS frontend
│  ├─ App.tsx                # chat UI, model picker, repo panel, status bar
│  └─ lib/ipc.ts             # typed wrappers over Rust commands
├─ src-tauri/
│  ├─ registry.yaml          # the swappable-model config (seeded to %APPDATA%)
│  ├─ tauri.conf.json        # NSIS target + bundles resources/**
│  ├─ resources/             # fetched: llama/ (engine) + models/ (gguf)
│  └─ src/
│     ├─ lib.rs              # startup, state, sidecar launch, exit cleanup
│     ├─ sidecar.rs          # launches bundled llama-server instances
│     ├─ registry.rs         # registry model + loader
│     ├─ providers/          # ModelProvider trait + ollama + llamacpp
│     ├─ rag/                # chunk → embed → store → retrieve
│     └─ commands.rs         # IPC: chat_stream, index_repo, engine_ready, ...
└─ scripts/
   ├─ fetch-deps.ps1         # pull engine + models before building
   └─ make-sfx.ps1           # optional single-.exe wrapper for big models
```

## Troubleshooting

- **Stuck on "Heating the forge":** the engine is still loading (big model + cold
  disk). Give it a minute on first run. If it never connects, run
  `src-tauri/resources/llama/llama-server.exe -m src-tauri/resources/models/<chat>.gguf`
  manually to see its output.
- **`llama-server.exe not found` in console:** you didn't run `fetch-deps.ps1`, so
  the app expects an external Ollama instead. Either run fetch-deps, or start Ollama
  and switch the active model to `qwen-coder-ollama`.
- **Build can't find icons:** run `npx tauri icon app-icon.png` first.
