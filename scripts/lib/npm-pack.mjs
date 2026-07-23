import { basename } from "node:path";

export function parseNpmPackOutput(stdout) {
  let index = stdout.lastIndexOf("[");
  while (index >= 0) {
    try {
      const parsed = JSON.parse(stdout.slice(index).trim());
      const filename = parsed?.[0]?.filename;
      if (
        Array.isArray(parsed) &&
        parsed.length === 1 &&
        typeof filename === "string" &&
        basename(filename) === filename &&
        filename.endsWith(".tgz")
      ) {
        return parsed[0];
      }
    } catch {
      // Lifecycle scripts can write to stdout before npm's JSON result.
    }
    index = stdout.lastIndexOf("[", index - 1);
  }
  throw new Error("npm pack did not return a valid tarball result.");
}
