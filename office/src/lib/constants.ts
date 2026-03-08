export const SVG_WIDTH = 1280;
export const SVG_HEIGHT = 900;

// Session group → room mapping
export const ROOM_COLORS: Record<string, { accent: string; floor: string; wall: string; label: string }> = {
  "0":          { accent: "#26c6da", floor: "#1a2228", wall: "#0e1a20", label: "Main" },
  "1-oracles":  { accent: "#7e57c2", floor: "#1a1428", wall: "#120e1e", label: "Oracles" },
  "2-arra":     { accent: "#42a5f5", floor: "#141a28", wall: "#0e1420", label: "Arra" },
  "3-brewing":  { accent: "#ffa726", floor: "#281e14", wall: "#201810", label: "Brewing" },
  "4-watchers": { accent: "#4caf50", floor: "#142818", wall: "#0e2010", label: "Watchers" },
  "5-tools":    { accent: "#ef5350", floor: "#281418", wall: "#200e12", label: "Tools" },
  "6-solar":    { accent: "#fdd835", floor: "#282814", wall: "#20200e", label: "Solar" },
};

const FALLBACK_ROOMS = [
  { accent: "#ab47bc", floor: "#1e1428", wall: "#160e1e", label: "Room" },
  { accent: "#ec407a", floor: "#281420", wall: "#200e18", label: "Room" },
];

export function roomStyle(sessionName: string) {
  if (ROOM_COLORS[sessionName]) return ROOM_COLORS[sessionName];
  let h = 0;
  for (let i = 0; i < sessionName.length; i++) h = ((h << 5) - h + sessionName.charCodeAt(i)) | 0;
  return FALLBACK_ROOMS[Math.abs(h) % FALLBACK_ROOMS.length];
}

// Preferred agent display order (lower = first, unlisted = 999)
export const AGENT_ORDER: Record<string, number> = {
  "neo-oracle": 0,
  "nexus-oracle": 1,
  "hermes-oracle": 2,
  "pulse-oracle": 3,
};

export function agentSortKey(name: string): number {
  return AGENT_ORDER[name] ?? 999;
}

// Agent capsule colors (deterministic by name hash)
export const AGENT_COLORS = [
  "#ff6b6b", "#4ecdc4", "#45b7d1", "#96ceb4", "#ffa07a",
  "#dda0dd", "#98d8c8", "#f7dc6f", "#bb8fce", "#85c1e9",
  "#f0b27a", "#82e0aa",
];

export function agentColor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = ((h << 5) - h + name.charCodeAt(i)) | 0;
  return AGENT_COLORS[Math.abs(h) % AGENT_COLORS.length];
}

// Desk grid within each room
export const DESK = {
  cols: 4,
  cellW: 200,
  cellH: 160,
  offsetX: 30,
  offsetY: 60,
} as const;

// Room layout grid
export const ROOM_GRID = {
  cols: 3,
  roomW: 400,
  roomH: 400,
  gapX: 20,
  gapY: 20,
  startX: 20,
  startY: 70,
} as const;

export const AVATAR = {
  radius: 20,
  strokeWidth: 3,
  nameLabelMaxChars: 12,
} as const;
