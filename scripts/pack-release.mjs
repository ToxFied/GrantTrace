import { rename } from "node:fs/promises";
import { dirname, join } from "node:path";

import { parseNpmPackOutput } from "./lib/npm-pack.mjs";
import { invocationArgs, npmInvocation } from "./lib/package-manager.mjs";
import { portableEnvironment, run } from "./lib/process.mjs";
import { projectRoot } from "./lib/project.mjs";

const destination = process.argv[process.argv[2] === "--" ? 3 : 2];
if (!destination) throw new Error("Pass the release tarball destination.");
const npm = await npmInvocation();
const packed = await run(
  npm.command,
  invocationArgs(npm, ["pack", "--json", "--pack-destination", dirname(destination)]),
  { cwd: projectRoot, environment: portableEnvironment() },
);
const source = join(dirname(destination), parseNpmPackOutput(packed.stdout).filename);
await rename(source, destination);
console.log(`Created release tarball: ${destination}`);
