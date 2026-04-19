#!/bin/bash
# docker/oracle-container/entrypoint.sh — PID 1 for a container-native oracle.
#
# Bootstrap order:
#   1. Ensure $HOME, $MAW_HOME, $CLAUDE_CONFIG_DIR, $MAILBOX_DIR exist.
#   2. Load-or-mint oracle identity at $MAW_HOME/identity.json.
#      Canonical path is under .maw/ (not .claude/) per rfc-identity — makes
#      the file interchangeable with a host-side oracle's identity, so
#      `rsync $MAW_HOME` migrates the oracle to a new host.
#      Shape mirrors rfc-identity RFC §4 so Phase-1 code can consume it
#      without a migration: {schema, node, nickname, fingerprint, born}.
#      Node name precedence: $ORACLE_NAME env > identity.json.node > random.
#   3. If peers.json missing, run `maw init --non-interactive --node <name>`.
#   4. Register the host as a peer with --allow-unreachable (the host may not
#      have finished booting yet when we first come up — the host-side probe
#      fills in the return edge when it registers us).
#   5. Ensure writable inbox path (ψ/memory/mailbox/<self>/) exists — RFC #627
#      MUST item 6: team-comms and team-shutdown --merge target this.
#   6. exec "$@" so `maw serve` becomes PID 1 and receives SIGTERM cleanly.
#
# The CMD default (`maw serve 3456`) makes this container a symmetric peer:
# it can probe the host AND be probed back, which is what lets it show up
# in `maw peers list` on the host AND respond to `maw hey`.
set -eu

: "${HOME:=/home/oracle}"
export HOME
: "${MAW_HOME:=$HOME/.maw}"
: "${CLAUDE_CONFIG_DIR:=$HOME/.claude}"
: "${MAILBOX_ROOT:=$HOME/vault/ψ/memory/mailbox}"
: "${HOST_MAW_ALIAS:=host}"
: "${HOST_MAW_URL:=http://host-maw:3456}"
: "${IDLE_INTERVAL_SECONDS:=60}"

mkdir -p "$MAW_HOME" "$CLAUDE_CONFIG_DIR"

# --- identity load-or-mint -------------------------------------------------
# Canonical path per rfc-identity: $MAW_HOME/identity.json. Shape matches
# RFC §4 so a future `maw identity init` can adopt the file in place.
IDENTITY_FILE="$MAW_HOME/identity.json"
if [ -f "$IDENTITY_FILE" ]; then
  STORED_NAME=$(grep -o '"node"[[:space:]]*:[[:space:]]*"[^"]*"' "$IDENTITY_FILE" | sed 's/.*"\([^"]*\)"$/\1/')
  STORED_FP=$(grep -o '"fingerprint"[[:space:]]*:[[:space:]]*"[^"]*"' "$IDENTITY_FILE" | sed 's/.*"\([^"]*\)"$/\1/')
else
  STORED_NAME=""
  STORED_FP=""
fi

if [ -n "${ORACLE_NAME:-}" ]; then
  NODE_NAME="$ORACLE_NAME"
elif [ -n "$STORED_NAME" ]; then
  NODE_NAME="$STORED_NAME"
else
  # `tr -dc` on a /dev/urandom stream raises SIGPIPE after enough bytes;
  # `head -c 32` first bounds the read so `set -e` doesn't abort bootstrap.
  STEM=$(head -c 32 /dev/urandom | tr -dc 'a-z0-9' | head -c 6 || true)
  NODE_NAME="oracle-${STEM:-anon}"
fi

# Nickname (human-readable) is orthogonal to fingerprint (keypair-derived)
# per rfc-identity — don't collapse them. The stem env wins for display;
# fingerprint is stubbed until Phase-1 keypair code lands, but the field
# is in the file so downstream tooling can read it today without crashing.
NICKNAME="${ORACLE_NICKNAME:-$NODE_NAME}"

if [ -n "$STORED_FP" ]; then
  FINGERPRINT="$STORED_FP"
else
  # Stub fingerprint until `maw identity init` (rfc-identity Phase-1) lands.
  # Deterministic-per-volume so the value is stable across restarts, but
  # clearly not-a-real-pubkey-hash (prefix `stub-`) so audit tools can
  # distinguish stubs from Phase-1 identities.
  FINGERPRINT="stub-$(head -c 32 /dev/urandom | sha256sum | head -c 16 || echo 0000000000000000)"
fi

if [ ! -f "$IDENTITY_FILE" ] || [ "$STORED_NAME" != "$NODE_NAME" ]; then
  cat > "$IDENTITY_FILE" <<JSON
{
  "schema": "0-proto",
  "node": "$NODE_NAME",
  "nickname": "$NICKNAME",
  "fingerprint": "$FINGERPRINT",
  "born": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "note": "prototype identity — Phase-1 keypair code (rfc-identity #629) will replace the stub fingerprint in place; schema will advance to \"1\""
}
JSON
fi

echo "[container-oracle] identity → $NODE_NAME ($NICKNAME / $FINGERPRINT)"
echo "[container-oracle] identity file → $IDENTITY_FILE"

# --- maw init (idempotent-ish: --force re-writes, but we gate on peers.json)
if [ ! -f "$MAW_HOME/peers.json" ]; then
  maw init --non-interactive --node "$NODE_NAME" --force
fi

# --- register host as peer -------------------------------------------------
# --allow-unreachable: host may not be up yet on first compose boot. The host
# side adds us back when IT boots, so the edge closes either way.
maw peers add "$HOST_MAW_ALIAS" "$HOST_MAW_URL" --allow-unreachable || true

echo "[container-oracle] bootstrap complete — peers.json:"
cat "$MAW_HOME/peers.json" 2>/dev/null || echo "(no peers.json yet)"

# --- mailbox (RFC #627 MUST item 6) ----------------------------------------
# `maw team send` falls back to mailbox-write when peer is down; team-comms
# and team-shutdown --merge both target this path. Create it eagerly so the
# first inbound send doesn't race with volume-init.
SELF_MAILBOX="$MAILBOX_ROOT/$NODE_NAME"
mkdir -p "$SELF_MAILBOX"
echo "[container-oracle] mailbox → $SELF_MAILBOX"

# Required for the host container to reach us over the compose network.
export MAW_HOST=0.0.0.0

# Background re-probe loop so stale entries self-heal if the host flaps.
# Sends a `maw peers probe` every $IDLE_INTERVAL_SECONDS; stays detached
# from stdout so it doesn't interleave with the serve logs.
(
  while sleep "$IDLE_INTERVAL_SECONDS"; do
    maw peers probe "$HOST_MAW_ALIAS" >/dev/null 2>&1 || true
  done
) &

exec "$@"
