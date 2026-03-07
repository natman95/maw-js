import { memo } from "react";

interface ChairProps { x: number; y: number; }

export const Chair = memo(function Chair({ x, y }: ChairProps) {
  return (
    <g transform={`translate(${x}, ${y})`}>
      {/* Backrest */}
      <path d="M -14 -18 Q 0 -24 14 -18" fill="none" stroke="#4a4a4a" strokeWidth={5} strokeLinecap="round" />
      {/* Seat */}
      <circle r={16} fill="#3a3a3a" stroke="#4a4a4a" strokeWidth={1.5} />
      {/* Center pole */}
      <rect x={-2} y={14} width={4} height={8} fill="#333" />
      {/* Base star */}
      <ellipse cx={0} cy={24} rx={14} ry={4} fill="#2a2a2a" />
    </g>
  );
});
