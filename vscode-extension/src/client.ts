import * as http from "http";
import * as https from "https";

export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export class EngineClient {
  private baseUrl: string;
  private model: string;
  private maxTokens: number;

  constructor(baseUrl: string, model: string, maxTokens: number) {
    this.baseUrl   = baseUrl.replace(/\/$/, "");
    this.model     = model;
    this.maxTokens = maxTokens;
  }

  async isAlive(): Promise<boolean> {
    for (const path of ["/health", "/v1/models", "/api/tags"]) {
      try {
        const r = await this.getRaw(path, 3000);
        if (r.ok) { return true; }
      } catch { /* try next */ }
    }
    return false;
  }

  /** Non-streaming completion. Used for diagnostics, explain, fix, refactor, tests. */
  async complete(systemPrompt: string, userPrompt: string): Promise<string> {
    const body = JSON.stringify({
      model: this.model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user",   content: userPrompt   },
      ],
      stream:     false,
      max_tokens: this.maxTokens,
      temperature: 0.1,
    });

    const raw = await this.postRaw("/v1/chat/completions", body, 120_000);
    let parsed: any;
    try { parsed = JSON.parse(raw); } catch { return raw; }
    return parsed?.choices?.[0]?.message?.content ?? "";
  }

  /** Non-streaming completion with an AbortSignal (for inline completions). */
  async completeWithAbort(
    systemPrompt: string,
    userPrompt: string,
    signal: AbortSignal
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      if (signal.aborted) { resolve(""); return; }

      const body = JSON.stringify({
        model: this.model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user",   content: userPrompt   },
        ],
        stream:      false,
        max_tokens:  200,   // keep completions short and fast
        temperature: 0.1,
        stop: ["\n\n\n"],   // stop on too many blank lines
      });

      const url       = new URL("/v1/chat/completions", this.baseUrl);
      const transport = url.protocol === "https:" ? https : http;

      const req = transport.request(
        {
          hostname: url.hostname,
          port:     Number(url.port) || (url.protocol === "https:" ? 443 : 80),
          path:     url.pathname,
          method:   "POST",
          headers:  {
            "Content-Type":   "application/json",
            "Content-Length": Buffer.byteLength(body),
          },
        },
        (res) => {
          let raw = "";
          res.on("data",  (c: Buffer) => raw += c.toString());
          res.on("end",   () => {
            try {
              const j = JSON.parse(raw);
              resolve(j?.choices?.[0]?.message?.content ?? "");
            } catch { resolve(""); }
          });
          res.on("error", () => resolve(""));
        }
      );

      signal.addEventListener("abort", () => {
        req.destroy();
        resolve("");
      });

      req.on("error", () => resolve(""));
      req.setTimeout(30_000, () => { req.destroy(); resolve(""); });
      req.write(body);
      req.end();
    });
  }

  /** Streaming chat. Returns a cancel function. */
  streamChat(
    messages: ChatMessage[],
    onToken: (t: string) => void,
    onDone:  (full: string) => void,
    onError: (e: Error) => void
  ): () => void {
    const body = JSON.stringify({
      model:       this.model,
      messages,
      stream:      true,
      max_tokens:  this.maxTokens,
      temperature: 0.2,
    });

    let aborted = false;
    let full    = "";
    const url       = new URL("/v1/chat/completions", this.baseUrl);
    const transport = url.protocol === "https:" ? https : http;

    const req = transport.request(
      {
        hostname: url.hostname,
        port:     Number(url.port) || (url.protocol === "https:" ? 443 : 80),
        path:     url.pathname,
        method:   "POST",
        headers:  {
          "Content-Type":   "application/json",
          "Content-Length": Buffer.byteLength(body),
        },
      },
      (res) => {
        let buf = "";
        res.on("data", (chunk: Buffer) => {
          if (aborted) { return; }
          buf += chunk.toString();
          const lines = buf.split("\n");
          buf = lines.pop() ?? "";
          for (const line of lines) {
            const t = line.trim();
            if (!t.startsWith("data:")) { continue; }
            const data = t.slice(5).trim();
            if (data === "[DONE]") { onDone(full); return; }
            try {
              const ev  = JSON.parse(data);
              const tok: string = ev?.choices?.[0]?.delta?.content ?? "";
              if (tok) { full += tok; onToken(tok); }
            } catch { /* partial line */ }
          }
        });
        res.on("end",   () => { if (!aborted) { onDone(full); } });
        res.on("error", onError);
      }
    );

    req.on("error", onError);
    req.write(body);
    req.end();

    return () => { aborted = true; req.destroy(); };
  }

  // ── private helpers ──────────────────────────────────────────────────────

  private getRaw(path: string, timeoutMs: number): Promise<{ ok: boolean; body: string }> {
    return new Promise((resolve, reject) => {
      const url       = new URL(path, this.baseUrl);
      const transport = url.protocol === "https:" ? https : http;
      const req       = transport.get(url.toString(), (res) => {
        let raw = "";
        res.on("data", (c: Buffer) => raw += c);
        res.on("end",  () => resolve({ ok: (res.statusCode ?? 0) < 400, body: raw }));
      });
      req.on("error",   reject);
      req.setTimeout(timeoutMs, () => { req.destroy(); reject(new Error("timeout")); });
    });
  }

  private postRaw(path: string, body: string, timeoutMs: number): Promise<string> {
    return new Promise((resolve, reject) => {
      const url       = new URL(path, this.baseUrl);
      const transport = url.protocol === "https:" ? https : http;
      const req       = transport.request(
        {
          hostname: url.hostname,
          port:     Number(url.port) || (url.protocol === "https:" ? 443 : 80),
          path:     url.pathname,
          method:   "POST",
          headers:  {
            "Content-Type":   "application/json",
            "Content-Length": Buffer.byteLength(body),
          },
        },
        (res) => {
          let raw = "";
          res.on("data",  (c: Buffer) => raw += c);
          res.on("end",   () => resolve(raw));
          res.on("error", reject);
        }
      );
      req.on("error", reject);
      req.setTimeout(timeoutMs, () => { req.destroy(); reject(new Error("timeout")); });
      req.write(body);
      req.end();
    });
  }
}
