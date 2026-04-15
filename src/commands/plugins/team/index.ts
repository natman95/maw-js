import type { InvokeContext, InvokeResult } from "../../../plugin/types";
import {
  cmdTeamShutdown, cmdTeamList, cmdTeamCreate, cmdTeamSpawn,
  cmdTeamSend, cmdTeamResume, cmdTeamLives,
} from "./impl";

export const command = {
  name: "team",
  description: "Agent reincarnation engine — create, spawn, send, shutdown, resume, lives.",
};

export default async function handler(ctx: InvokeContext): Promise<InvokeResult> {
  const logs: string[] = [];
  const origLog = console.log;
  const origError = console.error;
  console.log = (...a: any[]) => logs.push(a.map(String).join(" "));
  console.error = (...a: any[]) => logs.push(a.map(String).join(" "));
  try {
    const args = ctx.source === "cli" ? (ctx.args as string[]) : [];
    const sub = args[0]?.toLowerCase();

    if (sub === "create" || sub === "new") {
      if (!args[1]) {
        logs.push("usage: maw team create <name> [--description <text>]");
        return { ok: false, error: "name required", output: logs.join("\n") };
      }
      const descIdx = args.indexOf("--description");
      const description = descIdx !== -1 ? args.slice(descIdx + 1).join(" ") : undefined;
      cmdTeamCreate(args[1], { description });
    } else if (sub === "spawn") {
      if (!args[1] || !args[2]) {
        logs.push("usage: maw team spawn <team> <role> [--model <model>] [--prompt <text>]");
        return { ok: false, error: "team and role required", output: logs.join("\n") };
      }
      const modelIdx = args.indexOf("--model");
      const model = modelIdx !== -1 ? args[modelIdx + 1] : undefined;
      const promptIdx = args.indexOf("--prompt");
      const prompt = promptIdx !== -1 ? args.slice(promptIdx + 1).join(" ") : undefined;
      cmdTeamSpawn(args[1], args[2], { model, prompt });
    } else if (sub === "send" || sub === "msg") {
      if (!args[1] || !args[2] || !args[3]) {
        logs.push("usage: maw team send <team> <agent> <message>");
        return { ok: false, error: "team, agent, and message required", output: logs.join("\n") };
      }
      cmdTeamSend(args[1], args[2], args.slice(3).join(" "));
    } else if (sub === "resume") {
      if (!args[1]) {
        logs.push("usage: maw team resume <name> [--model <model>]");
        return { ok: false, error: "name required", output: logs.join("\n") };
      }
      const modelIdx = args.indexOf("--model");
      const model = modelIdx !== -1 ? args[modelIdx + 1] : undefined;
      cmdTeamResume(args[1], { model });
    } else if (sub === "lives" || sub === "history") {
      if (!args[1]) {
        logs.push("usage: maw team lives <agent>");
        return { ok: false, error: "agent name required", output: logs.join("\n") };
      }
      cmdTeamLives(args[1]);
    } else if (sub === "shutdown" || sub === "down") {
      if (!args[1]) {
        logs.push("usage: maw team shutdown <name> [--force] [--merge]");
        return { ok: false, error: "name required", output: logs.join("\n") };
      }
      await cmdTeamShutdown(args[1], {
        force: args.includes("--force"),
        merge: args.includes("--merge"),
      });
    } else if (sub === "list" || sub === "ls" || !sub) {
      await cmdTeamList();
    } else {
      logs.push(`unknown team subcommand: ${sub}`);
      logs.push("usage: maw team <create|spawn|send|shutdown|resume|lives|list>");
      return { ok: false, error: `unknown subcommand: ${sub}`, output: logs.join("\n") };
    }

    return { ok: true, output: logs.join("\n") || undefined };
  } catch (e: any) {
    return { ok: false, error: logs.join("\n") || e.message, output: logs.join("\n") || undefined };
  } finally {
    console.log = origLog;
    console.error = origError;
  }
}
