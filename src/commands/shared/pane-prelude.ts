import { CLAUDE_COLS, CLAUDE_ROWS } from "./wake-pane-size";

// Initial terminal discipline + size for newly-spawned agent panes. Without
// this, panes inherit whatever stty/size state the parent process left behind
// — most visibly the 80x24 default when the session was created detached
// (#1091). `stty sane` resets line discipline; the explicit rows/cols stop
// claude/codex from baking narrow scrollback at spawn. Errors silenced so a
// missing stty doesn't break the spawn.
export const PANE_INIT_PRELUDE = `stty sane 2>/dev/null; stty rows ${CLAUDE_ROWS} cols ${CLAUDE_COLS} 2>/dev/null`;
