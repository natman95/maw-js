import { cmdList, cmdPeek, cmdSend, cmdWire } from "../commands/comm";
import { cmdTalkTo } from "../commands/talk-to";
import { cmdBroadcast } from "../commands/broadcast";

export async function routeComm(cmd: string, args: string[]): Promise<boolean> {
  if (cmd === "ls" || cmd === "list") {
    await cmdList();
    return true;
  }
  if (cmd === "peek" || cmd === "see") {
    await cmdPeek(args[1]);
    return true;
  }
  if (cmd === "hey" || cmd === "send" || cmd === "tell") {
    const force = args.includes("--force");
    const msgArgs = args.slice(2).filter(a => a !== "--force");
    if (!args[1] || !msgArgs.length) { console.error("usage: maw hey <agent> <message> [--force]"); process.exit(1); }
    await cmdSend(args[1], msgArgs.join(" "), force);
    return true;
  }
  if (cmd === "wire") {
    const msgArgs = args.slice(2);
    if (!args[1] || !msgArgs.length) { console.error("usage: maw wire <agent> <message>"); process.exit(1); }
    await cmdWire(args[1], msgArgs.join(" "));
    return true;
  }
  if (cmd === "talk-to" || cmd === "talkto" || cmd === "talk") {
    const force = args.includes("--force");
    const msgArgs = args.slice(2).filter(a => a !== "--force");
    if (!args[1] || !msgArgs.length) { console.error("usage: maw talk-to <agent> <message> [--force]"); process.exit(1); }
    await cmdTalkTo(args[1], msgArgs.join(" "), force);
    return true;
  }
  if (cmd === "broadcast" || cmd === "shout") {
    const msg = args.slice(1).join(" ");
    await cmdBroadcast(msg);
    return true;
  }
  return false;
}
