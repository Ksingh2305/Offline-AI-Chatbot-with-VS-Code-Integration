<div align="center">

# ▰ LocalForge

### A fully offline AI coding assistant — no cloud, no API keys, no data leaving your machine

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20Linux-blue)](#installation)
[![Built with Tauri](https://img.shields.io/badge/built%20with-Tauri%202-24C8DB)](https://tauri.app)
[![VS Code Extension](https://img.shields.io/badge/VS%20Code-Extension-007ACC)](vscode-extension)

[Features](#features) · [Architecture](#architecture) · [Installation](#installation) · [Usage](#usage) · [Tech Stack](#tech-stack)

</div>

---

## Why LocalForge

Every mainstream AI coding assistant — Copilot, Cursor, Cody — sends your code to a cloud API. For developers working on proprietary codebases, regulated industries, or air-gapped environments, that's a non-starter.

**LocalForge runs entirely on your machine.** The model, the inference engine, and the code index never touch the network. You can disconnect from the internet entirely and it works exactly the same.

---

## Features

| | |
|---|---|
| 🧠 **Local LLM chat** | ChatGPT-style conversational coding assistant, powered by a quantised model running on your CPU |
| 🔍 **Real-time diagnostics** | AI-powered bug detection, security scanning, and performance analysis — squiggles appear as you save |
| 🛠️ **Code actions** | Explain, Fix Bug, Refactor, and Generate Tests — right-click any selection |
| ⌨️ **Inline completions** | Ghost-text suggestions as you type, tuned for CPU-only latency |
| 📚 **Repository RAG** | Index a codebase and get answers grounded in your actual code, with retrieval over embedded chunks |
| 🔌 **VS Code integration** | Full extension: sidebar chat, hover explanations, quick-fix lightbulbs, command palette |
| 📦 **True offline installer** | Single Windows installer bundles the inference engine and model — installs on air-gapped machines |
| 🔄 **Swappable models** | Change the active model by editing one YAML file — no recompilation |

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Desktop App (Tauri 2)                  │
│  ┌───────────────────────┐    ┌────────────────────────┐  │
│  │  React + TypeScript    │◄──►│  Rust Core              │  │
│  │  Chat UI · RAG panel   │IPC │  Model router · Sidecar │  │
│  │  Model picker          │    │  manager · RAG engine   │  │
│  └───────────────────────┘    └───────────┬─────────────┘  │
└──────────────────────────────────────────┼─────────────────┘
                                            │ localhost:8080
                              ┌─────────────▼─────────────┐
                              │   llama-server (llama.cpp)  │
                              │   Runs the GGUF model        │
                              └─────────────┬─────────────┘
                                            │
                              ┌─────────────▼─────────────┐
                              │  Qwen2.5-Coder-3B (GGUF)    │
                              │  Fully local, on-disk        │
                              └───────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│              VS Code Extension (TypeScript)                │
│   Inline completions · Diagnostics · Sidebar chat ·         │
│   Code actions · Hover explanations                         │
│   ─── talks to the same localhost:8080 engine above ───     │
└─────────────────────────────────────────────────────────┘
```

**Design decision — why Tauri, not Electron:** on a 16 GB target machine, RAM is the scarce resource. Tauri's Rust core idles at a fraction of Electron's footprint, leaving more headroom for the model itself. Tauri's bundler also natively produces the Windows installer format this project ships as.

**Design decision — why the engine is bundled, not assumed:** rather than requiring the user to separately install Ollama, the app bundles `llama-server.exe` and the model file as resources and manages the process lifecycle itself. This is what makes a genuinely offline, single-installer experience possible.

Full write-up: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)

---

## Tech Stack

| Layer | Technology |
|---|---|
| Desktop shell | **Tauri 2** |
| Backend engine | **Rust** (tokio, reqwest, serde) |
| Frontend | **React 18 + TypeScript + Vite** |
| Inference | **llama.cpp** (`llama-server`) |
| Model format | **GGUF** — Qwen2.5-Coder-3B-Instruct |
| RAG | Custom chunking + cosine similarity retrieval |
| Editor integration | **VS Code Extension API** (TypeScript) |
| Packaging | Tauri bundler (NSIS) + 7-Zip SFX for single-file offline install |

---

## Repository structure

```
localforge/
├─ desktop-app/            The Tauri application
│  ├─ src/                 React frontend
│  └─ src-tauri/           Rust backend, model providers, RAG engine
├─ vscode-extension/       The VS Code extension
│  └─ src/                 Completions, diagnostics, chat panel, commands
└─ docs/                   Architecture notes and screenshots
```

---

## Installation

### Prerequisites (for building from source)
- Node.js 20+
- Rust (via [rustup](https://rustup.rs))
- Microsoft C++ Build Tools (Windows) — "Desktop development with C++" workload

### Build the desktop app

```bash
cd desktop-app
npm install
npx tauri icon app-icon.png

# Fetch the inference engine + model (one-time, needs internet)
./scripts/fetch-deps.ps1        # Windows
# or point at your own GGUF model — see desktop-app/README.md

npm run tauri dev               # run in development
npm run tauri build             # produce the installer
```

The installer is written to `desktop-app/src-tauri/target/release/bundle/nsis/`.

### Build the VS Code extension

```bash
cd vscode-extension
npm install
npm run compile
npx vsce package --no-dependencies
code --install-extension localforge-*.vsix
```

Full step-by-step guides with troubleshooting: [`desktop-app/README.md`](desktop-app/README.md) and [`vscode-extension/README.md`](vscode-extension/README.md).

---

## Usage

1. Launch **LocalForge** — it starts the bundled inference engine and loads the model
2. Open VS Code with the LocalForge extension installed
3. **Chat** — click the ▰ icon in the activity bar
4. **Inline completions** — just type, ghost text appears
5. **Diagnostics** — save a file, AI-powered issues appear in the Problems panel
6. **Commands** — select code → right-click → LocalForge ▰ → Explain / Fix Bug / Refactor / Generate Tests
7. **Repository context** — index a folder from the sidebar, then toggle "Use repo context" for codebase-aware answers

---

## Design notes

- **Loopback-only networking.** The engine binds to `127.0.0.1` exclusively. No remote calls are made at runtime — this was verified by testing with networking disabled.
- **Model swapping without recompilation.** A `ModelProvider` trait abstracts inference backends; switching the active model is a one-line change in `registry.yaml`.
- **Two-layer diagnostics.** Fast pattern-based checks run instantly; deeper LLM-based analysis runs on save, debounced to avoid overwhelming a CPU-only model.
- **Hardware-aware defaults.** The bundled model (3B, Q4 quantisation) was chosen specifically to fit comfortably in 16 GB of RAM on CPU-only hardware — the most common constraint for a genuinely offline tool.

---

## Roadmap

- [ ] JetBrains and Neovim integrations via a shared LSP server
- [ ] Optional GPU acceleration (CUDA/Vulkan) for supported hardware
- [ ] Automatic workspace indexing (currently manual per-folder)
- [ ] Linux installer targets (.deb / .AppImage)

---

## License

MIT — see [LICENSE](LICENSE).

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).
