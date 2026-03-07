import { memo, useMemo } from "react";
import { SVG_WIDTH, SVG_HEIGHT, ROOM_GRID, roomStyle } from "../lib/constants";
import { Plant } from "./furniture";
import { DeskUnit } from "./DeskUnit";
import { WallClock } from "./WallClock";
import type { AgentState, Session } from "../lib/types";

interface FloorPlanProps {
  sessions: Session[];
  agents: AgentState[];
  onSelectAgent: (agent: AgentState) => void;
}

export const FloorPlan = memo(function FloorPlan({ sessions, agents, onSelectAgent }: FloorPlanProps) {
  const sessionAgents = useMemo(() => {
    const map = new Map<string, AgentState[]>();
    for (const a of agents) {
      const arr = map.get(a.session) || [];
      arr.push(a);
      map.set(a.session, arr);
    }
    return map;
  }, [agents]);

  const rooms = useMemo(() => {
    return sessions.map((s, i) => {
      const col = i % ROOM_GRID.cols;
      const row = Math.floor(i / ROOM_GRID.cols);
      return {
        session: s,
        x: ROOM_GRID.startX + col * (ROOM_GRID.roomW + ROOM_GRID.gapX),
        y: ROOM_GRID.startY + row * (ROOM_GRID.roomH + ROOM_GRID.gapY),
        w: ROOM_GRID.roomW,
        h: ROOM_GRID.roomH,
        style: roomStyle(s.name),
        agents: sessionAgents.get(s.name) || [],
      };
    });
  }, [sessions, sessionAgents]);

  const busyCount = agents.filter(a => a.status === "busy").length;

  return (
    <div style={{ display: "flex", justifyContent: "center", padding: "10px 20px" }}>
      <svg
        viewBox={`0 0 ${SVG_WIDTH} ${SVG_HEIGHT}`}
        style={{ width: "100%", maxWidth: 1280, height: "auto" }}
      >
        <defs>
          {/* Checkerboard floor */}
          <pattern id="floor-tiles" x={0} y={0} width={40} height={40} patternUnits="userSpaceOnUse">
            <rect width={20} height={20} fill="#1e1e1e" />
            <rect x={20} y={0} width={20} height={20} fill="#1a1a1a" />
            <rect x={0} y={20} width={20} height={20} fill="#1a1a1a" />
            <rect x={20} y={20} width={20} height={20} fill="#1e1e1e" />
          </pattern>
          {/* Neon glow filter */}
          <filter id="neon-glow" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur in="SourceGraphic" stdDeviation="3" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          {/* Scan line pattern */}
          <pattern id="scanlines" x={0} y={0} width={4} height={4} patternUnits="userSpaceOnUse">
            <rect width={4} height={2} fill="rgba(255,255,255,0.015)" />
          </pattern>
        </defs>

        {/* Background */}
        <rect width={SVG_WIDTH} height={SVG_HEIGHT} fill="#0a0a0f" />
        <rect width={SVG_WIDTH} height={SVG_HEIGHT} fill="url(#floor-tiles)" />

        {/* CRT scan lines overlay */}
        <rect width={SVG_WIDTH} height={SVG_HEIGHT} fill="url(#scanlines)" />

        {/* Top wall */}
        <rect width={SVG_WIDTH} height={65} fill="#222228" />
        <rect y={63} width={SVG_WIDTH} height={3} fill="#333340" />

        {/* Neon title with glow */}
        <text x={SVG_WIDTH / 2} y={28} textAnchor="middle" fill="#26c6da" fontSize={20}
          fontFamily="'Courier New', monospace" fontWeight="bold" letterSpacing={8}
          filter="url(#neon-glow)"
          style={{ textTransform: "uppercase" as const }}>
          oracle office
        </text>
        <text x={SVG_WIDTH / 2} y={48} textAnchor="middle" fill="#555" fontSize={10}
          fontFamily="'Courier New', monospace" letterSpacing={3}>
          multi-agent workflow orchestra
        </text>

        {/* Power level indicator */}
        <g transform={`translate(80, 20)`}>
          <text x={0} y={0} fill="#ffa726" fontSize={8} fontFamily="'Courier New', monospace"
            letterSpacing={1}>POWER LEVEL</text>
          <rect x={0} y={4} width={80} height={8} rx={2} fill="#1a1a1a" stroke="#333" strokeWidth={0.5} />
          <rect x={0} y={4} width={Math.min(80, busyCount * 12)} height={8} rx={2}
            fill={busyCount > 5 ? "#ef5350" : busyCount > 2 ? "#ffa726" : "#4caf50"}
            style={{ transition: "width 0.5s" }} />
          <text x={84} y={12} fill="#888" fontSize={8} fontFamily="'Courier New', monospace">
            {busyCount}/{agents.length}
          </text>
        </g>

        {/* Clock */}
        <WallClock x={1200} y={32} />

        {/* Wall plants */}
        <Plant x={40} y={38} size={0.7} />
        <Plant x={SVG_WIDTH - 60} y={38} size={0.7} />

        {/* Water cooler */}
        <g transform={`translate(${SVG_WIDTH / 2 - 200}, 30)`}>
          <rect x={-6} y={0} width={12} height={22} rx={3} fill="#4fc3f7" opacity={0.3} stroke="#4fc3f7" strokeWidth={0.5} />
          <rect x={-8} y={20} width={16} height={6} rx={2} fill="#555" />
        </g>

        {/* Coffee machine */}
        <g transform={`translate(${SVG_WIDTH / 2 + 200}, 30)`}>
          <rect x={-8} y={2} width={16} height={18} rx={2} fill="#3d3225" stroke="#5a4a38" strokeWidth={0.5} />
          <rect x={-5} y={5} width={3} height={3} rx={1} fill="#ef5350" />
          <rect x={2} y={5} width={3} height={3} rx={1} fill="#4caf50" />
          <rect x={-4} y={18} width={8} height={6} rx={1} fill="#2a2218" />
        </g>

        {/* Session rooms */}
        {rooms.map((room) => (
          <Room key={room.session.name} {...room} onSelectAgent={onSelectAgent} />
        ))}

        {/* Vignette overlay */}
        <rect width={SVG_WIDTH} height={SVG_HEIGHT} fill="url(#vignette)" opacity={0.3} />
      </svg>
    </div>
  );
});

