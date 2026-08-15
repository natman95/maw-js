module.exports = {
  apps: [
    {
      name: 'maw',
      script: 'src/core/server.ts',
      interpreter: 'bun',                // PATH lookup — works on any host
      watch: false,                       // production: restart manual after deploy only
      max_restarts: 5,                    // fail-fast — no silent 542-restart loops
      restart_delay: 3000,
      env: {
        MAW_HOST: 'local',
        MAW_PORT: '3456',
      },
    },
    // maw-boot migrated PM2 → systemd 2026-04-26 (maw-boot.service, Type=oneshot
    // RemainAfterExit=yes). Removed from PM2 here because PM2 autorestart flipped the
    // successful oneshot to 'waiting restart' → false "pm2-persistence degraded" alert
    // (held 2977min, Pulse drift-audit 2026-07-26). Launcher shim preserved at
    // scripts/maw-boot.launcher.cjs (Nothing-is-Deleted). Do NOT `pm2 start maw-boot`.
    // maw-dev moved to Soul-Brews-Studio/maw-ui (bun run dev)
    // maw-broker removed — MQTT layer deleted in 3b71daa (WebSocket handles broadcast)
  ],
};
