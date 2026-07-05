import * as vscode from "vscode";
import { EngineClient } from "./client";

export interface AiDiagnostic {
  line: number;
  message: string;
  severity: "error" | "warning" | "info";
  fix?: string;
}

const SYSTEM = `You are a code reviewer. Find bugs, security issues, and bad practices.

IMPORTANT: Respond with ONLY a raw JSON array, no markdown, no explanation.
Format: [{"line":1,"message":"description","severity":"error","fix":"fixed line or null"}]
If no issues: []`;

export class DiagnosticsManager {
  private collection: vscode.DiagnosticCollection;
  private client: EngineClient;
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  public lastAiDiags = new Map<string, AiDiagnostic[]>();
  private outputChannel: vscode.OutputChannel;

  constructor(client: EngineClient, outputChannel: vscode.OutputChannel) {
    this.client  = client;
    this.collection   = vscode.languages.createDiagnosticCollection("localforge");
    this.outputChannel = outputChannel;
  }

  scheduleAnalysis(document: vscode.TextDocument, delayMs = 800) {
    const key = document.uri.toString();
    const t = this.timers.get(key);
    if (t) clearTimeout(t);
    this.timers.set(key, setTimeout(() => this.analyse(document), delayMs));
  }

  async analyse(document: vscode.TextDocument): Promise<void> {
    const code = document.getText().trim();
    if (code.length < 30) { return; }
    if (document.lineCount > 400) {
      vscode.window.setStatusBarMessage(
        "LocalForge: file >400 lines — select a region and use Fix Bug instead", 5000
      );
      return;
    }

    vscode.window.setStatusBarMessage("LocalForge ▰ analysing…", 30000);
    this.outputChannel.appendLine(`[analyse] ${document.fileName}`);

    let raw = "";
    try {
      raw = await this.client.complete(
        SYSTEM,
        `Language: ${document.languageId}\n\n${code}`
      );
    } catch (e: any) {
      this.outputChannel.appendLine(`[analyse] engine error: ${e?.message}`);
      vscode.window.setStatusBarMessage("LocalForge ▰ engine not reachable", 5000);
      return;
    }

    this.outputChannel.appendLine(`[analyse] raw response:\n${raw}`);

    const issues = safeParseArray(raw);
    this.outputChannel.appendLine(`[analyse] parsed ${issues.length} issue(s)`);

    const vsDiags: vscode.Diagnostic[] = [];

    for (const issue of issues) {
      const lineIdx = Math.max(0, (Number(issue.line) || 1) - 1);
      if (lineIdx >= document.lineCount) { continue; }

      const line  = document.lineAt(lineIdx);
      const range = new vscode.Range(
        lineIdx, line.firstNonWhitespaceCharacterIndex,
        lineIdx, line.text.length
      );
      const sev =
        issue.severity === "error"   ? vscode.DiagnosticSeverity.Error   :
        issue.severity === "warning" ? vscode.DiagnosticSeverity.Warning :
                                       vscode.DiagnosticSeverity.Information;

      const d      = new vscode.Diagnostic(range, `LocalForge: ${issue.message}`, sev);
      d.source     = "LocalForge";
      d.code       = "AI";
      vsDiags.push(d);
    }

    this.collection.set(document.uri, vsDiags);
    this.lastAiDiags.set(document.uri.toString(), issues);

    const msg = vsDiags.length > 0
      ? `LocalForge ▰ ${vsDiags.length} issue${vsDiags.length > 1 ? "s" : ""} found — Ctrl+Shift+M`
      : "LocalForge ▰ no issues found";
    vscode.window.setStatusBarMessage(msg, 8000);

    if (vsDiags.length > 0) {
      vscode.window.showInformationMessage(
        `LocalForge found ${vsDiags.length} issue(s). Open Problems panel?`,
        "Open Problems"
      ).then(choice => {
        if (choice === "Open Problems") {
          vscode.commands.executeCommand("workbench.actions.view.problems");
        }
      });
    }
  }

  clear(uri: vscode.Uri) {
    this.collection.delete(uri);
    this.lastAiDiags.delete(uri.toString());
  }

  dispose() {
    this.collection.dispose();
    this.timers.forEach(t => clearTimeout(t));
  }
}

// Code action: lightbulb "Apply Fix" on AI squiggles
export class FixCodeActionProvider implements vscode.CodeActionProvider {
  constructor(private dm: DiagnosticsManager) {}

  provideCodeActions(
    document: vscode.TextDocument,
    _range: vscode.Range,
    ctx: vscode.CodeActionContext
  ): vscode.CodeAction[] {
    const actions: vscode.CodeAction[] = [];
    const aiDiags = this.dm.lastAiDiags.get(document.uri.toString()) ?? [];

    for (const diag of ctx.diagnostics) {
      if (diag.source !== "LocalForge") { continue; }

      const ai = aiDiags.find(
        d => (d.line - 1) === diag.range.start.line && d.fix
      );
      if (ai?.fix) {
        const fix     = new vscode.CodeAction("LocalForge: Apply fix", vscode.CodeActionKind.QuickFix);
        fix.edit      = new vscode.WorkspaceEdit();
        fix.edit.replace(document.uri, diag.range, ai.fix);
        fix.diagnostics = [diag];
        fix.isPreferred = true;
        actions.push(fix);
      }

      const explain         = new vscode.CodeAction("LocalForge: Explain issue", vscode.CodeActionKind.QuickFix);
      explain.command       = { command: "localforge.explainCode", title: "Explain", arguments: [diag.message] };
      actions.push(explain);
    }
    return actions;
  }
}

// Hover explanation
export class HoverProvider implements vscode.HoverProvider {
  constructor(private client: EngineClient) {}

  async provideHover(doc: vscode.TextDocument, pos: vscode.Position): Promise<vscode.Hover | undefined> {
    const range = doc.getWordRangeAtPosition(pos);
    if (!range) { return undefined; }
    const word = doc.getText(range);
    if (word.length < 3) { return undefined; }

    const SKIP = ["if","for","while","do","return","const","let","var",
                  "fn","def","class","import","from","export","true","false"];
    if (SKIP.includes(word)) { return undefined; }

    const start   = Math.max(0, pos.line - 4);
    const end     = Math.min(doc.lineCount - 1, pos.line + 4);
    const snippet = doc.getText(new vscode.Range(start, 0, end, 999));

    try {
      const text = await this.client.complete(
        "Explain in ONE sentence (max 20 words) what this identifier does in context. No markdown.",
        `What is \`${word}\` in this code?\n\n${snippet}`
      );
      if (!text) { return undefined; }
      const md = new vscode.MarkdownString(`**LocalForge ▰** ${text}`);
      return new vscode.Hover(md, range);
    } catch {
      return undefined;
    }
  }
}

// ── JSON parser that survives model weirdness ─────────────────────────────

function safeParseArray(raw: string): AiDiagnostic[] {
  if (!raw || raw.trim() === "") { return []; }

  // Strip markdown fences
  let s = raw
    .replace(/^```json\s*/im, "")
    .replace(/^```\s*/im, "")
    .replace(/```\s*$/im, "")
    .trim();

  // Find the first [...] block
  const start = s.indexOf("[");
  const end   = s.lastIndexOf("]");
  if (start === -1 || end === -1 || end < start) { return []; }
  s = s.slice(start, end + 1);

  try {
    const arr = JSON.parse(s);
    if (!Array.isArray(arr)) { return []; }
    return arr.filter((x): x is AiDiagnostic =>
      x && typeof x.line === "number" && typeof x.message === "string"
    );
  } catch {
    return [];
  }
}
