import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";

const CHANNELS_BASE = join(homedir(), ".claude", "channels");

export interface ChannelPlugin {
  id: string;
  env?: Record<string, string>;
}

export interface OracleChannelConfig {
  plugins: ChannelPlugin[];
  token_source?: string;
}

function stateDir(oracleStem: string): string {
  return join(CHANNELS_BASE, oracleStem);
}

function configPath(oracleStem: string): string {
  return join(stateDir(oracleStem), "config.json");
}

export function loadOracleChannels(oracleStem: string): OracleChannelConfig | null {
  const p = configPath(oracleStem);
  if (!existsSync(p)) return null;
  try { return JSON.parse(readFileSync(p, "utf8")); } catch { return null; }
}

export function saveOracleChannels(oracleStem: string, config: OracleChannelConfig): void {
  const dir = stateDir(oracleStem);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  writeFileSync(configPath(oracleStem), JSON.stringify(config, null, 2) + "\n");
}

export function getChannelPluginIds(oracleStem: string, fleetOverride?: string[]): string[] {
  if (fleetOverride?.length) return fleetOverride;
  const config = loadOracleChannels(oracleStem);
  return config?.plugins.map(p => p.id) ?? [];
}

export function getChannelEnv(oracleStem: string, fleetEnvOverride?: Record<string, string>): Record<string, string> {
  const env: Record<string, string> = {};
  const config = loadOracleChannels(oracleStem);
  if (config?.plugins) {
    for (const p of config.plugins) {
      if (p.env) Object.assign(env, p.env);
    }
  }
  if (fleetEnvOverride) Object.assign(env, fleetEnvOverride);
  return env;
}

export function listAllOracleChannels(): Array<{ oracle: string; plugins: ChannelPlugin[] }> {
  if (!existsSync(CHANNELS_BASE)) return [];
  const { readdirSync } = require("fs");
  const dirs = readdirSync(CHANNELS_BASE, { withFileTypes: true })
    .filter((d: any) => d.isDirectory())
    .map((d: any) => d.name);

  const results: Array<{ oracle: string; plugins: ChannelPlugin[] }> = [];
  for (const dir of dirs) {
    const config = loadOracleChannels(dir);
    if (config?.plugins?.length) {
      results.push({ oracle: dir, plugins: config.plugins });
    }
  }
  return results;
}
