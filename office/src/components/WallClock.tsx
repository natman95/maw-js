import { memo, useState, useEffect } from "react";

interface WallClockProps { x: number; y: number; }

export const WallClock = memo(function WallClock({ x, y }: WallClockProps) {
  const [time, setTime] = useState(new Date());

  useEffect(() => {
    const id = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const h = time.getHours().toString().padStart(2, "0");
  const m = time.getMinutes().toString().padStart(2, "0");
  const s = time.getSeconds().toString().padStart(2, "0");

  return (
    <g transform={`translate(${x}, ${y})`}>
      <rect x={-36} y={-14} width={72} height={28} rx={4} fill="#111" stroke="#333" strokeWidth={1.5} />
      <text x={0} y={6} textAnchor="middle" fill="#26c6da" fontSize={16}
        fontFamily="'Courier New', monospace" fontWeight="bold">
        {h}:{m}<tspan fill="#555" fontSize={10}>:{s}</tspan>
      </text>
    </g>
  );
});
