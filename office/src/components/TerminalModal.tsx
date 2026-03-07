import { useState, useEffect, useRef, useCallback } from "react";
import { ansiToHtml } from "../lib/ansi";
import type { AgentState } from "../lib/types";

// Strip trailing blank lines (may contain ANSI codes)
function trimCapture(raw: string): string {
  const lines = raw.split("\n");
  // Remove trailing lines that are empty after stripping ANSI
  while (lines.length > 0) {
    const stripped = lines[lines.length - 1].replace(/\x1b\[[0-9;]*m/g, "").trim();
    if (stripped === "") lines.pop();
    else break;
  }
  return lines.join("\n");
}

interface TerminalModalProps {
  agent: AgentState;
  send: (msg: object) => void;
  onClose: () => void;
}

export function TerminalModal({ agent, send, onClose }: TerminalModalProps) {
  const [content, setContent] = useState("");
  const [inputBuf, setInputBuf] = useState("");
  const termRef = useRef<HTMLDivElement>(null);
  const wsListenerRef = useRef<((e: MessageEvent) => void) | null>(null);

  // Subscribe to live capture on mount
  useEffect(() => {
    send({ type: "subscribe", target: agent.target });

    // Listen for capture messages via a custom event approach
    // We'll poll instead since we don't have direct WS access here
    const poll = setInterval(async () => {
      try {
        const res = await fetch(`/api/capture?target=${encodeURIComponent(agent.target)}`);
        const data = await res.json();
        setContent(data.content || "");
      } catch {}
    }, 200);

    return () => {
      clearInterval(poll);
      send({ type: "subscribe", target: "" });
    };
  }, [agent.target, send]);

  // Auto-scroll
  useEffect(() => {
    const el = termRef.current;
    if (el) {
      const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
      if (atBottom) el.scrollTop = el.scrollHeight;
    }
  }, [content]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Escape") { e.preventDefault(); onClose(); return; }

    if (e.key === "Enter") {
      e.preventDefault();
      if (inputBuf) {
        send({ type: "send", target: agent.target, text: inputBuf });
        setInputBuf("");
      }
    } else if (e.key === "Backspace") {
      e.preventDefault();
      if (e.metaKey || e.ctrlKey) setInputBuf("");
      else setInputBuf((b) => b.slice(0, -1));
    } else if (e.key === "c" && e.ctrlKey) {
      e.preventDefault();
      setInputBuf("");
    } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      setInputBuf((b) => b + e.key);
    }
  }, [inputBuf, agent.target, send, onClose]);

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    e.preventDefault();
    const text = e.clipboardData.getData("text");
    if (text) setInputBuf((b) => b + text);
  }, []);

  return (
    <div
      style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.85)",
        display: "flex", alignItems: "center", justifyContent: "center",
        zIndex: 100, backdropFilter: "blur(4px)",
      }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
      onKeyDown={handleKeyDown}
      onPaste={handlePaste}
      tabIndex={0}
      ref={(el) => el?.focus()}
    >
      <div style={{
        width: "90vw", maxWidth: 900, height: "80vh",
        background: "#0a0a0f", border: "1px solid #1a1a2e", borderRadius: 12,
        display: "flex", flexDirection: "column", overflow: "hidden",
        boxShadow: "0 0 60px rgba(0,0,0,0.6)",
      }}>
        {/* Header */}
        <div style={{
          padding: "10px 16px", borderBottom: "1px solid #222233",
          display: "flex", alignItems: "center", background: "#14141e",
        }}>
          {/* Traffic light dots */}
          <div style={{ display: "flex", gap: 6, marginRight: 12 }}>
            <span onClick={onClose} style={{ width: 12, height: 12, borderRadius: "50%", background: "#ff5f57", cursor: "pointer", display: "inline-block" }} />
            <span style={{ width: 12, height: 12, borderRadius: "50%", background: "#febc2e" }} />
            <span style={{ width: 12, height: 12, borderRadius: "50%", background: "#28c840" }} />
          </div>
          <span style={{ fontSize: 13, fontWeight: 500, color: "#888", fontFamily: "'SF Mono', monospace" }}>
            {agent.name} — {agent.target}
          </span>
          <button onClick={onClose} style={{
            marginLeft: "auto", background: "none", border: "none", color: "#555",
            fontSize: 20, cursor: "pointer", padding: "0 4px", lineHeight: 1,
          }}>&times;</button>
        </div>

        {/* Terminal output */}
        <div ref={termRef} style={{
          flex: 1, padding: "12px 16px", overflowY: "auto",
          fontFamily: "'SF Mono', 'Fira Code', 'Cascadia Code', 'JetBrains Mono', monospace", fontSize: 12,
          lineHeight: 1.5, whiteSpace: "pre-wrap", wordBreak: "break-all", color: "#c8c8d0",
          background: "#111118",
          filter: "saturate(0.55) brightness(1.15) contrast(0.95)",
        }} dangerouslySetInnerHTML={{ __html: ansiToHtml(trimCapture(content)) }} />

        {/* Input line */}
        <div style={{
          padding: "8px 16px", borderTop: "1px solid #222233", background: "#14141e",
          fontFamily: "'SF Mono', 'Fira Code', monospace", fontSize: 12,
          display: "flex", alignItems: "center", minHeight: 32,
        }}>
          <span style={{ color: "#26c6da", marginRight: 8, fontWeight: 600 }}>&#x276f;</span>
          <span style={{ color: "#e0e0e0", whiteSpace: "pre" }}>{inputBuf}</span>
          <span style={{
            display: "inline-block", width: 7, height: 15, background: "#26c6da",
            animation: "blink 1s step-end infinite", verticalAlign: "middle", marginLeft: 1,
            opacity: 0.8,
          }} />
        </div>
      </div>
    </div>
  );
}
