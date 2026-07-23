import { chmod, lstat } from "node:fs/promises";
import { join } from "node:path";

import { projectRoot, readPackageManifest } from "./lib/project.mjs";

await readPackageManifest();

const binPath = join(projectRoot, "dist", "cli", "bin.js");
const details = await lstat(binPath);
if (!details.isFile() || details.isSymbolicLink()) {
  throw new Error("The built CLI entry point is missing or unsafe.");
}
await chmod(binPath, 0o755);
