import * as vscode from "vscode";
import { EngineClient } from "./client";
import { CompletionProvider } from "./completions";
import { DiagnosticsManager, FixCodeActionProvider, HoverProvider } from "./diagnostics";
import { ChatPanel } from "./chatPanel";
import { StatusBar } from "./statusBar";

export function activate(context: vscode.ExtensionContext) {

  // Output channel — visible in View → Output → select "LocalForge" from dropdown
  const out = vscode.window.createOutputChannel("LocalForge");
  context.subscriptions.push(out);
  out.appendLine("LocalForge activating…");

  // ── Config helpers ───────────────────────────────────────────────────────
  function cfg<T>(key: string): T {
    return vscode.workspace.getConfiguration("localforge").get<T>(key) as T;
  }
  function makeClient() {
    return new EngineClient(
      cfg<string>("engineUrl"),
      cfg<string>("model"),
      cfg<number>("maxTokens")
    );
  }

  let client = makeClient();

  // ── Status bar ───────────────────────────────────────────────────────────
  const statusBar = new StatusBar(client);
  context.subscriptions.push({ dispose: () => statusBar.dispose() });

  // ── Chat panel ───────────────────────────────────────────────────────────
  const chatPanel = new ChatPanel(client, context.extensionUri);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(ChatPanel.viewType, chatPanel, {
      webviewOptions: { retainContextWhenHidden: true },
    })
  );

  // ── Diagnostics manager ──────────────────────────────────────────────────
  const dm = new DiagnosticsManager(client, out);
  context.subscriptions.push({ dispose: () => dm.dispose() });

  // Run diagnostics on every save
  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument((doc) => {
      if (doc.uri.scheme !== "file") { return; }
      out.appendLine(`[save] ${doc.fileName}`);
      if (cfg<boolean>("diagnosticsOnSave")) {
        dm.scheduleAnalysis(doc);
      }
    })
  );

  // Clear when file closes
  context.subscriptions.push(
    vscode.workspace.onDidCloseTextDocument((doc) => dm.clear(doc.uri))
  );

  // ── Hover ────────────────────────────────────────────────────────────────
  context.subscriptions.push(
    vscode.languages.registerHoverProvider(
      { scheme: "file" },
      new HoverProvider(client)
    )
  );

  // ── Code actions (lightbulb fixes) ───────────────────────────────────────
  context.subscriptions.push(
    vscode.languages.registerCodeActionsProvider(
      { scheme: "file" },
      new FixCodeActionProvider(dm),
      { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix] }
    )
  );

  // ── Inline completions ───────────────────────────────────────────────────
  // Registered unconditionally — user can turn off via setting
  const completionProvider = new CompletionProvider(
    client,
    cfg<number>("completionDebounceMs")
  );
  context.subscriptions.push(
    vscode.languages.registerInlineCompletionItemProvider(
      { scheme: "file" },
      completionProvider
    )
  );
  out.appendLine("Inline completion provider registered");

  // ── Commands ─────────────────────────────────────────────────────────────

  context.subscriptions.push(
    vscode.commands.registerCommand("localforge.openChat", () => {
      vscode.commands.executeCommand("localforge.chatView.focus");
    })
  );

  // Analyse current file NOW (manual trigger — no need to save)
  context.subscriptions.push(
    vscode.commands.registerCommand("localforge.analyzeFile", async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showWarningMessage("LocalForge: open a file first.");
        return;
      }
      out.show(true); // show output so user can see what's happening
      await dm.analyse(editor.document);
    })
  );

  // Explain selection / current line
  context.subscriptions.push(
    vscode.commands.registerCommand("localforge.explainCode", async (extra?: string) => {
      const editor  = vscode.window.activeTextEditor;
      const snippet = extra ?? getSnippet(editor);
      if (!snippet) { return; }
      const lang = editor?.document.languageId ?? "code";

      await withProgress("Explaining…", async () => {
        const result = await client.complete(
          "Explain this code clearly and concisely. Use plain language.",
          `Language: ${lang}\n\n\`\`\`\n${snippet}\n\`\`\``
        );
        chatPanel.sendToChat(
          `**Explain:**\n\`\`\`${lang}\n${snippet}\n\`\`\`\n\n${result}`
        );
      });
    })
  );

  // Fix bug
  context.subscriptions.push(
    vscode.commands.registerCommand("localforge.fixBug", async () => {
      const editor  = vscode.window.activeTextEditor;
      const snippet = getSnippet(editor);
      if (!snippet || !editor) { return; }
      const lang = editor.document.languageId;

      await withProgress("Finding and fixing bugs…", async () => {
        const result = await client.complete(
          "Find and fix ALL bugs in this code. Return ONLY the fixed code in a markdown fence, no explanation.",
          `Language: ${lang}\n\n\`\`\`\n${snippet}\n\`\`\``
        );
        const fixed = extractCode(result);
        if (fixed && !editor.selection.isEmpty) {
          const choice = await vscode.window.showInformationMessage(
            "LocalForge: bug fix ready — apply it?",
            "Apply", "Show in Chat"
          );
          if (choice === "Apply") {
            const edit = new vscode.WorkspaceEdit();
            edit.replace(editor.document.uri, editor.selection, fixed);
            await vscode.workspace.applyEdit(edit);
            return;
          }
        }
        chatPanel.sendToChat(
          `**Fix bug:**\n\`\`\`${lang}\n${snippet}\n\`\`\`\n\n${result}`
        );
      });
    })
  );

  // Refactor
  context.subscriptions.push(
    vscode.commands.registerCommand("localforge.refactorCode", async () => {
      const editor  = vscode.window.activeTextEditor;
      const snippet = getSnippet(editor);
      if (!snippet || !editor) { return; }
      const lang = editor.document.languageId;

      await withProgress("Refactoring…", async () => {
        const result = await client.complete(
          "Refactor this code for clarity, better naming, and simplicity. " +
          "Return ONLY the refactored code in a markdown fence.",
          `Language: ${lang}\n\n\`\`\`\n${snippet}\n\`\`\``
        );
        const refactored = extractCode(result);
        if (refactored && !editor.selection.isEmpty) {
          const choice = await vscode.window.showInformationMessage(
            "LocalForge: refactor ready — apply it?",
            "Apply", "Show in Chat"
          );
          if (choice === "Apply") {
            const edit = new vscode.WorkspaceEdit();
            edit.replace(editor.document.uri, editor.selection, refactored);
            await vscode.workspace.applyEdit(edit);
            return;
          }
        }
        chatPanel.sendToChat(
          `**Refactor:**\n\`\`\`${lang}\n${snippet}\n\`\`\`\n\n${result}`
        );
      });
    })
  );

  // Generate tests
  context.subscriptions.push(
    vscode.commands.registerCommand("localforge.generateTests", async () => {
      const editor  = vscode.window.activeTextEditor;
      const snippet = getSnippet(editor);
      if (!snippet || !editor) { return; }
      const lang = editor.document.languageId;

      await withProgress("Generating tests…", async () => {
        const result = await client.complete(
          "Write comprehensive unit tests including edge cases. " +
          "Use the standard testing framework for the language.",
          `Language: ${lang}\n\n\`\`\`\n${snippet}\n\`\`\``
        );
        chatPanel.sendToChat(
          `**Tests for:**\n\`\`\`${lang}\n${snippet}\n\`\`\`\n\n${result}`
        );
      });
    })
  );

  // Re-read config on settings change
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("localforge")) {
        client = makeClient();
        out.appendLine("Config reloaded.");
      }
    })
  );

  out.appendLine("LocalForge ready.");
  vscode.window.setStatusBarMessage("LocalForge ▰ ready", 4000);
}

export function deactivate() {}

// ── Helpers ───────────────────────────────────────────────────────────────

function getSnippet(editor?: vscode.TextEditor): string {
  if (!editor) {
    vscode.window.showWarningMessage("LocalForge: open a file first.");
    return "";
  }
  const sel = editor.selection;
  if (!sel.isEmpty) { return editor.document.getText(sel); }
  return editor.document.lineAt(sel.active.line).text;
}

function extractCode(text: string): string {
  const m = text.match(/```[a-zA-Z]*\n?([\s\S]*?)```/);
  return m ? m[1].trim() : text.trim();
}

async function withProgress(title: string, fn: () => Promise<void>) {
  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: `LocalForge: ${title}` },
    async () => {
      try { await fn(); }
      catch (e: any) {
        vscode.window.showErrorMessage(
          `LocalForge error: ${e?.message ?? String(e)}. Is LocalForge desktop app running?`
        );
      }
    }
  );
}
