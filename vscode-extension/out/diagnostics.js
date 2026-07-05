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
exports.HoverProvider = exports.FixCodeActionProvider = exports.DiagnosticsManager = void 0;
const vscode = __importStar(require("vscode"));
const SYSTEM = `You are a code reviewer. Find bugs, security issues, and bad practices.

IMPORTANT: Respond with ONLY a raw JSON array, no markdown, no explanation.
Format: [{"line":1,"message":"description","severity":"error","fix":"fixed line or null"}]
If no issues: []`;
class DiagnosticsManager {
    constructor(client, outputChannel) {
        this.timers = new Map();
        this.lastAiDiags = new Map();
        this.client = client;
        this.collection = vscode.languages.createDiagnosticCollection("localforge");
        this.outputChannel = outputChannel;
    }
    scheduleAnalysis(document, delayMs = 800) {
        const key = document.uri.toString();
        const t = this.timers.get(key);
        if (t)
            clearTimeout(t);
        this.timers.set(key, setTimeout(() => this.analyse(document), delayMs));
    }
    async analyse(document) {
        const code = document.getText().trim();
        if (code.length < 30) {
            return;
        }
        if (document.lineCount > 400) {
            vscode.window.setStatusBarMessage("LocalForge: file >400 lines — select a region and use Fix Bug instead", 5000);
            return;
        }
        vscode.window.setStatusBarMessage("LocalForge ▰ analysing…", 30000);
        this.outputChannel.appendLine(`[analyse] ${document.fileName}`);
        let raw = "";
        try {
            raw = await this.client.complete(SYSTEM, `Language: ${document.languageId}\n\n${code}`);
        }
        catch (e) {
            this.outputChannel.appendLine(`[analyse] engine error: ${e?.message}`);
            vscode.window.setStatusBarMessage("LocalForge ▰ engine not reachable", 5000);
            return;
        }
        this.outputChannel.appendLine(`[analyse] raw response:\n${raw}`);
        const issues = safeParseArray(raw);
        this.outputChannel.appendLine(`[analyse] parsed ${issues.length} issue(s)`);
        const vsDiags = [];
        for (const issue of issues) {
            const lineIdx = Math.max(0, (Number(issue.line) || 1) - 1);
            if (lineIdx >= document.lineCount) {
                continue;
            }
            const line = document.lineAt(lineIdx);
            const range = new vscode.Range(lineIdx, line.firstNonWhitespaceCharacterIndex, lineIdx, line.text.length);
            const sev = issue.severity === "error" ? vscode.DiagnosticSeverity.Error :
                issue.severity === "warning" ? vscode.DiagnosticSeverity.Warning :
                    vscode.DiagnosticSeverity.Information;
            const d = new vscode.Diagnostic(range, `LocalForge: ${issue.message}`, sev);
            d.source = "LocalForge";
            d.code = "AI";
            vsDiags.push(d);
        }
        this.collection.set(document.uri, vsDiags);
        this.lastAiDiags.set(document.uri.toString(), issues);
        const msg = vsDiags.length > 0
            ? `LocalForge ▰ ${vsDiags.length} issue${vsDiags.length > 1 ? "s" : ""} found — Ctrl+Shift+M`
            : "LocalForge ▰ no issues found";
        vscode.window.setStatusBarMessage(msg, 8000);
        if (vsDiags.length > 0) {
            vscode.window.showInformationMessage(`LocalForge found ${vsDiags.length} issue(s). Open Problems panel?`, "Open Problems").then(choice => {
                if (choice === "Open Problems") {
                    vscode.commands.executeCommand("workbench.actions.view.problems");
                }
            });
        }
    }
    clear(uri) {
        this.collection.delete(uri);
        this.lastAiDiags.delete(uri.toString());
    }
    dispose() {
        this.collection.dispose();
        this.timers.forEach(t => clearTimeout(t));
    }
}
exports.DiagnosticsManager = DiagnosticsManager;
// Code action: lightbulb "Apply Fix" on AI squiggles
class FixCodeActionProvider {
    constructor(dm) {
        this.dm = dm;
    }
    provideCodeActions(document, _range, ctx) {
        const actions = [];
        const aiDiags = this.dm.lastAiDiags.get(document.uri.toString()) ?? [];
        for (const diag of ctx.diagnostics) {
            if (diag.source !== "LocalForge") {
                continue;
            }
            const ai = aiDiags.find(d => (d.line - 1) === diag.range.start.line && d.fix);
            if (ai?.fix) {
                const fix = new vscode.CodeAction("LocalForge: Apply fix", vscode.CodeActionKind.QuickFix);
                fix.edit = new vscode.WorkspaceEdit();
                fix.edit.replace(document.uri, diag.range, ai.fix);
                fix.diagnostics = [diag];
                fix.isPreferred = true;
                actions.push(fix);
            }
            const explain = new vscode.CodeAction("LocalForge: Explain issue", vscode.CodeActionKind.QuickFix);
            explain.command = { command: "localforge.explainCode", title: "Explain", arguments: [diag.message] };
            actions.push(explain);
        }
        return actions;
    }
}
exports.FixCodeActionProvider = FixCodeActionProvider;
// Hover explanation
class HoverProvider {
    constructor(client) {
        this.client = client;
    }
    async provideHover(doc, pos) {
        const range = doc.getWordRangeAtPosition(pos);
        if (!range) {
            return undefined;
        }
        const word = doc.getText(range);
        if (word.length < 3) {
            return undefined;
        }
        const SKIP = ["if", "for", "while", "do", "return", "const", "let", "var",
            "fn", "def", "class", "import", "from", "export", "true", "false"];
        if (SKIP.includes(word)) {
            return undefined;
        }
        const start = Math.max(0, pos.line - 4);
        const end = Math.min(doc.lineCount - 1, pos.line + 4);
        const snippet = doc.getText(new vscode.Range(start, 0, end, 999));
        try {
            const text = await this.client.complete("Explain in ONE sentence (max 20 words) what this identifier does in context. No markdown.", `What is \`${word}\` in this code?\n\n${snippet}`);
            if (!text) {
                return undefined;
            }
            const md = new vscode.MarkdownString(`**LocalForge ▰** ${text}`);
            return new vscode.Hover(md, range);
        }
        catch {
            return undefined;
        }
    }
}
exports.HoverProvider = HoverProvider;
// ── JSON parser that survives model weirdness ─────────────────────────────
function safeParseArray(raw) {
    if (!raw || raw.trim() === "") {
        return [];
    }
    // Strip markdown fences
    let s = raw
        .replace(/^```json\s*/im, "")
        .replace(/^```\s*/im, "")
        .replace(/```\s*$/im, "")
        .trim();
    // Find the first [...] block
    const start = s.indexOf("[");
    const end = s.lastIndexOf("]");
    if (start === -1 || end === -1 || end < start) {
        return [];
    }
    s = s.slice(start, end + 1);
    try {
        const arr = JSON.parse(s);
        if (!Array.isArray(arr)) {
            return [];
        }
        return arr.filter((x) => x && typeof x.line === "number" && typeof x.message === "string");
    }
    catch {
        return [];
    }
}
//# sourceMappingURL=diagnostics.js.map