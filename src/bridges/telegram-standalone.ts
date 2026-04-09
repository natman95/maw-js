#!/usr/bin/env bun
/**
 * Standalone Telegram bridge — raw fetch, no grammy (bun compat).
 * Long-polls getUpdates, routes "hey <target> <msg>" to maw /api/send.
 */

import { loadConfig } from "../config";

const config = loadConfig();
const tg = (config as any).telegram;
if (!tg?.botToken) { console.error("[telegram] no botToken configured"); process.exit(1); }

const TOKEN = tg.botToken;
const ALLOWED: number[] = tg.allowedUsers || [];
const MAW_PORT = config.port || 3456;
const API = `https://api.telegram.org/bot${TOKEN}`;

let offset = 0;

async function sendTg(chatId: number, text: string) {
  await fetch(`${API}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML" }),
  });
}

async function handleMessage(msg: any) {
  const chatId = msg.chat.id;
  const userId = msg.from?.id;
  const text = msg.text || "";

  if (ALLOWED.length > 0 && !ALLOWED.includes(userId)) return;

  // /start
  if (text === "/start") {
    return sendTg(chatId,
      "🌐 <b>Maw Oracle Bot</b>\n\n" +
      "Commands:\n" +
      "  <code>hey &lt;target&gt; &lt;message&gt;</code>\n" +
      "  <code>/sessions</code> — list oracles\n\n" +
      "Examples:\n" +
      "  <code>hey mawjs check CI</code>\n" +
      "  <code>hey oracle-world:mawjs hello</code>\n" +
      "  <code>hey mother what's up</code>"
    );
  }

  // /sessions
  if (text === "/sessions") {
    try {
      const res = await fetch(`http://127.0.0.1:${MAW_PORT}/api/sessions`);
      const sessions = await res.json() as any[];
      const lines = sessions.map((s: any) => {
        const wins = s.windows?.map((w: any) => w.name).join(", ") || "?";
        const src = s.source === "local" ? "⚡" : "🌐";
        return `${src} ${s.name}: ${wins}`;
      });
      return sendTg(chatId, "📡 <b>Sessions</b>\n\n<pre>" + lines.join("\n") + "</pre>");
    } catch {
      return sendTg(chatId, "✗ maw unreachable");
    }
  }

  // hey <target> <message>
  const match = text.match(/^(?:hey\s+)(\S+)\s+([\s\S]+)/i);
  if (match) {
    const [, target, message] = match;
    try {
      const res = await fetch(`http://127.0.0.1:${MAW_PORT}/api/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target, text: `[telegram:nat] ${message.trim()}` }),
      });
      const data = await res.json() as any;
      if (data.ok) {
        return sendTg(chatId, `✓ → ${data.target || target}`);
      }
      return sendTg(chatId, `✗ ${data.error || "send failed"}`);
    } catch {
      return sendTg(chatId, "✗ maw unreachable");
    }
  }
}

// Long-polling loop
console.log("[telegram] bridge started (raw fetch, no grammy)");

while (true) {
  try {
    const res = await fetch(`${API}/getUpdates?offset=${offset}&timeout=30`, {
      signal: AbortSignal.timeout(35000),
    });
    const data = await res.json() as any;
    if (data.ok && data.result?.length > 0) {
      for (const update of data.result) {
        offset = update.update_id + 1;
        if (update.message) await handleMessage(update.message);
      }
    }
  } catch (e: any) {
    if (e.name !== "TimeoutError") {
      console.error("[telegram] poll error:", e.message);
      await Bun.sleep(5000);
    }
  }
}
