import { useEffect, useRef, useState } from "react";
import {
  listModels,
  setActiveModel,
  chatStream,
  indexRepo,
  ragStatus,
  engineReady,
  type ChatMessage,
  type ModelInfo,
} from "./lib/ipc";

export default function App() {
  const [ready, setReady] = useState(false);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [active, setActive] = useState<string>("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [useRepo, setUseRepo] = useState(false);
  const [repoPath, setRepoPath] = useState("");
  const [indexing, setIndexing] = useState(false);
  const [rag, setRag] = useState<{ chunks: number; indexed_path: string | null }>({
    chunks: 0,
    indexed_path: null,
  });
  const scrollRef = useRef<HTMLDivElement>(null);

  // Poll until the local model engine has finished warming up.
  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const ok = await engineReady();
        if (ok && !cancelled) {
          setReady(true);
          const m = await listModels();
          setModels(m.models);
          setActive(m.active);
          setRag(await ragStatus());
          return;
        }
      } catch {
        /* engine not up yet */
      }
      if (!cancelled) setTimeout(tick, 1200);
    };
    tick();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages]);

  async function onPickModel(id: string) {
    setActive(id);
    await setActiveModel(id);
  }

  async function onIndex() {
    if (!repoPath.trim()) return;
    setIndexing(true);
    try {
      await indexRepo(repoPath.trim());
      setRag(await ragStatus());
      setUseRepo(true);
    } finally {
      setIndexing(false);
    }
  }

  async function send() {
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    const next: ChatMessage[] = [...messages, { role: "user", content: text }];
    // add an empty assistant turn we stream into
    setMessages([...next, { role: "assistant", content: "" }]);
    setBusy(true);
    try {
      await chatStream(
        next,
        useRepo,
        (tok) =>
          setMessages((cur) => {
            const copy = cur.slice();
            copy[copy.length - 1] = {
              role: "assistant",
              content: copy[copy.length - 1].content + tok,
            };
            return copy;
          }),
        () => setBusy(false)
      );
    } catch (e) {
      setMessages((cur) => {
        const copy = cur.slice();
        copy[copy.length - 1] = {
          role: "assistant",
          content: `Couldn't reach the local model. ${String(e)}`,
        };
        return copy;
      });
      setBusy(false);
    }
  }

  function onKey(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  if (!ready) {
    return (
      <div className="warmup">
        <div className="ember" />
        <p className="warmup-title">Heating the forge</p>
        <p className="warmup-sub">Loading the local model into memory. First start is the slowest.</p>
      </div>
    );
  }

  const activeModel = models.find((m) => m.id === active);

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">▰</span> LocalForge
        </div>
        <div className="model-pick">
          <label>Model</label>
          <select value={active} onChange={(e) => onPickModel(e.target.value)}>
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.id} · {m.tier}
              </option>
            ))}
          </select>
        </div>
      </header>

      <div className="body">
        <aside className="sidebar">
          <div className="panel">
            <h3>Repository context</h3>
            <p className="hint">Index a project folder, then ask about it. Everything stays on this machine.</p>
            <input
              className="path"
              placeholder="C:\path\to\your\repo"
              value={repoPath}
              onChange={(e) => setRepoPath(e.target.value)}
            />
            <button className="btn" disabled={indexing} onClick={onIndex}>
              {indexing ? "Indexing…" : "Index folder"}
            </button>
            <label className="toggle">
              <input
                type="checkbox"
                checked={useRepo}
                onChange={(e) => setUseRepo(e.target.checked)}
                disabled={rag.chunks === 0}
              />
              Use repo context in answers
            </label>
            <div className="rag-stat">
              {rag.chunks > 0
                ? `${rag.chunks} chunks indexed`
                : "No repository indexed yet"}
            </div>
          </div>
        </aside>

        <main className="chat">
          <div className="messages" ref={scrollRef}>
            {messages.length === 0 && (
              <div className="empty">
                <h2>Ask the local model anything.</h2>
                <p>Generate, explain, refactor, or debug — offline, private, on your hardware.</p>
              </div>
            )}
            {messages.map((m, i) => (
              <Message key={i} role={m.role} content={m.content} />
            ))}
          </div>

          <div className="composer">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKey}
              placeholder="Write a function, paste an error, ask about your repo…  (Enter to send, Shift+Enter for newline)"
              rows={3}
            />
            <button className="send" onClick={send} disabled={busy || !input.trim()}>
              {busy ? "…" : "Send"}
            </button>
          </div>
        </main>
      </div>

      <footer className="statusbar">
        <span className="offline-dot" /> Offline
        <span className="sep">·</span>
        {activeModel ? `${activeModel.id} (${activeModel.provider})` : "no model"}
        <span className="sep">·</span>
        tier {activeModel?.tier ?? "—"}
        {useRepo && rag.chunks > 0 && (
          <>
            <span className="sep">·</span> repo context on
          </>
        )}
      </footer>
    </div>
  );
}

function Message({ role, content }: { role: string; content: string }) {
  // Minimal code-block rendering: split on ``` fences.
  const parts = content.split(/```/);
  return (
    <div className={`msg ${role}`}>
      <div className="who">{role === "user" ? "You" : "LocalForge"}</div>
      <div className="bubble">
        {parts.map((p, i) =>
          i % 2 === 1 ? (
            <pre key={i} className="code">
              <code>{p.replace(/^[a-zA-Z0-9]*\n/, "")}</code>
            </pre>
          ) : (
            <span key={i} className="text">
              {p}
            </span>
          )
        )}
        {content === "" && <span className="caret">▍</span>}
      </div>
    </div>
  );
}
