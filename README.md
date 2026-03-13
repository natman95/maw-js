# maw.js

> Multi-Agent Workflow — remote tmux orchestra control via SSH

**[Join Nat Weerawan's Subscribers Group!](https://www.facebook.com/groups/1461988771737551)** | [Watch the Demo](https://www.facebook.com/reel/1513957190087776)

## Quick Start (no install)

```bash
bunx --bun github:Soul-Brews-Studio/maw-js ls
bunx --bun github:Soul-Brews-Studio/maw-js peek hermes
bunx --bun github:Soul-Brews-Studio/maw-js hey hermes "how are you"
```

## Install (global)

```bash
# Clone + link
ghq get Soul-Brews-Studio/maw-js
cd $(ghq root)/github.com/Soul-Brews-Studio/maw-js
bun install && bun link

# Now use directly
maw ls
```

## Usage

```bash
maw ls                      # list sessions + windows
maw peek                    # one-line summary per agent
maw peek hermes             # see hermes's screen
maw hey hermes how are you  # send message to hermes
maw hermes /recap           # shorthand: agent + message
maw hermes                  # shorthand: peek agent
maw serve                   # web UI on :3456
```

## Env

```bash
export MAW_HOST=white.local   # SSH target (default: local tmux)
```

## Web UIs

| Path | View |
|------|------|
| `/` | Terminal UI (ANSI, click to interact) |
| `/dashboard` | Orbital constellation |
| `/office` | Virtual office (React, SVG avatars) |

## Evolution

```
maw.env.sh (Oct 2025) → oracles() zsh (Mar 2026) → maw.js (Mar 2026)
   30+ shell cmds         ghq-based launcher         Bun/TS + Web UI
```
