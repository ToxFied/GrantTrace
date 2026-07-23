import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const scriptsDirectory = dirname(dirname(fileURLToPath(import.meta.url)));

export const projectRoot = dirname(scriptsDirectory);

export async function readPackageManifest() {
  const manifestPath = join(projectRoot, "package.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  if (
    manifest === null ||
    typeof manifest !== "object" ||
    manifest.name !== "granttrace"
  ) {
    throw new Error("Refusing to operate outside the GrantTrace package.");
  }
  return manifest;
}
