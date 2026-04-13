/**
 * @maw-js/sdk — the stable API surface for maw-js plugins.
 *
 * TS plugins import from here. WASM plugins get the same capabilities
 * via host functions in wasm-bridge.ts.
 *
 * Rule: if it's not exported here, plugins shouldn't depend on it.
 * This is the contract boundary between core runtime and plugin code.
 */

// ─── Types (shared by TS + WASM plugins) ─────────────────────────────────────

export type {
  PluginManifest,
  LoadedPlugin,
  InvokeContext,
  InvokeResult,
} from "../plugin/types";

// ─── Identity & Config ───────────────────────────────────────────────────────

export { loadConfig, saveConfig } from "../config";
export type { MawConfig } from "../config";

// ─── Transport ───────────────────────────────────────────────────────────────

export { tmux } from "../core/tmux";
export { hostExec } from "../core/ssh";
export { resolveTarget } from "../core/routing";
export type { ResolveResult } from "../core/routing";
export { findWindow } from "../core/find-window";
export type { Session, Window } from "../core/find-window";

// ─── Artifacts ───────────────────────────────────────────────────────────────

export {
  createArtifact,
  updateArtifact,
  writeResult,
  addAttachment,
  listArtifacts,
  getArtifact,
  artifactDir,
} from "../lib/artifacts";
export type { ArtifactMeta, ArtifactSummary } from "../lib/artifacts";

// ─── Plugin System ───────────────────────────────────────────────────────────

export { discoverPackages, invokePlugin } from "../plugin/registry";
export { parseManifest, loadManifestFromDir } from "../plugin/manifest";
export { registerCommand, matchCommand, listCommands } from "../cli/command-registry";

// ─── Helpers ─────────────────────────────────────────────────────────────────

export { parseFlags } from "../cli/parse-args";

// ─── definePlugin — the plugin contract ──────────────────────────────────────

import type { InvokeContext, InvokeResult } from "../plugin/types";

/** Plugin configuration — the type IS the interface */
export interface PluginConfig {
  /** Plugin name (must match plugin.json name) */
  name: string;
  /** The handler — one function, all surfaces (cli/api/peer) */
  handler: (ctx: InvokeContext) => Promise<InvokeResult>;
  /** Phase 0: GATE — return false to cancel event pipeline */
  onGate?: (event: any) => boolean;
  /** Phase 1: FILTER — modify event before handlers */
  onFilter?: (event: any) => any;
  /** Phase 2: HANDLE — observe/react to events */
  onEvent?: (event: any) => void | Promise<void>;
  /** Phase 3: LATE — guaranteed cleanup */
  onLate?: (event: any) => void;
  /** Called when plugin is first installed */
  onInstall?: () => void | Promise<void>;
  /** Called when plugin is removed */
  onUninstall?: () => void | Promise<void>;
}

/**
 * Define a maw-js plugin. Like Vue's defineComponent() — validates
 * the shape, provides autocomplete, zero runtime overhead.
 *
 * ```ts
 * import { definePlugin } from "maw/sdk";
 *
 * export default definePlugin({
 *   name: "my-plugin",
 *   handler(ctx) {
 *     return { ok: true, output: "hello" };
 *   },
 *   onEvent(event) { console.log(event); },
 * });
 * ```
 */
export function definePlugin(config: PluginConfig): PluginConfig {
  if (!config.name) throw new Error("definePlugin: name is required");
  if (typeof config.handler !== "function") throw new Error("definePlugin: handler is required");
  return config;
}
