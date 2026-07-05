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
exports.CompletionProvider = void 0;
const vscode = __importStar(require("vscode"));
const SUPPORTED = [
    "python", "javascript", "typescript", "javascriptreact", "typescriptreact",
    "rust", "go", "java", "c", "cpp", "csharp", "php", "ruby", "swift", "kotlin",
    "html", "css", "json", "yaml", "sql", "bash", "powershell", "markdown",
];
class CompletionProvider {
    constructor(client, debounceMs) {
        this.client = client;
        this.debounceMs = debounceMs;
    }
    provideInlineCompletionItems(document, position, _ctx, token) {
        if (!SUPPORTED.includes(document.languageId)) {
            return Promise.resolve(undefined);
        }
        // Cancel previous pending request
        if (this.lastAbort) {
            this.lastAbort.abort();
        }
        if (this.timer) {
            clearTimeout(this.timer);
        }
        return new Promise((resolve) => {
            this.timer = setTimeout(async () => {
                if (token.isCancellationRequested) {
                    resolve(undefined);
                    return;
                }
                const prefix = this.getPrefix(document, position);
                if (prefix.trim().length < 15) {
                    resolve(undefined);
                    return;
                }
                const abort = new AbortController();
                this.lastAbort = abort;
                token.onCancellationRequested(() => {
                    abort.abort();
                    resolve(undefined);
                });
                try {
                    const suggestion = await this.client.completeWithAbort("You complete code. Output ONLY the completion, no explanation, no markdown fences. " +
                        "1-6 lines maximum.", `Complete this ${document.languageId} code. Output only what comes next:\n\n${prefix}`, abort.signal);
                    if (!suggestion || token.isCancellationRequested) {
                        resolve(undefined);
                        return;
                    }
                    // Strip any accidental markdown fences
                    const clean = suggestion
                        .replace(/^```[a-zA-Z]*\n?/, "")
                        .replace(/\n?```$/, "")
                        .trimEnd();
                    if (!clean) {
                        resolve(undefined);
                        return;
                    }
                    resolve(new vscode.InlineCompletionList([
                        new vscode.InlineCompletionItem(clean, new vscode.Range(position, position))
                    ]));
                }
                catch {
                    resolve(undefined);
                }
            }, this.debounceMs);
        });
    }
    getPrefix(doc, pos) {
        const startLine = Math.max(0, pos.line - 50);
        return doc.getText(new vscode.Range(startLine, 0, pos.line, pos.character));
    }
}
exports.CompletionProvider = CompletionProvider;
//# sourceMappingURL=completions.js.map