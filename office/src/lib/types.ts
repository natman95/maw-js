export interface Window {
  index: number;
  name: string;
  active: boolean;
}

export interface Session {
  name: string;
  windows: Window[];
}

export type PaneStatus = "ready" | "busy" | "idle";

export interface AgentState {
  target: string;
  name: string;
  session: string;
  windowIndex: number;
  active: boolean;
  preview: string;
  status: PaneStatus;
}
