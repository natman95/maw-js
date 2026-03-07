import { memo } from "react";

interface StatusBarProps {
  connected: boolean;
  agentCount: number;
  sessionCount: number;
}

export const StatusBar = memo(function StatusBar({ connected, agentCount, sessionCount }: StatusBarProps) {
  return (
    <div style={{
      display: "flex", alignItems: "center", justifyContent: "space-between",
      padding: "8px 20px", borderBottom: "1px solid #2a2a2e",
      fontFamily: "'Courier New', monospace", background: "#111",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <span style={{
          display: "inline-block", width: 8, height: 8, borderRadius: "50%",
          background: connected ? "#4caf50" : "#ef5350",
          boxShadow: connected ? "0 0 8px rgba(76,175,80,0.6)" : "none",
        }} />
        <span style={{ fontSize: 11, color: connected ? "#4caf50" : "#ef5350", letterSpacing: 1 }}>
          {connected ? "LIVE" : "RECONNECTING"}
        </span>
      </div>
      <div style={{ display: "flex", gap: 20, fontSize: 11, color: "#666" }}>
        <span><strong style={{ color: "#26c6da" }}>{agentCount}</strong> agents</span>
        <span><strong style={{ color: "#7e57c2" }}>{sessionCount}</strong> rooms</span>
        <a href="/" style={{ color: "#444", textDecoration: "none" }}>terminal</a>
        <a href="/dashboard" style={{ color: "#444", textDecoration: "none" }}>orbital</a>
      </div>
    </div>
  );
});
