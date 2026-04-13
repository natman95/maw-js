import { Elysia, t, error } from "elysia";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";

const asksPath = join(import.meta.dir, "../../asks.json");

export const asksApi = new Elysia();

asksApi.get("/asks", () => {
  try {
    if (!existsSync(asksPath)) return [];
    return JSON.parse(readFileSync(asksPath, "utf-8"));
  } catch {
    return [];
  }
});

asksApi.post("/asks", async ({ body, error }) => {
  try {
    writeFileSync(asksPath, JSON.stringify(body, null, 2), "utf-8");
    return { ok: true };
  } catch (e: any) {
    return error(400, { error: e.message });
  }
}, {
  body: t.Unknown(),
});
