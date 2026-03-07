import { memo } from "react";

interface PlantProps { x: number; y: number; size?: number; }

export const Plant = memo(function Plant({ x, y, size = 1 }: PlantProps) {
  return (
    <g transform={`translate(${x}, ${y}) scale(${size})`}>
      {/* Pot */}
      <path d="M -10 8 L -12 24 Q -12 30 -7 30 L 7 30 Q 12 30 12 24 L 10 8 Z" fill="#8b5e3c" stroke="#6b4226" strokeWidth={1} />
      <rect x={-12} y={5} width={24} height={5} rx={2} fill="#9b6e4c" />
      {/* Soil */}
      <ellipse cx={0} cy={8} rx={9} ry={3} fill="#3d2b1f" />
      {/* Leaves */}
      <ellipse cx={0} cy={-4} rx={14} ry={12} fill="#2ecc71" opacity={0.9} />
      <ellipse cx={-7} cy={-12} rx={9} ry={7} fill="#27ae60" opacity={0.8} />
      <ellipse cx={7} cy={-10} rx={8} ry={6} fill="#1e8449" opacity={0.7} />
      <ellipse cx={0} cy={-18} rx={6} ry={5} fill="#2ecc71" opacity={0.6} />
    </g>
  );
});
