import { memo } from "react";
import { Desk, Chair } from "./furniture";
import { AgentAvatar } from "./AgentAvatar";
import type { AgentState } from "../lib/types";

interface DeskUnitProps {
  x: number;
  y: number;
  agent: AgentState | null;
  accent: string;
  onSelect: (agent: AgentState) => void;
}

export const DeskUnit = memo(function DeskUnit({ x, y, agent, accent, onSelect }: DeskUnitProps) {
  return (
    <g transform={`translate(${x}, ${y})`}>
      <Desk x={0} y={40} accent={accent} />
      <Chair x={0} y={-10} />
      {agent && (
        <g transform="translate(0, -10)">
          <AgentAvatar
            name={agent.name}
            target={agent.target}
            status={agent.status}
            preview={agent.preview}
            accent={accent}
            onClick={() => onSelect(agent)}
          />
        </g>
      )}
    </g>
  );
});
