import * as vscode from "vscode";
import { EngineClient } from "./client";

const SUPPORTED = [
  "python","javascript","typescript","javascriptreact","typescriptreact",
  "rust","go","java","c","cpp","csharp","php","ruby","swift","kotlin",
  "html","css","json","yaml","sql","bash","powershell","markdown",
];

export class CompletionProvider implements vscode.InlineCompletionItemProvider {
  private client: EngineClient;
  private debounceMs: number;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private lastAbort: AbortController | undefined;

  constructor(client: EngineClient, debounceMs: number) {
    this.client = client;
    this.debounceMs = debounceMs;
  }

  provideInlineCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
    _ctx: vscode.InlineCompletionContext,
    token: vscode.CancellationToken
  ): Promise<vscode.InlineCompletionList | undefined> {

    if (!SUPPORTED.includes(document.languageId)) {
      return Promise.resolve(undefined);
    }

    // Cancel previous pending request
    if (this.lastAbort) { this.lastAbort.abort(); }
    if (this.timer)      { clearTimeout(this.timer); }

    return new Promise((resolve) => {
      this.timer = setTimeout(async () => {
        if (token.isCancellationRequested) { resolve(undefined); return; }

        const prefix = this.getPrefix(document, position);
        if (prefix.trim().length < 15) { resolve(undefined); return; }

        const abort = new AbortController();
        this.lastAbort = abort;

        token.onCancellationRequested(() => {
          abort.abort();
          resolve(undefined);
        });

        try {
          const suggestion = await this.client.completeWithAbort(
            "You complete code. Output ONLY the completion, no explanation, no markdown fences. " +
            "1-6 lines maximum.",
            `Complete this ${document.languageId} code. Output only what comes next:\n\n${prefix}`,
            abort.signal
          );

          if (!suggestion || token.isCancellationRequested) {
            resolve(undefined);
            return;
          }

          // Strip any accidental markdown fences
          const clean = suggestion
            .replace(/^```[a-zA-Z]*\n?/, "")
            .replace(/\n?```$/, "")
            .trimEnd();

          if (!clean) { resolve(undefined); return; }

          resolve(new vscode.InlineCompletionList([
            new vscode.InlineCompletionItem(
              clean,
              new vscode.Range(position, position)
            )
          ]));
        } catch {
          resolve(undefined);
        }
      }, this.debounceMs);
    });
  }

  private getPrefix(doc: vscode.TextDocument, pos: vscode.Position): string {
    const startLine = Math.max(0, pos.line - 50);
    return doc.getText(new vscode.Range(startLine, 0, pos.line, pos.character));
  }
}
