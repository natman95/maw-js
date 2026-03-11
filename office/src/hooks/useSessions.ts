import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import type { Session, AgentState, PaneStatus, AgentEvent } from "../lib/types";
import { stripAnsi } from "../lib/ansi";
import { playSaiyanSound } from "../lib/sounds";
import { agentSortKey } from "../lib/constants";
import { useFleetStore } from "../lib/store";
import { activeOracles, describeActivity, type FeedEvent, type FeedEventType } from "../lib/feed";

// Simple string hash
function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return h;
}

export function useSessions() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [captureData, setCaptureData] = useState<Record<string, { preview: string; status: PaneStatus }>>({});
  const pollTimer = useRef<ReturnType<typeof setTimeout>>();
  const sessionsRef = useRef(sessions);
  sessionsRef.current = sessions;

  // Track content hashes for change detection
  const hashHistory = useRef<Record<string, { prev: number; curr: number; unchangedCount: number }>>({});
  const lastSoundTime = useRef(0);
  const [saiyanTargets, setSaiyanTargets] = useState<Set<string>>(new Set());
  const saiyanTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const [eventLog, setEventLog] = useState<AgentEvent[]>([]);
  const MAX_EVENTS = 200;

  // Oracle feed state
  const [feedEvents, setFeedEvents] = useState<FeedEvent[]>([]);
  const MAX_FEED = 100;

  const addEvent = useCallback((target: string, type: AgentEvent["type"], detail: string) => {
    setEventLog(prev => {
      const next = [...prev, { time: Date.now(), target, type, detail }];
      return next.length > MAX_EVENTS ? next.slice(-MAX_EVENTS) : next;
    });
  }, []);

  const markBusy = useFleetStore((s) => s.markBusy);

  // Feed-triggered Saiyan: map oracle name → tmux target for burst animation
  const agentsRef = useRef<AgentState[]>([]);
  const SAIYAN_FEED_EVENTS = new Set<FeedEventType>(["PreToolUse", "UserPromptSubmit", "SubagentStart"]);
  const SAIYAN_FEED_DURATION = 8000; // 8s burst from feed events

  const triggerFeedSaiyan = useCallback((event: FeedEvent) => {
    if (!SAIYAN_FEED_EVENTS.has(event.event)) return;
    // Find agent by oracle name — only match primary windows (ending with -oracle)
    // e.g., feed oracle "hermes" → agent "hermes-oracle", NOT "hermes-bitkub"
    const agent = agentsRef.current.find(a => a.name === `${event.oracle}-oracle`)
      || agentsRef.current.find(a => a.name === event.oracle);
    if (!agent) return;
    const target = agent.target;

    // Trigger Saiyan burst (with sound throttle)
    const now = Date.now();
    if (now - lastSoundTime.current > 60000) {
      lastSoundTime.current = now;
      playSaiyanSound();
    }
    clearTimeout(saiyanTimers.current[target]);
    setSaiyanTargets(prev => new Set(prev).add(target));
    saiyanTimers.current[target] = setTimeout(() => {
      setSaiyanTargets(prev => {
        const next = new Set(prev);
        next.delete(target);
        return next;
      });
    }, SAIYAN_FEED_DURATION);

    // Also mark as busy in recent store
    markBusy([{ target, name: agent.name, session: agent.session }]);
  }, [markBusy]);

  const handleMessage = useCallback((data: any) => {
    if (data.type === "sessions") {
      setSessions(data.sessions);
    } else if (data.type === "recent") {
      // Server-side recent agents → merge into zustand store
      const agents: { target: string; name: string; session: string }[] = data.agents || [];
      if (agents.length > 0) markBusy(agents);
    } else if (data.type === "feed") {
      // Single real-time feed event
      const feedEvent = data.event as FeedEvent;
      setFeedEvents(prev => {
        const next = [...prev, feedEvent];
        return next.length > MAX_FEED ? next.slice(-MAX_FEED) : next;
      });
      // Trigger Saiyan burst from feed activity
      triggerFeedSaiyan(feedEvent);
    } else if (data.type === "feed-history") {
      // Batch of recent events on connect
      setFeedEvents((data.events as FeedEvent[]).slice(-MAX_FEED));
    } else if (data.type === "previews") {
      // Lightweight preview updates from viewport-aware subscription
      const previews: Record<string, string> = data.data;
      setCaptureData((prev) => {
        let next = prev;
        for (const [target, raw] of Object.entries(previews)) {
          const text = stripAnsi(raw);
          const lines = text.split("\n").filter((l: string) => l.trim());
          const preview = (lines[lines.length - 1] || "").slice(0, 120);
          const existing = next[target];
          if (!existing || existing.preview !== preview) {
            if (next === prev) next = { ...prev };
            next[target] = { preview, status: existing?.status || "idle" };
          }
        }
        return next;
      });
    }
  }, []);

  // Poll captures — detect busy by content change
  useEffect(() => {
    async function poll() {
      const targets: string[] = [];
      sessionsRef.current.forEach((s) =>
        s.windows.forEach((w) => targets.push(`${s.name}:${w.index}`))
      );
      for (let i = 0; i < targets.length; i += 4) {
        const batch = targets.slice(i, i + 4);
        await Promise.allSettled(
          batch.map(async (target) => {
            try {
              const res = await fetch(`/api/capture?target=${encodeURIComponent(target)}`);
              const data = await res.json();
              const raw = data.content || "";
              const text = stripAnsi(raw);

              // Exclude bottom 15% (status bar, prompt, timers, token counters)
              const allLines = text.split("\n");
              const cutoff = Math.max(1, Math.floor(allLines.length * 0.85));
              const topPart = allLines.slice(0, cutoff).join("\n");
              const contentHash = hash(topPart);

              // Track hash changes
              const entry = hashHistory.current[target] || { prev: 0, curr: 0, unchangedCount: 0 };
              entry.prev = entry.curr;
              entry.curr = contentHash;

              if (entry.prev !== 0 && entry.prev !== entry.curr) {
                // Content changed → busy
                entry.unchangedCount = 0;
              } else {
                // Content same → increment stable count
                entry.unchangedCount++;
              }
              hashHistory.current[target] = entry;

              // Check bottom lines for known indicators
              const lines = text.split("\n").filter((l: string) => l.trim());
              const bottom = lines.slice(-5).join("\n");
              const hasPrompt = bottom.includes("\u276f"); // ❯
              const hasBusySign = /[∴✢⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏◐◑◒◓⣾⣽⣻⢿⡿⣟⣯⣷]/.test(bottom) || /● \w+\(/.test(bottom) || /\b(Read|Edit|Write|Bash|Grep|Glob|Agent)\b/.test(bottom); // Thinking/tool calls/Claude Code tools

              // Determine status — only "busy" if explicit indicator found
              let status: PaneStatus;
              if (hasBusySign) {
                // Explicit busy indicator always wins (spinners, tool names)
                status = "busy";
              } else if (hasPrompt) {
                // Prompt visible → ready (regardless of recent changes)
                status = "ready";
              } else if (entry.prev === 0) {
                // First poll, no prompt visible
                status = "idle";
              } else if (entry.unchangedCount <= 2) {
                // Content changed recently + no prompt → likely busy
                status = "busy";
              } else if (entry.unchangedCount <= 6) {
                // Cooling down, no prompt visible
                status = "ready";
              } else {
                // Stable for long, no prompt
                status = "idle";
              }

              const preview = (lines[lines.length - 1] || "").slice(0, 120);

              setCaptureData((p) => {
                const existing = p[target];
                if (existing && existing.preview === preview && existing.status === status) return p;
                // Log status change
                if (existing && existing.status !== status) {
                  addEvent(target, "status", `${existing.status} → ${status}`);
                }
                // Play power-up sound on transition to busy (max once per 60s)
                if (status === "busy" && existing?.status !== "busy") {
                  const now = Date.now();
                  if (now - lastSoundTime.current > 60000) {
                    lastSoundTime.current = now;
                    playSaiyanSound();
                  }
                  // 10s saiyan burst animation
                  clearTimeout(saiyanTimers.current[target]);
                  setSaiyanTargets(prev => new Set(prev).add(target));
                  saiyanTimers.current[target] = setTimeout(() => {
                    setSaiyanTargets(prev => {
                      const next = new Set(prev);
                      next.delete(target);
                      return next;
                    });
                  }, 10000);
                }
                return { ...p, [target]: { preview, status } };
              });
            } catch {}
          })
        );
      }
      pollTimer.current = setTimeout(poll, 5000);
    }
    poll();
    return () => clearTimeout(pollTimer.current);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Derive flat agent list (memoized to prevent re-renders)
  const agents: AgentState[] = useMemo(() => {
    const list = sessions.flatMap((s) =>
      s.windows.map((w) => {
        const key = `${s.name}:${w.index}`;
        const cd = captureData[key];
        return {
          target: key,
          name: w.name,
          session: s.name,
          windowIndex: w.index,
          active: w.active,
          preview: cd?.preview || "",
          status: cd?.status || "idle",
        };
      })
    );
    list.sort((a, b) => agentSortKey(a.name) - agentSortKey(b.name));
    agentsRef.current = list;
    return list;
  }, [sessions, captureData]);

  // Compute active oracles from feed (memoized, 5min window)
  const feedActive = useMemo(() => activeOracles(feedEvents, 5 * 60_000), [feedEvents]);

  return { sessions, agents, saiyanTargets, eventLog, addEvent, handleMessage, feedEvents, feedActive };
}
