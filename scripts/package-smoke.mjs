import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { parseNpmPackOutput } from "./lib/npm-pack.mjs";
import { portableEnvironment, run } from "./lib/process.mjs";
import { projectRoot, readPackageManifest } from "./lib/project.mjs";
import { readTarGzip } from "./lib/tar.mjs";

const manifest = await readPackageManifest();
validateManifest(manifest);

const temporaryRoot = await mkdtemp(join(tmpdir(), "granttrace-package-"));
const packDirectory = join(temporaryRoot, "packed");
const installDirectory = join(temporaryRoot, "consumer");
const cacheDirectory = join(temporaryRoot, "npm-cache");
const userConfigPath = join(temporaryRoot, "empty-npmrc");
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";

try {
  await Promise.all([
    mkdir(packDirectory, { recursive: true, mode: 0o700 }),
    mkdir(installDirectory, { recursive: true, mode: 0o700 }),
    mkdir(cacheDirectory, { recursive: true, mode: 0o700 }),
    writeFile(userConfigPath, "", { mode: 0o600 }),
  ]);

  const environment = portableEnvironment({
    npm_config_cache: cacheDirectory,
    npm_config_userconfig: userConfigPath,
    npm_config_audit: "false",
    npm_config_fund: "false",
    npm_config_update_notifier: "false",
  });

  const packed = await run(
    npmCommand,
    ["pack", "--json", "--pack-destination", packDirectory],
    { cwd: projectRoot, environment },
  );
  const packResult = parseNpmPackOutput(packed.stdout);
  if (!Array.isArray(packResult.files)) {
    throw new Error("npm pack did not return its file manifest.");
  }
  validatePackedFiles(packResult.files);

  const tarballPath = join(packDirectory, packResult.filename);
  const archiveEntries = readTarGzip(await readFile(tarballPath));
  validateArchiveEntries(archiveEntries, packResult.files);

  await writeFile(
    join(installDirectory, "package.json"),
    `${JSON.stringify(
      { name: "granttrace-package-smoke", private: true, type: "module" },
      null,
      2,
    )}\n`,
    { mode: 0o600 },
  );
  await run(
    npmCommand,
    [
      "install",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      "--package-lock=false",
      tarballPath,
    ],
    { cwd: installDirectory, environment },
  );

  const installedPackageDirectory = join(
    installDirectory,
    "node_modules",
    ...manifest.name.split("/"),
  );
  const installedManifest = JSON.parse(
    await readFile(join(installedPackageDirectory, "package.json"), "utf8"),
  );
  if (
    installedManifest.name !== manifest.name ||
    installedManifest.version !== manifest.version
  ) {
    throw new Error("The installed package identity differs from the tarball.");
  }

  const installedBin = await validateInstalledBin(installDirectory);
  const help = await run(installedBin, ["--help"], {
    cwd: installDirectory,
    environment,
  });
  if (!help.stdout.includes("Usage") || !help.stdout.includes("granttrace record")) {
    throw new Error("The installed CLI help is incomplete.");
  }

  const version = await run(installedBin, ["--version"], {
    cwd: installDirectory,
    environment,
  });
  if (version.stdout.trim() !== manifest.version) {
    throw new Error("The installed CLI reports the wrong version.");
  }

  const imported = await run(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      "await import('granttrace'); await import('granttrace/octokit'); process.stdout.write('imports-ok')",
    ],
    { cwd: installDirectory, environment },
  );
  if (imported.stdout !== "imports-ok") {
    throw new Error("The installed package exports could not be imported.");
  }

  const scenarioPath = join(installDirectory, "offline-scenario.mjs");
  await writeFile(scenarioPath, offlineScenarioSource(), { mode: 0o600 });
  const recorded = await run(
    installedBin,
    [
      "record",
      "--scenario",
      "package-smoke",
      "--",
      process.execPath,
      scenarioPath,
    ],
    { cwd: installDirectory, environment },
  );
  if (!recorded.stdout.includes("GrantTrace record complete")) {
    throw new Error("The installed CLI did not complete offline recording.");
  }

  const changed = await run(installedBin, ["check"], {
    cwd: installDirectory,
    environment,
    expectedExitCodes: [6],
  });
  if (!changed.stderr.includes("GrantTrace check")) {
    throw new Error("The installed CLI did not report a reviewable change.");
  }

  await run(installedBin, ["check", "--accept"], {
    cwd: installDirectory,
    environment,
  });
  const checked = await run(installedBin, ["check"], {
    cwd: installDirectory,
    environment,
  });
  if (!checked.stdout.includes("GrantTrace check passed")) {
    throw new Error("The installed CLI did not validate its accepted contract.");
  }

  const accepted = JSON.parse(
    await readFile(join(installDirectory, "granttrace.lock.json"), "utf8"),
  );
  if (
    accepted.schemaVersion !== 2 ||
    accepted.scenarios?.length !== 1 ||
    accepted.scenarios[0]?.name !== "package-smoke"
  ) {
    throw new Error("The installed CLI wrote an unexpected contract.");
  }

  await validateEphemeralState(installDirectory);
  console.log(
    `Package smoke test passed for ${manifest.name}@${manifest.version} (${String(
      packResult.files.length,
    )} files).`,
  );
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}

