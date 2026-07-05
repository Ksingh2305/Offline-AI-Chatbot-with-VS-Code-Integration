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
exports.EngineClient = void 0;
const http = __importStar(require("http"));
const https = __importStar(require("https"));
class EngineClient {
    constructor(baseUrl, model, maxTokens) {
        this.baseUrl = baseUrl.replace(/\/$/, "");
        this.model = model;
        this.maxTokens = maxTokens;
    }
    async isAlive() {
        for (const path of ["/health", "/v1/models", "/api/tags"]) {
            try {
                const r = await this.getRaw(path, 3000);
                if (r.ok) {
                    return true;
                }
            }
            catch { /* try next */ }
        }
        return false;
    }
    /** Non-streaming completion. Used for diagnostics, explain, fix, refactor, tests. */
    async complete(systemPrompt, userPrompt) {
        const body = JSON.stringify({
            model: this.model,
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: userPrompt },
            ],
            stream: false,
            max_tokens: this.maxTokens,
            temperature: 0.1,
        });
        const raw = await this.postRaw("/v1/chat/completions", body, 120000);
        let parsed;
        try {
            parsed = JSON.parse(raw);
        }
        catch {
            return raw;
        }
        return parsed?.choices?.[0]?.message?.content ?? "";
    }
    /** Non-streaming completion with an AbortSignal (for inline completions). */
    async completeWithAbort(systemPrompt, userPrompt, signal) {
        return new Promise((resolve, reject) => {
            if (signal.aborted) {
                resolve("");
                return;
            }
            const body = JSON.stringify({
                model: this.model,
                messages: [
                    { role: "system", content: systemPrompt },
                    { role: "user", content: userPrompt },
                ],
                stream: false,
                max_tokens: 200, // keep completions short and fast
                temperature: 0.1,
                stop: ["\n\n\n"], // stop on too many blank lines
            });
            const url = new URL("/v1/chat/completions", this.baseUrl);
            const transport = url.protocol === "https:" ? https : http;
            const req = transport.request({
                hostname: url.hostname,
                port: Number(url.port) || (url.protocol === "https:" ? 443 : 80),
                path: url.pathname,
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Content-Length": Buffer.byteLength(body),
                },
            }, (res) => {
                let raw = "";
                res.on("data", (c) => raw += c.toString());
                res.on("end", () => {
                    try {
                        const j = JSON.parse(raw);
                        resolve(j?.choices?.[0]?.message?.content ?? "");
                    }
                    catch {
                        resolve("");
                    }
                });
                res.on("error", () => resolve(""));
            });
            signal.addEventListener("abort", () => {
                req.destroy();
                resolve("");
            });
            req.on("error", () => resolve(""));
            req.setTimeout(30000, () => { req.destroy(); resolve(""); });
            req.write(body);
            req.end();
        });
    }
    /** Streaming chat. Returns a cancel function. */
    streamChat(messages, onToken, onDone, onError) {
        const body = JSON.stringify({
            model: this.model,
            messages,
            stream: true,
            max_tokens: this.maxTokens,
            temperature: 0.2,
        });
        let aborted = false;
        let full = "";
        const url = new URL("/v1/chat/completions", this.baseUrl);
        const transport = url.protocol === "https:" ? https : http;
        const req = transport.request({
            hostname: url.hostname,
            port: Number(url.port) || (url.protocol === "https:" ? 443 : 80),
            path: url.pathname,
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Content-Length": Buffer.byteLength(body),
            },
        }, (res) => {
            let buf = "";
            res.on("data", (chunk) => {
                if (aborted) {
                    return;
                }
                buf += chunk.toString();
                const lines = buf.split("\n");
                buf = lines.pop() ?? "";
                for (const line of lines) {
                    const t = line.trim();
                    if (!t.startsWith("data:")) {
                        continue;
                    }
                    const data = t.slice(5).trim();
                    if (data === "[DONE]") {
                        onDone(full);
                        return;
                    }
                    try {
                        const ev = JSON.parse(data);
                        const tok = ev?.choices?.[0]?.delta?.content ?? "";
                        if (tok) {
                            full += tok;
                            onToken(tok);
                        }
                    }
                    catch { /* partial line */ }
                }
            });
            res.on("end", () => { if (!aborted) {
                onDone(full);
            } });
            res.on("error", onError);
        });
        req.on("error", onError);
        req.write(body);
        req.end();
        return () => { aborted = true; req.destroy(); };
    }
    // ── private helpers ──────────────────────────────────────────────────────
    getRaw(path, timeoutMs) {
        return new Promise((resolve, reject) => {
            const url = new URL(path, this.baseUrl);
            const transport = url.protocol === "https:" ? https : http;
            const req = transport.get(url.toString(), (res) => {
                let raw = "";
                res.on("data", (c) => raw += c);
                res.on("end", () => resolve({ ok: (res.statusCode ?? 0) < 400, body: raw }));
            });
            req.on("error", reject);
            req.setTimeout(timeoutMs, () => { req.destroy(); reject(new Error("timeout")); });
        });
    }
    postRaw(path, body, timeoutMs) {
        return new Promise((resolve, reject) => {
            const url = new URL(path, this.baseUrl);
            const transport = url.protocol === "https:" ? https : http;
            const req = transport.request({
                hostname: url.hostname,
                port: Number(url.port) || (url.protocol === "https:" ? 443 : 80),
                path: url.pathname,
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Content-Length": Buffer.byteLength(body),
                },
            }, (res) => {
                let raw = "";
                res.on("data", (c) => raw += c);
                res.on("end", () => resolve(raw));
                res.on("error", reject);
            });
            req.on("error", reject);
            req.setTimeout(timeoutMs, () => { req.destroy(); reject(new Error("timeout")); });
            req.write(body);
            req.end();
        });
    }
}
exports.EngineClient = EngineClient;
//# sourceMappingURL=client.js.map