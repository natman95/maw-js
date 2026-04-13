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

export { tmux } from "../tmux";
export { hostExec } from "../ssh";
export { resolveTarget } from "../routing";
export type { ResolveResult } from "../routing";
export { findWindow } from "../find-window";
export type { Session, Window } from "../find-window";

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
