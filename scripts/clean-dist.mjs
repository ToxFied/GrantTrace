import { lstat, rm } from "node:fs/promises";
import { basename, join } from "node:path";

import { projectRoot, readPackageManifest } from "./lib/project.mjs";

await readPackageManifest();

const distPath = join(projectRoot, "dist");
if (basename(distPath) !== "dist") {
  throw new Error("Refusing to clean an unexpected path.");
}

try {
  const entry = await lstat(distPath);
  if (!entry.isDirectory() && !entry.isSymbolicLink()) {
    throw new Error("Refusing to remove a non-directory dist entry.");
  }
  await rm(distPath, {
    recursive: true,
    force: true,
    maxRetries: 3,
    retryDelay: 100,
  });
} catch (error) {
  if (
    !(error instanceof Error && "code" in error && error.code === "ENOENT")
  ) {
    throw error;
  }
}
