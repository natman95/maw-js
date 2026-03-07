import { memo } from "react";

interface ZoneLabelProps { x: number; y: number; label: string; color?: string; }

export const ZoneLabel = memo(function ZoneLabel({ x, y, label, color = "#555" }: ZoneLabelProps) {
  return (
    <text x={x} y={y} fill={color} fontSize={10} fontWeight="bold"
      fontFamily="'Courier New', monospace" letterSpacing={2}
      style={{ textTransform: "uppercase" as const }}>
      {label}
    </text>
  );
});
