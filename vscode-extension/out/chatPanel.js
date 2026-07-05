"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.ChatPanel = void 0;
const vscode = __importStar(require("vscode"));
class ChatPanel {
    constructor(client, extensionUri) {
        this.extensionUri = extensionUri;
        this.history = [];
        this.client = client;
    }
    resolveWebviewView(view) {
        this.view = view;
        view.webview.options = { enableScripts: true };
        view.webview.html = this.getHtml();
        view.webview.onDidReceiveMessage((msg) => {
            switch (msg.type) {
                case "send":
                    this.handleSend(msg.text);
                    break;
                case "clear":
                    this.handleClear();
                    break;
                case "cancel":
                    this.cancelStream?.();
                    break;
                case "useFile":
                    this.injectCurrentFile();
                    break;
            }
        });
    }
    /** Called by commands to pre-fill the chat with selected code. */
    sendToChat(userText) {
        this.view?.webview.postMessage({ type: "prefill", text: userText });
        vscode.commands.executeCommand("localforge.chatView.focus");
    }
    async handleSend(text) {
        if (!text.trim())
            return;
        this.history.push({ role: "user", content: text });
        this.view?.webview.postMessage({ type: "userMsg", text });
        this.view?.webview.postMessage({ type: "assistantStart" });
        this.cancelStream = this.client.streamChat([
            {
                role: "system",
                content: "You are LocalForge, an expert coding assistant. " +
                    "Format code in markdown fences. Be concise and practical.",
            },
            ...this.history,
        ], (tok) => this.view?.webview.postMessage({ type: "token", text: tok }), (full) => {
            this.history.push({ role: "assistant", content: full });
            this.view?.webview.postMessage({ type: "assistantDone" });
        }, (err) => {
            this.view?.webview.postMessage({
                type: "error",
                text: `Engine error: ${err.message}`,
            });
        });
    }
    handleClear() {
        this.history = [];
        this.view?.webview.postMessage({ type: "cleared" });
    }
    injectCurrentFile() {
        const editor = vscode.window.activeTextEditor;
        if (!editor)
            return;
        const code = editor.document.getText();
        const lang = editor.document.languageId;
        const name = editor.document.fileName.split(/[\\/]/).pop() ?? "file";
        const snippet = `Here is my file \`${name}\`:\n\`\`\`${lang}\n${code.slice(0, 8000)}\n\`\`\``;
        this.view?.webview.postMessage({ type: "prefill", text: snippet });
    }
    getHtml() {
        return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:var(--vscode-font-family);font-size:var(--vscode-font-size);
       background:var(--vscode-sideBar-background);color:var(--vscode-foreground);
       display:flex;flex-direction:column;height:100vh;overflow:hidden}
  #toolbar{display:flex;gap:6px;padding:8px;border-bottom:1px solid var(--vscode-panel-border)}
  button{background:var(--vscode-button-background);color:var(--vscode-button-foreground);
         border:none;border-radius:4px;padding:4px 10px;cursor:pointer;font-size:12px}
  button:hover{background:var(--vscode-button-hoverBackground)}
  button.secondary{background:var(--vscode-button-secondaryBackground);
                   color:var(--vscode-button-secondaryForeground)}
  #messages{flex:1;overflow-y:auto;padding:10px;display:flex;flex-direction:column;gap:10px}
  .msg{max-width:100%;border-radius:6px;padding:8px 10px;line-height:1.5;font-size:13px}
  .user{background:var(--vscode-inputOption-activeBackground);
        color:var(--vscode-inputOption-activeForeground);align-self:flex-end}
  .assistant{background:var(--vscode-editor-inactiveSelectionBackground);align-self:flex-start}
  .assistant pre{background:var(--vscode-editor-background);border-radius:4px;
                 padding:8px;overflow-x:auto;margin-top:6px}
  .assistant code{font-family:var(--vscode-editor-font-family);font-size:12px}
  .caret{animation:blink 1s steps(1) infinite}
  @keyframes blink{50%{opacity:0}}
  #composer{border-top:1px solid var(--vscode-panel-border);padding:8px;display:flex;gap:6px}
  #input{flex:1;resize:none;background:var(--vscode-input-background);
         color:var(--vscode-input-foreground);border:1px solid var(--vscode-input-border);
         border-radius:4px;padding:6px;font-family:inherit;font-size:13px}
  #input:focus{outline:1px solid var(--vscode-focusBorder)}
  #sendBtn{align-self:flex-end;padding:6px 14px}
  .empty{color:var(--vscode-descriptionForeground);font-size:12px;text-align:center;
         margin-top:30px;line-height:1.8}
