import { Elysia, t, error } from "elysia";
import { scanWorktrees, cleanupWorktree } from "../worktrees";

export const worktreesApi = new Elysia();

worktreesApi.get("/worktrees", async ({ error }) => {
  try {
    return await scanWorktrees();
  } catch (e: any) {
    return error(500, { error: e.message });
  }
});

worktreesApi.post("/worktrees/cleanup", async ({ body, error }) => {
  const { path } = body;
  if (!path) return error(400, { error: "path required" });
  try {
    const log = await cleanupWorktree(path);
    return { ok: true, log };
  } catch (e: any) {
    return error(500, { error: e.message });
  }
}, {
  body: t.Object({ path: t.String() }),
});
