import { memo, useState, useRef, useCallback, useEffect } from "react";
import { roomStyle } from "../lib/constants";
import type { AgentState } from "../lib/types";

interface CommandBarProps {
  agents: AgentState[];
  send: (msg: object) => void;
  connected: boolean;
}

export const CommandBar = memo(function CommandBar({ agents, send, connected }: CommandBarProps) {
  const [open, setOpen] = useState(false);
  const [selectedTarget, setSelectedTarget] = useState<string>("");
  const [text, setText] = useState("");
  const [showPicker, setShowPicker] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-select first busy agent, or first agent
  useEffect(() => {
    if (selectedTarget && agents.some(a => a.target === selectedTarget)) return;
    const busy = agents.find(a => a.status === "busy");
    const first = busy || agents[0];
    if (first) setSelectedTarget(first.target);
  }, [agents, selectedTarget]);

  const selectedAgent = agents.find(a => a.target === selectedTarget);

  const handleSend = useCallback(() => {
    if (!text.trim() || !selectedTarget) return;
    // Send text + enter
    send({ type: "send", target: selectedTarget, text: text.trim() });
    setTimeout(() => send({ type: "send", target: selectedTarget, text: "\r" }), 50);
    setText("");
    inputRef.current?.focus();
  }, [text, selectedTarget, send]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
    if (e.key === "Escape") {
      setOpen(false);
    }
  }, [handleSend]);

  if (!open) {
    return (
      <button
        className="fixed bottom-5 right-5 w-14 h-14 rounded-full flex items-center justify-center cursor-pointer z-50 transition-transform active:scale-90"
        style={{
          background: "linear-gradient(135deg, #fbbf24, #f59e0b)",
          boxShadow: "0 4px 20px rgba(251,191,36,0.4), 0 0 40px rgba(251,191,36,0.15)",
        }}
        onClick={() => { setOpen(true); setTimeout(() => inputRef.current?.focus(), 100); }}
        aria-label="Quick command"
      >
        <svg width={24} height={24} viewBox="0 0 24 24" fill="none" stroke="#000" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 19V5M5 12l7-7 7 7" />
        </svg>
      </button>
    );
  }

  const rs = selectedAgent ? roomStyle(selectedAgent.session) : { accent: "#fbbf24" };
  const displayName = selectedAgent?.name.replace(/-oracle$/, "").replace(/-/g, " ") || "—";

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50" style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}>
      {/* Backdrop */}
      {showPicker && (
        <div className="fixed inset-0 z-40" onClick={() => setShowPicker(false)} />
      )}

      {/* Agent picker dropdown */}
      {showPicker && (
        <div
          className="absolute bottom-full left-0 right-0 max-h-[50vh] overflow-y-auto mb-1"
          style={{ background: "#12121c", borderTop: "1px solid rgba(255,255,255,0.08)" }}
        >
          {agents.map(agent => {
            const ars = roomStyle(agent.session);
            const name = agent.name.replace(/-oracle$/, "").replace(/-/g, " ");
            const isBusy = agent.status === "busy";
            return (
              <button
                key={agent.target}
                className="w-full flex items-center gap-3 px-4 py-3 cursor-pointer transition-colors hover:bg-white/[0.05]"
                style={{
                  background: agent.target === selectedTarget ? `${ars.accent}15` : "transparent",
                  borderBottom: "1px solid rgba(255,255,255,0.04)",
                }}
                onClick={() => { setSelectedTarget(agent.target); setShowPicker(false); inputRef.current?.focus(); }}
              >
                <div
                  className="w-3 h-3 rounded-full flex-shrink-0"
                  style={{
                    background: isBusy ? "#ffa726" : agent.status === "ready" ? "#22C55E" : "#555",
                    boxShadow: isBusy ? "0 0 6px #ffa726" : "none",
                  }}
                />
                <span className="text-sm font-semibold" style={{ color: ars.accent }}>{name}</span>
                <span className="text-[10px] font-mono ml-auto" style={{ color: "#64748B" }}>{agent.session}</span>
              </button>
            );
          })}
        </div>
      )}

      {/* Command bar */}
      <div
        className="flex items-center gap-2 px-3 py-2"
        style={{
          background: "#0a0a12",
          borderTop: `1px solid ${rs.accent}30`,
          boxShadow: "0 -4px 20px rgba(0,0,0,0.5)",
        }}
      >
        {/* Agent selector button */}
        <button
          className="flex items-center gap-2 px-3 py-2.5 rounded-xl flex-shrink-0 cursor-pointer transition-colors active:scale-95"
          style={{ background: `${rs.accent}15`, border: `1px solid ${rs.accent}30` }}
          onClick={() => setShowPicker(!showPicker)}
        >
          <div
            className="w-2.5 h-2.5 rounded-full"
            style={{
              background: selectedAgent?.status === "busy" ? "#ffa726" : selectedAgent?.status === "ready" ? "#22C55E" : "#555",
              boxShadow: selectedAgent?.status === "busy" ? "0 0 6px #ffa726" : "none",
            }}
          />
          <span className="text-[13px] font-semibold max-w-[80px] truncate" style={{ color: rs.accent }}>
            {displayName}
          </span>
          <svg width={10} height={10} viewBox="0 0 10 10" fill="none">
            <path d="M2 4l3 3 3-3" stroke={rs.accent} strokeWidth={1.5} strokeLinecap="round" />
          </svg>
        </button>

        {/* Input */}
        <input
          ref={inputRef}
          type="text"
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Speak or type a command..."
          className="flex-1 bg-transparent text-white text-[15px] outline-none px-2 py-2.5 placeholder:text-white/20"
          style={{ WebkitAppearance: "none" as const }}
          autoComplete="off"
          autoCorrect="off"
          enterKeyHint="send"
        />

        {/* Send button */}
        <button
          className="flex-shrink-0 w-10 h-10 rounded-xl flex items-center justify-center cursor-pointer transition-all active:scale-90"
          style={{
            background: text.trim() ? rs.accent : "rgba(255,255,255,0.06)",
            opacity: text.trim() ? 1 : 0.4,
          }}
          onClick={handleSend}
          disabled={!text.trim()}
        >
          <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke={text.trim() ? "#000" : "#666"} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 19V5M5 12l7-7 7 7" />
          </svg>
        </button>

        {/* Close button */}
        <button
          className="flex-shrink-0 w-10 h-10 rounded-xl flex items-center justify-center cursor-pointer transition-all active:scale-90"
          style={{ background: "rgba(255,255,255,0.06)" }}
          onClick={() => setOpen(false)}
        >
          <svg width={16} height={16} viewBox="0 0 16 16" fill="none" stroke="#666" strokeWidth={2} strokeLinecap="round">
            <path d="M4 4l8 8M12 4l-8 8" />
          </svg>
        </button>
      </div>
    </div>
  );
});
