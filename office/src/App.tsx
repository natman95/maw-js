import { useState, useCallback } from "react";
import { useWebSocket } from "./hooks/useWebSocket";
import { useSessions } from "./hooks/useSessions";
import { StatusBar } from "./components/StatusBar";
import { FloorPlan } from "./components/FloorPlan";
import { TerminalModal } from "./components/TerminalModal";
import type { AgentState } from "./lib/types";

export function App() {
  const [selectedAgent, setSelectedAgent] = useState<AgentState | null>(null);
  const { sessions, agents, handleMessage } = useSessions();
  const { connected, send } = useWebSocket(handleMessage);

  const onSelectAgent = useCallback((agent: AgentState) => {
    setSelectedAgent(agent);
  }, []);

  return (
    <>
      <StatusBar connected={connected} agentCount={agents.length} sessionCount={sessions.length} />
      <FloorPlan sessions={sessions} agents={agents} onSelectAgent={onSelectAgent} />
      {selectedAgent && (
        <TerminalModal agent={selectedAgent} send={send} onClose={() => setSelectedAgent(null)} />
      )}
    </>
  );
}
