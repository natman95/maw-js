import { cmdWorkspaceCreate, cmdWorkspaceJoin, cmdWorkspaceShare, cmdWorkspaceUnshare, cmdWorkspaceLs, cmdWorkspaceAgents, cmdWorkspaceInvite, cmdWorkspaceLeave, cmdWorkspaceStatus } from "../commands/workspace";

export async function routeWorkspace(cmd: string, args: string[]): Promise<boolean> {
  if (cmd !== "workspace" && cmd !== "ws") return false;

  const sub = args[1]?.toLowerCase();
  if (sub === "create") {
    if (!args[2]) { console.error("usage: maw workspace create <name> [--hub <url>]"); process.exit(1); }
    let hub: string | undefined;
    for (let i = 3; i < args.length; i++) {
      if (args[i] === "--hub" && args[i + 1]) { hub = args[++i]; }
    }
    await cmdWorkspaceCreate(args[2], hub);
  } else if (sub === "join") {
    if (!args[2]) { console.error("usage: maw workspace join <code> [--hub <url>]"); process.exit(1); }
    let hub: string | undefined;
    for (let i = 3; i < args.length; i++) {
      if (args[i] === "--hub" && args[i + 1]) { hub = args[++i]; }
    }
    await cmdWorkspaceJoin(args[2], hub);
  } else if (sub === "share") {
    const agents: string[] = [];
    let wsId: string | undefined;
    for (let i = 2; i < args.length; i++) {
      if ((args[i] === "--workspace" || args[i] === "--ws") && args[i + 1]) { wsId = args[++i]; }
      else agents.push(args[i]);
    }
    if (agents.length === 0) { console.error("usage: maw workspace share <agent...> [--workspace <id>]"); process.exit(1); }
    await cmdWorkspaceShare(agents, wsId);
  } else if (sub === "unshare") {
    const agents: string[] = [];
    let wsId: string | undefined;
    for (let i = 2; i < args.length; i++) {
      if ((args[i] === "--workspace" || args[i] === "--ws") && args[i + 1]) { wsId = args[++i]; }
      else agents.push(args[i]);
    }
    if (agents.length === 0) { console.error("usage: maw workspace unshare <agent...> [--workspace <id>]"); process.exit(1); }
    await cmdWorkspaceUnshare(agents, wsId);
  } else if (sub === "ls" || sub === "list") {
    await cmdWorkspaceLs();
  } else if (sub === "agents") {
    await cmdWorkspaceAgents(args[2]);
  } else if (sub === "invite") {
    await cmdWorkspaceInvite(args[2]);
  } else if (sub === "leave") {
    await cmdWorkspaceLeave(args[2]);
  } else if (sub === "status") {
    await cmdWorkspaceStatus();
  } else if (!sub) {
    await cmdWorkspaceLs();
  } else {
    console.log(`\x1b[36mmaw workspace\x1b[0m \u2014 Multi-node workspace management\n`);
    console.log(`  maw workspace create <name>          Create workspace on hub`);
    console.log(`  maw workspace join <code>            Join with invite code`);
    console.log(`  maw workspace share <agent...>       Share agents to workspace`);
    console.log(`  maw workspace unshare <agent...>     Remove agents from workspace`);
    console.log(`  maw workspace ls                     List joined workspaces`);
    console.log(`  maw workspace agents [workspace-id]  List all agents in workspace`);
    console.log(`  maw workspace invite [workspace-id]  Show join code`);
    console.log(`  maw workspace leave [workspace-id]   Leave workspace`);
    console.log(`  maw workspace status                 Connection status to hub(s)\n`);
    console.log(`\x1b[90mAlias: maw ws ...\x1b[0m`);
  }
  return true;
}
