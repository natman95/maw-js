import type { InvokeContext, InvokeResult } from "../../../plugin/types";
import {
  loadOracleChannels, saveOracleChannels, listAllOracleChannels,
  type OracleChannelConfig, type ChannelPlugin,
} from "../../shared/channel-loader";

export const command = {
  name: "channel",
  description: "Manage Claude Code channels per oracle.",
};

export default async function handler(ctx: InvokeContext): Promise<InvokeResult> {
  const logs: string[] = [];
  const origLog = console.log;
  console.log = (...a: any[]) => {
    if (ctx.writer) ctx.writer(...a);
    else logs.push(a.map(String).join(" "));
  };

  try {
    const args = ctx.source === "cli" ? (ctx.args as string[]) : [];
    const sub = args[0]?.toLowerCase();

    if (sub === "add") {
      const oracle = args[1];
      const plugin = args[2];
      if (!oracle || !plugin) {
        console.log("usage: maw channel add <oracle> <plugin-id>");
        console.log("  e.g. maw channel add hermes-discord plugin:discord@claude-plugins-official");
        console.log("       maw channel add hermes-discord discord  (shorthand)");
        return { ok: false, error: "oracle and plugin required" };
      }

      const pluginId = expandPluginId(plugin);
      const config = loadOracleChannels(oracle) || { plugins: [] };

      if (config.plugins.some(p => p.id === pluginId)) {
        console.log(`  \x1b[33m⚠\x1b[0m '${pluginId}' already registered for ${oracle}`);
        return { ok: true, output: logs.join("\n") };
      }

      const newPlugin: ChannelPlugin = { id: pluginId };

      // Auto-set DISCORD_STATE_DIR for discord plugins
      if (pluginId.includes("discord")) {
        newPlugin.env = { DISCORD_STATE_DIR: `~/.claude/channels/${oracle}` };
      }

      // --env KEY=VAL
      for (let i = 3; i < args.length; i++) {
        if (args[i] === "--env" && args[i + 1]?.includes("=")) {
          const [k, ...v] = args[i + 1].split("=");
          newPlugin.env = newPlugin.env || {};
          newPlugin.env[k] = v.join("=");
          i++;
        }
        if (args[i] === "--pass" && args[i + 1]) {
          config.token_source = `pass:${args[i + 1]}`;
          i++;
        }
      }

      config.plugins.push(newPlugin);
      saveOracleChannels(oracle, config);

      console.log(`  \x1b[32m✅\x1b[0m channel added: ${oracle} → ${pluginId}`);
      if (newPlugin.env) {
        for (const [k, v] of Object.entries(newPlugin.env)) {
          console.log(`     env: ${k}=${v}`);
        }
      }
      if (config.token_source) {
        console.log(`     token: ${config.token_source}`);
      }
      console.log(`     next: \x1b[36mmaw wake ${oracle}\x1b[0m (channels auto-injected)`);

    } else if (sub === "rm" || sub === "remove") {
      const oracle = args[1];
      const plugin = args[2];
      if (!oracle) {
        console.log("usage: maw channel rm <oracle> [plugin-id]");
        return { ok: false, error: "oracle required" };
      }

      const config = loadOracleChannels(oracle);
      if (!config?.plugins?.length) {
        console.log(`  \x1b[90mno channels for ${oracle}\x1b[0m`);
        return { ok: true };
      }

      if (plugin) {
        const pluginId = expandPluginId(plugin);
        config.plugins = config.plugins.filter(p => p.id !== pluginId);
        saveOracleChannels(oracle, config);
        console.log(`  \x1b[32m✓\x1b[0m removed ${pluginId} from ${oracle}`);
      } else {
        config.plugins = [];
        saveOracleChannels(oracle, config);
        console.log(`  \x1b[32m✓\x1b[0m removed all channels from ${oracle}`);
      }

    } else if (sub === "ls" || sub === "list" || !sub) {
      const target = args[1];

      if (target) {
        const config = loadOracleChannels(target);
        if (!config?.plugins?.length) {
          console.log(`  \x1b[90mno channels for ${target}\x1b[0m`);
        } else {
          console.log(`  \x1b[36;1m${target}\x1b[0m`);
          for (const p of config.plugins) {
            console.log(`    ${p.id}`);
            if (p.env) {
              for (const [k, v] of Object.entries(p.env)) {
                console.log(`      \x1b[90m${k}=${v}\x1b[0m`);
              }
            }
          }
          if (config.token_source) {
            console.log(`    \x1b[90mtoken: ${config.token_source}\x1b[0m`);
          }
        }
      } else {
        const all = listAllOracleChannels();
        if (all.length === 0) {
          console.log("  \x1b[90mno oracles have channels configured\x1b[0m");
          console.log("  add one: \x1b[36mmaw channel add <oracle> discord\x1b[0m");
        } else {
          console.log(`  \x1b[36;1mOracle${" ".repeat(24)}Channel\x1b[0m`);
          console.log(`  ${"─".repeat(30)}  ${"─".repeat(45)}`);
          for (const { oracle, plugins } of all) {
            for (const p of plugins) {
              console.log(`  ${oracle.padEnd(30)}  ${p.id}`);
            }
          }
          console.log(`\n  ${all.length} oracle(s) with channels`);
        }
      }

    } else if (sub === "providers") {
      const providers = getProviders();
      console.log(`  \x1b[36;1mChannel Providers\x1b[0m (${providers.length} available)\n`);
      console.log(`  ${"Provider".padEnd(15)} ${"Type".padEnd(10)} ${"Plugin ID".padEnd(45)} Status`);
      console.log(`  ${"─".repeat(15)} ${"─".repeat(10)} ${"─".repeat(45)} ${"─".repeat(10)}`);
      for (const p of providers) {
        const installed = isPluginInstalled(p.shortName);
        const status = installed ? "\x1b[32m✓ installed\x1b[0m" : "\x1b[90mnot installed\x1b[0m";
        console.log(`  ${p.shortName.padEnd(15)} ${p.type.padEnd(10)} ${p.pluginId.padEnd(45)} ${status}`);
      }
      console.log(`\n  Install: \x1b[36m/plugin install <provider>@claude-plugins-official\x1b[0m`);
      console.log(`  Custom:  \x1b[36mmaw channel add <oracle> server:<name>\x1b[0m (for .mcp.json servers)`);

    } else {
      console.log("usage: maw channel <add|rm|ls|providers> [oracle] [plugin]\n");
      console.log("  maw channel providers                       list available channel providers");
      console.log("  maw channel ls                              list all oracle channels");
      console.log("  maw channel ls hermes-discord                show one oracle's channels");
      console.log("  maw channel add hermes-discord discord       register official channel");
      console.log("  maw channel add myoracle server:webhook      register custom channel");
      console.log("  maw channel rm hermes-discord discord        remove channel");
      console.log("");
      console.log("  maw wake <oracle> auto-injects --channels when config exists");
    }

    return { ok: true, output: logs.join("\n") || undefined };
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e), output: logs.join("\n") || undefined };
  } finally {
    console.log = origLog;
  }
}