// --- Room ---

interface RoomProps {
  x: number; y: number; w: number; h: number;
  session: Session;
  style: { accent: string; floor: string; wall: string; label: string };
  agents: AgentState[];
  onSelectAgent: (agent: AgentState) => void;
}

const Room = memo(function Room({ x, y, w, h, session, style, agents, onSelectAgent }: RoomProps) {
  const deskW = 160;
  const deskStartX = w / 2 - (Math.min(4, agents.length) * deskW) / 2 + deskW / 2;
  const hasBusy = agents.some(a => a.status === "busy");

  return (
    <g transform={`translate(${x}, ${y})`}>
      {/* Room floor */}
      <rect width={w} height={h} rx={4} fill={style.floor} />

      {/* Neon border — pulses when agents are busy */}
      <rect width={w} height={h} rx={4} fill="none"
        stroke={style.accent} strokeWidth={hasBusy ? 2 : 1}
        opacity={hasBusy ? 0.6 : 0.2}
        style={hasBusy ? { animation: "room-pulse 2s ease-in-out infinite" } : {}}
        filter={hasBusy ? "url(#neon-glow)" : undefined} />

      {/* Room header wall */}
      <rect width={w} height={30} rx={4} fill={style.wall} />
      <rect y={24} width={w} height={6} fill={style.wall} />

      {/* Neon accent line */}
      <rect y={29} width={w} height={2} fill={style.accent} opacity={0.6} />

      {/* Room label with glow */}
      <text x={12} y={19} fill={style.accent} fontSize={12} fontWeight="bold"
        fontFamily="'Courier New', monospace" letterSpacing={2}
        filter={hasBusy ? "url(#neon-glow)" : undefined}>
        {style.label.toUpperCase()}
      </text>

      {/* Agent count badge */}
      <g transform={`translate(${w - 42}, 7)`}>
        <rect width={30} height={16} rx={4} fill={style.accent + "22"} stroke={style.accent + "55"} strokeWidth={0.8} />
        <text x={15} y={12} textAnchor="middle" fill={style.accent} fontSize={10}
          fontFamily="'Courier New', monospace" fontWeight="bold">
          {agents.length}
        </text>
      </g>

      {/* Desks with agents */}
      {agents.map((agent, i) => {
        const col = i % 4;
        const row = Math.floor(i / 4);
        return (
          <DeskUnit
            key={agent.target}
            x={deskStartX + col * deskW}
            y={70 + row * 150}
            agent={agent}
            accent={style.accent}
            onSelect={onSelectAgent}
          />
        );
      })}

      {/* Empty desks */}
      {agents.length > 0 && agents.length % 4 !== 0 &&
        Array.from({ length: 4 - (agents.length % 4) }, (_, i) => {
          const col = (agents.length + i) % 4;
          const row = Math.floor((agents.length + i) / 4);
          return (
            <DeskUnit key={`empty-${i}`} x={deskStartX + col * deskW} y={70 + row * 150}
              agent={null} accent={style.accent} onSelect={onSelectAgent} />
          );
        })
      }

      {/* Corner plant */}
      <Plant x={w - 25} y={h - 38} size={0.55} />
    </g>
  );
});
