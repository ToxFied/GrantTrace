import {
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";

import { parseNpmPackOutput } from "./lib/npm-pack.mjs";
import { resolvePackageArtifact } from "./lib/package-artifact.mjs";
import { invocationArgs, npmInvocation } from "./lib/package-manager.mjs";
import { portableEnvironment, run } from "./lib/process.mjs";
import { projectRoot, readPackageManifest } from "./lib/project.mjs";

const manifest = await readPackageManifest();

if (process.argv.length !== 2) {
  throw new Error("Usage: pnpm package:artifact");
}

const outputDirectory = join(projectRoot, ".release");
const artifactPath = join(outputDirectory, "granttrace.tgz");
const temporaryRoot = await mkdtemp(join(tmpdir(), "granttrace-release-pack-"));

try {
  await mkdir(outputDirectory, { recursive: true, mode: 0o700 });
  if (!(await lstat(outputDirectory)).isDirectory()) {
    throw new Error("The release artifact directory is not a safe directory.");
  }
  if ((await readdir(outputDirectory)).length !== 0) {
    throw new Error("Refusing to mix a release artifact with existing files.");
  }

  const cacheDirectory = join(temporaryRoot, "npm-cache");
  const userConfigPath = join(temporaryRoot, "empty-npmrc");
  await Promise.all([
    mkdir(cacheDirectory, { recursive: true, mode: 0o700 }),
    writeFile(userConfigPath, "", { mode: 0o600 }),
  ]);

  const npm = await npmInvocation();
  const packed = await run(
    npm.command,
    invocationArgs(npm, [
      "pack",
      "--json",
      "--pack-destination",
      outputDirectory,
    ]),
    {
      cwd: projectRoot,
      environment: portableEnvironment({
        npm_config_cache: cacheDirectory,
        npm_config_userconfig: userConfigPath,
        npm_config_audit: "false",
        npm_config_fund: "false",
        npm_config_update_notifier: "false",
      }),
    },
  );
  const { filename } = parseNpmPackOutput(packed.stdout);
  if (filename !== `${manifest.name}-${manifest.version}.tgz`) {
    throw new Error("npm pack returned the wrong package artifact name.");
  }
  const entries = await readdir(outputDirectory);
  if (entries.length !== 1 || entries[0] !== filename) {
    throw new Error("npm pack did not create exactly one package tarball.");
  }

  await rename(join(outputDirectory, filename), artifactPath);
  const finalEntries = await readdir(outputDirectory);
  if (finalEntries.length !== 1 || finalEntries[0] !== "granttrace.tgz") {
    throw new Error("The release artifact directory is not exact.");
  }
  await resolvePackageArtifact(artifactPath);
  console.log(
    `Created release package artifact at ${relative(projectRoot, artifactPath)}.`,
  );
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}
