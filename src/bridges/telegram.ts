/**
 * Direct Telegram bridge — grammy bot inside maw serve.
 * No external process, no Docker, no nanoclaw needed.
 *
 * Human → Oracle: Telegram message → parse "hey <agent> <msg>" → /api/send
 * Oracle → Human: maw hey telegram:nat "msg" → bot.api.sendMessage
 *
 * Config in maw.config.json:
 *   telegram: { botToken: "...", allowedUsers: [123456789], defaultChat: -100... }
 */

import { Bot } from "grammy";
import { loadConfig } from "../config";

let bot: Bot | null = null;

interface TelegramConfig {
  botToken: string;
  allowedUsers: number[];
  defaultChat?: number;
  channels?: Record<string, number>;  // alias → chatId: { nat: 123456789, dev: -100xxx }
}

function getTelegramConfig(): TelegramConfig | null {
  const config = loadConfig();
  const tg = (config as any).telegram as TelegramConfig | undefined;
  if (!tg?.botToken) return null;
  return tg;
}

/** Start the Telegram bot (called from maw serve startup) */
export async function startTelegramBridge(): Promise<void> {
  const tg = getTelegramConfig();
  if (!tg) return; // no token configured → skip silently

  bot = new Bot(tg.botToken);
  const mawPort = loadConfig().port || 3456;

  // /start — welcome message
  bot.command("start", (ctx) => ctx.reply(
    "🌐 Maw Oracle Bot\n\n" +
    "Commands:\n" +
    "  hey <target> <message> — send to any oracle\n" +
    "  /sessions — list all reachable oracles\n" +
    "  /peek <target> — see oracle's screen\n\n" +
    "Examples:\n" +
    "  hey mawjs check the CI\n" +
    "  hey oracle-world:mawjs status\n" +
    "  hey mother hello\n" +
    "  hey mba:homekeeper check vpn"
  ));

  // /sessions — list all reachable targets
  bot.command("sessions", async (ctx) => {
    if (tg.allowedUsers.length > 0 && !tg.allowedUsers.includes(ctx.from.id)) return;
    try {
      const res = await fetch(`http://127.0.0.1:${mawPort}/api/sessions`);
      const sessions = await res.json() as any[];
      const lines = sessions.map((s: any) => {
        const wins = s.windows?.map((w: any) => w.name).join(", ") || "?";
        const src = s.source === "local" ? "local" : s.source?.replace(/^https?:\/\//, "");
        return `${s.name}: ${wins} [${src}]`;
      });
      await ctx.reply("📡 Sessions:\n\n" + lines.join("\n"));
    } catch {
      await ctx.reply("✗ maw unreachable");
    }
  });

  // hey <target> <message> — route to any oracle
  bot.on("message:text", async (ctx) => {
    if (tg.allowedUsers.length > 0 && !tg.allowedUsers.includes(ctx.from.id)) return;

    const text = ctx.message.text;

    // Parse "hey <agent> <message>" or direct "<agent> <message>"
    const heyMatch = text.match(/^(?:hey\s+)?(\S+(?::\S+)?)\s+([\s\S]+)/i);
    if (!heyMatch) return;

    const [, target, message] = heyMatch;
    // Skip if target looks like a regular word (not an oracle name)
    if (!/[-:]/.test(target) && !target.endsWith("-oracle") && target.length < 3) return;

    try {
      const res = await fetch(`http://127.0.0.1:${mawPort}/api/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target, text: `[telegram:nat] ${message.trim()}` }),
      });
      const data = await res.json() as any;
      if (data.ok) {
        await ctx.reply(`✓ → ${data.target || target}`);
      } else {
        await ctx.reply(`✗ ${data.error || "send failed"}`);
      }
    } catch {
      await ctx.reply(`✗ maw unreachable`);
    }
  });

  bot.start({ onStart: () => console.log("[telegram] bridge started") });
}

/** Stop the bot gracefully */
export function stopTelegramBridge(): void {
  bot?.stop();
  bot = null;
}

/** Send a message to a Telegram chat (Oracle → Human) */
export async function sendTelegram(chatId: number, text: string): Promise<boolean> {
  if (!bot) return false;
  try {
    await bot.api.sendMessage(chatId, text);
    return true;
  } catch {
    return false;
  }
}

/** Resolve telegram:alias to a chatId */
export function resolveTelegramTarget(query: string): { chatId: number } | null {
  const tg = getTelegramConfig();
  if (!tg) return null;

  // telegram:nat → lookup alias
  if (query.startsWith("telegram:") || query.startsWith("tg:")) {
    const alias = query.split(":")[1];
    const chatId = tg.channels?.[alias] ?? (alias === "default" ? tg.defaultChat : undefined);
    if (chatId) return { chatId };
    // Try as raw number
    const num = parseInt(alias, 10);
    if (!isNaN(num)) return { chatId: num };
  }

  return null;
}