function expandPluginId(short: string): string {
  if (short.includes(":") || short.includes("@")) return short;
  return `plugin:${short}@claude-plugins-official`;
}

interface Provider {
  shortName: string;
  pluginId: string;
  type: "chat" | "webhook" | "custom";
}

function getProviders(): Provider[] {
  const official: Provider[] = [
    { shortName: "discord", pluginId: "plugin:discord@claude-plugins-official", type: "chat" },
    { shortName: "telegram", pluginId: "plugin:telegram@claude-plugins-official", type: "chat" },
    { shortName: "imessage", pluginId: "plugin:imessage@claude-plugins-official", type: "chat" },
    { shortName: "fakechat", pluginId: "plugin:fakechat@claude-plugins-official", type: "chat" },
  ];

  // Scan for custom channels in .mcp.json
  const { existsSync, readFileSync } = require("fs");
  const { join } = require("path");
  const mcpPaths = [
    join(process.cwd(), ".mcp.json"),
    join(require("os").homedir(), ".claude.json"),
  ];

  for (const p of mcpPaths) {
    if (!existsSync(p)) continue;
    try {
      const data = JSON.parse(readFileSync(p, "utf8"));
      const servers = data.mcpServers || {};
      for (const [name, _config] of Object.entries(servers)) {
        official.push({ shortName: name, pluginId: `server:${name}`, type: "custom" });
      }
    } catch { /* skip malformed */ }
  }

  return official;
}

function isPluginInstalled(shortName: string): boolean {
  const { existsSync } = require("fs");
  const { join } = require("path");
  const pluginDir = join(require("os").homedir(), ".claude/plugins/cache/claude-plugins-official", shortName);
  return existsSync(pluginDir);
}