</style>
</head>
<body>
<div id="toolbar">
  <button onclick="useFile()">📄 Use current file</button>
  <button class="secondary" onclick="clearChat()">Clear</button>
</div>
<div id="messages">
  <div class="empty" id="empty">
    Ask anything about your code.<br>
    Press <b>📄 Use current file</b> to include the open editor.
  </div>
</div>
<div id="composer">
  <textarea id="input" rows="3" placeholder="Ask LocalForge…  (Enter to send)"></textarea>
  <button id="sendBtn" onclick="send()">Send</button>
</div>
<script>
  const vscode = acquireVsCodeApi();
  const msgs = document.getElementById('messages');
  const input = document.getElementById('input');
  const empty = document.getElementById('empty');
  let currentBubble = null;
  let currentText = '';
  let busy = false;

  input.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  });

  function send() {
    const t = input.value.trim();
    if (!t || busy) return;
    input.value = '';
    vscode.postMessage({ type: 'send', text: t });
  }
  function clearChat() { vscode.postMessage({ type: 'clear' }); }
  function useFile()   { vscode.postMessage({ type: 'useFile' }); }

  function addBubble(cls, html) {
    empty.style.display = 'none';
    const d = document.createElement('div');
    d.className = 'msg ' + cls;
    d.innerHTML = html;
    msgs.appendChild(d);
    msgs.scrollTop = msgs.scrollHeight;
    return d;
  }

  window.addEventListener('message', ({ data }) => {
    switch (data.type) {
      case 'userMsg':
        addBubble('user', esc(data.text));
        break;
      case 'assistantStart':
        busy = true;
        currentText = '';
        currentBubble = addBubble('assistant', '<span class="caret">▍</span>');
        break;
      case 'token':
        currentText += data.text;
        if (currentBubble) {
          currentBubble.innerHTML = renderMarkdown(currentText) + '<span class="caret">▍</span>';
          msgs.scrollTop = msgs.scrollHeight;
        }
        break;
      case 'assistantDone':
        busy = false;
        if (currentBubble) {
          currentBubble.innerHTML = renderMarkdown(currentText);
        }
        currentBubble = null;
        break;
      case 'error':
        busy = false;
        addBubble('assistant', '<span style="color:var(--vscode-errorForeground)">' + esc(data.text) + '</span>');
        break;
      case 'prefill':
        input.value = data.text;
        input.focus();
        break;
      case 'cleared':
        msgs.innerHTML = '';
        msgs.appendChild(empty);
        empty.style.display = '';
        break;
    }
  });

  // Minimal markdown: code fences + inline code
  function renderMarkdown(text) {
    return esc(text)
      .replace(/\`\`\`([\\s\\S]*?)\`\`\`/g, (_,c) => '<pre><code>' + c + '</code></pre>')
      .replace(/\`([^\`]+)\`/g, '<code>$1</code>')
      .replace(/\\n/g, '<br>');
  }
  function esc(s) {
    return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }
</script>
</body>
</html>`;
    }
}
exports.ChatPanel = ChatPanel;
ChatPanel.viewType = "localforge.chatView";
//# sourceMappingURL=chatPanel.js.map