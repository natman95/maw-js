/**
 * install-impl seam: per-source-type install handlers.
 * installFromDir / installFromTarball / installFromUrl
 */

import { existsSync, mkdtempSync, rmSync, statSync, symlinkSync } from "fs";
import { spawnSync } from "child_process";
import { tmpdir } from "os";
import { basename, join } from "path";
import { formatSdkMismatchError, runtimeSdkVersion, satisfies } from "../../../plugin/registry";
import { installRoot, removeExisting } from "./install-source-detect";
import { extractTarball, downloadTarball, verifyArtifactHash } from "./install-extraction";
import { readManifest, printInstallSuccess } from "./install-manifest-helpers";

export async function installFromDir(srcDir: string): Promise<void> {
  if (!existsSync(srcDir)) {
    throw new Error(`source not found: ${srcDir}`);
  }
  if (!statSync(srcDir).isDirectory()) {
    throw new Error(`not a directory: ${srcDir}`);
  }
  const manifest = readManifest(srcDir);
  if (!manifest) throw new Error("failed to read plugin manifest");

  // Semver gate — before symlinking, so a broken plugin never lands.
  const runtime = runtimeSdkVersion();
  if (!satisfies(runtime, manifest!.sdk)) {
    throw new Error(formatSdkMismatchError(manifest!.name, manifest!.sdk, runtime));
  }

  const dest = join(installRoot(), manifest!.name);
  removeExisting(dest);
  symlinkSync(srcDir, dest, "dir");

  printInstallSuccess(manifest!, dest, "linked (dev)");
}

export async function installFromTarball(
  tarballPath: string,
  opts: { source: string },
): Promise<void> {
  if (!existsSync(tarballPath)) {
    throw new Error(`tarball not found: ${tarballPath}`);
  }

  // Extract into a staging dir so we can read the manifest + verify hash
  // before any ~/.maw/plugins/ mutation.
  const staging = mkdtempSync(join(tmpdir(), "maw-install-"));
  const extractResult = extractTarball(tarballPath, staging);
  if (!extractResult.ok) {
    rmSync(staging, { recursive: true, force: true });
    throw new Error(extractResult.error);
  }

  const manifest = readManifest(staging);
  if (!manifest) {
    rmSync(staging, { recursive: true, force: true });
    throw new Error("failed to read plugin manifest");
  }

  const runtime = runtimeSdkVersion();
  if (!satisfies(runtime, manifest!.sdk)) {
    rmSync(staging, { recursive: true, force: true });
    throw new Error(formatSdkMismatchError(manifest!.name, manifest!.sdk, runtime));
  }

  const hashResult = verifyArtifactHash(staging, manifest!);
  if (!hashResult.ok) {
    rmSync(staging, { recursive: true, force: true });
    throw new Error(hashResult.error);
  }

  // All gates passed — move staging into the install root.
  const dest = join(installRoot(), manifest!.name);
  removeExisting(dest);
  // Use rename when the staging dir is on the same fs; otherwise copy-then-rm.
  try {
    const { renameSync } = require("fs");
    renameSync(staging, dest);
  } catch {
    // Cross-device fallback (rare). Fall back to cp -a then rm -rf.
    spawnSync("cp", ["-a", staging + "/.", dest], { encoding: "utf8" });
    rmSync(staging, { recursive: true, force: true });
  }

  const sourceNote = opts.source.startsWith("http") ? `from ${opts.source}` : "";
  printInstallSuccess(
    manifest!,
    dest,
    { sha256: manifest!.artifact!.sha256! },
    sourceNote || undefined,
  );
}

export async function installFromUrl(url: string): Promise<void> {
  const dl = await downloadTarball(url);
  if (!dl.ok) {
    throw new Error(dl.error);
  }
  try {
    await installFromTarball(dl.path, { source: url });
  } finally {
    // Clean up the downloaded temp file.
    try {
      rmSync(join(dl.path, ".."), { recursive: true, force: true });
    } catch {
      // Non-fatal.
    }
  }
}
