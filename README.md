# LocalForge VS Code Extension

Offline AI coding assistant — code analysis, suggestions, chat, and debugging inside VS Code.
Talks to the LocalForge desktop app running on your machine. **No internet needed at runtime.**

---

## What you get

| Feature | How to use |
|---|---|
| **Inline completions** | Just type — ghost text appears, press Tab to accept |
| **AI diagnostics** | Save a file — squiggles appear in the editor and Problems panel |
| **Quick fixes** | Click a squiggle lightbulb — "Apply Fix" or "Explain this issue" |
| **Explain code** | Select code → right-click → LocalForge ▰ → Explain Code |
| **Fix bug** | Select code → right-click → Fix Bug — Apply or view in chat |
| **Refactor** | Select code → right-click → Refactor Code — Apply or view in chat |
| **Generate tests** | Select code → right-click → Generate Tests |
| **Sidebar chat** | Click the ▰ icon in the activity bar |
| **Hover tooltip** | Hover over a function name for a one-line explanation |
| **Analyse entire file** | Command Palette → "LocalForge: Analyse Entire File" |

---

## Step-by-step install

### Prerequisites
- LocalForge desktop app is installed and running (the engine must be up)
- VS Code 1.85 or later
- Node.js 20+

### 1. Install dependencies
Open a terminal in the `localforge-vscode` folder:
```powershell
cd path\to\localforge-vscode
npm install
```

### 2. Compile the TypeScript
```powershell
npm run compile
```
This produces the `out\` folder. You need to do this once before packaging or running.

### 3. Test it in VS Code (development mode — fastest way to try it)
```powershell
code .
```
Then press **F5**. This opens a new VS Code window with the extension loaded.
Open any code file in that window, save it, and watch the squiggles appear.

### 4. Package it as a .vsix (the installable file)
```powershell
npm run package
```
This creates `localforge-0.1.0.vsix` in the folder.

### 5. Install the .vsix into VS Code permanently
**Option A — drag and drop:**
Drag `localforge-0.1.0.vsix` onto the VS Code window.

**Option B — command line:**
```powershell
code --install-extension localforge-0.1.0.vsix
```

**Option C — VS Code UI:**
Extensions panel (Ctrl+Shift+X) → `···` menu (top right) → "Install from VSIX…" → pick the file.

Restart VS Code. The ▰ icon appears in the activity bar.

---

## Configuration

Open Settings (Ctrl+,) and search "LocalForge":

| Setting | Default | What it does |
|---|---|---|
| `localforge.engineUrl` | `http://127.0.0.1:8080` | Where the llama-server is listening |
| `localforge.model` | `qwen2.5-coder-3b` | Model label sent in requests |
| `localforge.inlineCompletions` | `true` | Turn ghost-text completions on/off |
| `localforge.completionDebounceMs` | `600` | How long to wait after typing before requesting |
| `localforge.diagnosticsOnSave` | `true` | Run analysis on save |
| `localforge.maxTokens` | `1024` | Max tokens per response |

### If the engine URL is different
If you changed the llama-server port in `registry.yaml`, update `localforge.engineUrl` to match.

---

## Troubleshooting

**Status bar shows "LocalForge offline":**
The desktop app isn't running, or the engine is still warming up. Launch LocalForge first,
wait for the "Heating the forge" screen to pass, then try again.

**No squiggles appearing:**
Check that `localforge.diagnosticsOnSave` is `true` and save the file (Ctrl+S).
Also check the Problems panel (Ctrl+Shift+M) — if nothing is there, the engine may have
returned an empty analysis (common for very short files or files the model doesn't recognise).

**Completions don't appear:**
Make sure `localforge.inlineCompletions` is enabled. The completion fires after the debounce
delay — default 600ms. Increase it if you're on a slower CPU.

**"Engine error: connect ECONNREFUSED":**
The LocalForge desktop app is closed. Start it, wait for warmup, then save a file to trigger.
