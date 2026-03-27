import { Hono } from "hono";
import { readFileSync } from "fs";
import { join, dirname } from "path";
const MAW_ROOT = join(dirname(new URL(import.meta.url).pathname), "../..");
export const shrineView = new Hono();
shrineView.get("/", (c) => c.html(readFileSync(join(MAW_ROOT, "office/shrine.html"), "utf-8")));