function validateManifest(value) {
  if (
    typeof value.version !== "string" ||
    !/^\d+\.\d+\.\d+-beta\.\d+$/u.test(value.version) ||
    value.private === true ||
    value.type !== "module" ||
    value.engines?.node !== ">=22" ||
    value.bin?.granttrace !== "./dist/cli/bin.js" ||
    value.exports?.["."]?.types !== "./dist/index.d.ts" ||
    value.exports?.["."]?.import !== "./dist/index.js" ||
    value.exports?.["./octokit"]?.types !== "./dist/octokit/index.d.ts" ||
    value.exports?.["./octokit"]?.import !== "./dist/octokit/index.js"
  ) {
    throw new Error("Package metadata is not ready for a beta CLI tarball.");
  }
  const files = [...(value.files ?? [])].sort();
  if (files.join("\n") !== ["LICENSE", "README.md", "dist"].sort().join("\n")) {
    throw new Error("The package files allowlist is not exact.");
  }
}

function validatePackedFiles(files) {
  const seen = new Set();
  for (const entry of files) {
    if (
      entry === null ||
      typeof entry !== "object" ||
      typeof entry.path !== "string" ||
      seen.has(entry.path) ||
      !isAllowedPackagePath(entry.path)
    ) {
      throw new Error("The tarball contains a path outside the package allowlist.");
    }
    seen.add(entry.path);
  }

  for (const required of [
    "LICENSE",
    "README.md",
    "package.json",
    "dist/cli/bin.js",
    "dist/index.js",
    "dist/index.d.ts",
    "dist/octokit/index.js",
    "dist/octokit/index.d.ts",
  ]) {
    if (!seen.has(required)) {
      throw new Error(`The tarball is missing required file ${required}.`);
    }
  }

  const bin = files.find((entry) => entry.path === "dist/cli/bin.js");
  if (
    process.platform !== "win32" &&
    (typeof bin?.mode !== "number" || (bin.mode & 0o111) === 0)
  ) {
    throw new Error("The packaged CLI entry point is not executable.");
  }
}

function validateArchiveEntries(entries, npmFiles) {
  const archivePaths = new Set();
  for (const entry of entries) {
    if (!entry.path.startsWith("package/")) {
      throw new Error("The tarball contains an entry outside package/.");
    }
    const relativePath = entry.path.slice("package/".length);
    if (!isAllowedPackagePath(relativePath) || archivePaths.has(relativePath)) {
      throw new Error("The tarball contains an unsafe or duplicate entry.");
    }
    archivePaths.add(relativePath);
  }
  const npmPaths = new Set(npmFiles.map((entry) => entry.path));
  if (
    archivePaths.size !== npmPaths.size ||
    [...archivePaths].some((path) => !npmPaths.has(path))
  ) {
    throw new Error("npm metadata and the tarball file list disagree.");
  }
}

function isAllowedPackagePath(path) {
  if (["LICENSE", "README.md", "package.json"].includes(path)) {
    return true;
  }
  return (
    path.startsWith("dist/") &&
    !path.includes("..") &&
    !/(?:^|\/)(?:test|tests|fixtures?|examples?|coverage|node_modules|\.cache)(?:\/|$)/u.test(
      path.toLowerCase(),
    ) &&
    /\.(?:js|js\.map|d\.ts|d\.ts\.map)$/u.test(path)
  );
}

async function validateInstalledBin(directory) {
  const binDirectory = join(directory, "node_modules", ".bin");
  const candidates =
    process.platform === "win32"
      ? ["granttrace.cmd", "granttrace.ps1"]
      : ["granttrace"];
  const available = await readdir(binDirectory);
  const candidate = candidates.find((entry) => available.includes(entry));
  if (candidate === undefined) {
    throw new Error("The package manager did not install the granttrace bin.");
  }
  const path = join(binDirectory, candidate);
  if (process.platform !== "win32") {
    const details = await stat(path);
    if ((details.mode & 0o111) === 0) {
      throw new Error("The installed granttrace bin is not executable.");
    }
  }
  return path;
}

async function validateEphemeralState(directory) {
  if (process.platform !== "win32") {
    for (const [path, expected] of [
      [join(directory, ".granttrace"), 0o700],
      [join(directory, ".granttrace", "sessions"), 0o700],
      [join(directory, ".granttrace", "observations"), 0o700],
      [
        join(
          directory,
          ".granttrace",
          "observations",
          "package-smoke.ndjson",
        ),
        0o600,
      ],
    ]) {
      const details = await stat(path);
      if ((details.mode & 0o777) !== expected) {
        throw new Error("GrantTrace created an artifact with unsafe permissions.");
      }
    }
  }

  const sessions = await readdir(join(directory, ".granttrace", "sessions"));
  if (sessions.length !== 0) {
    throw new Error("The installed CLI left proof or record session residue.");
  }
}

function offlineScenarioSource() {
  return `import { createServer } from "node:http";
import { Octokit } from "@octokit/core";
import { grantTrace } from "granttrace/octokit";

const server = createServer((request, response) => {
  request.resume();
  request.once("end", () => {
    response.writeHead(200, {
      "content-type": "application/json",
      "x-accepted-github-permissions": "contents=read",
    });
    response.end("{}");
  });
});

await new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", resolve);
});

try {
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Local server did not start.");
  }
  const TracedOctokit = Octokit.plugin(grantTrace);
  const octokit = new TracedOctokit({
    baseUrl: \`http://127.0.0.1:\${address.port}\`,
  });
  await octokit.request("GET /repos/{owner}/{repo}/contents/{path}", {
    owner: "offline-owner",
    repo: "offline-repository",
    path: "README.md",
  });
} finally {
  await new Promise((resolve) => server.close(resolve));
}
`;
}
