import { memo } from "react";

interface DeskProps { x: number; y: number; accent?: string; }

export const Desk = memo(function Desk({ x, y, accent = "#26c6da" }: DeskProps) {
  return (
    <g transform={`translate(${x}, ${y})`}>
      {/* Desk surface */}
      <rect x={-55} y={0} width={110} height={50} rx={4} fill="#3d3225" stroke="#5a4a38" strokeWidth={1.5} />
      {/* Desk front panel */}
      <rect x={-55} y={42} width={110} height={14} rx={2} fill="#2a2218" />
      {/* Legs */}
      <rect x={-50} y={50} width={6} height={12} fill="#2a2218" />
      <rect x={44} y={50} width={6} height={12} fill="#2a2218" />
      {/* Monitor */}
      <rect x={-18} y={-28} width={36} height={26} rx={2} fill="#111" stroke="#333" strokeWidth={1.5} />
      <rect x={-14} y={-24} width={28} height={18} rx={1} fill="#0a1628" />
      {/* Monitor glow line */}
      <rect x={-12} y={-22} width={24} height={1} fill={accent} opacity={0.6} />
      <rect x={-12} y={-18} width={18} height={1} fill={accent} opacity={0.3} />
      <rect x={-12} y={-14} width={20} height={1} fill={accent} opacity={0.3} />
      {/* Monitor stand */}
      <rect x={-3} y={-2} width={6} height={4} fill="#333" />
      <rect x={-8} y={1} width={16} height={3} rx={1} fill="#333" />
      {/* Keyboard */}
      <rect x={-16} y={14} width={32} height={10} rx={2} fill="#2a2a2a" stroke="#444" strokeWidth={0.8} />
      {/* Keyboard keys (tiny dots) */}
      {[0,1,2].map(row => (
        <g key={row}>
          {Array.from({length: 8}, (_, i) => (
            <rect key={i} x={-13 + i * 3.5} y={16 + row * 2.5} width={2.5} height={1.5} rx={0.3} fill="#444" />
          ))}
        </g>
      ))}
      {/* Lamp */}
      <rect x={32} y={-8} width={3} height={14} fill="#555" />
      <ellipse cx={33.5} cy={-10} rx={8} ry={5} fill="#ffa726" opacity={0.15} />
      <rect x={28} y={-14} width={11} height={6} rx={3} fill="#666" />
    </g>
  );
});
